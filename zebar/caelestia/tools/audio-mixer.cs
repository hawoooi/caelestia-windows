// Rebuild after editing:
//   C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe /nologo /target:exe ^
//     /optimize+ /out:audio-mixer.exe /r:System.Drawing.dll audio-mixer.cs
//
// Per-application volume control -- the Windows volume mixer's data, which
// nothing else on this machine exposes to a script. Direct user feedback:
// "The volume panel is too basic. I want it to be more like this", with a
// screenshot of the per-app mixer (a master device slider, then one row per
// sounding application with its own icon, slider and level).
//
// Why a helper at all: zebar's `audio` provider gives exactly one thing --
// the DEFAULT PLAYBACK DEVICE's volume/mute (confirmed live: its
// defaultPlaybackDevice is {name, deviceId, deviceType, volume,
// isDefaultPlayback, isDefaultRecording, isMuted} and nothing else). Windows
// has no built-in CLI for per-app volume either. The only route is the Core
// Audio session API (IAudioSessionManager2 -> IAudioSessionControl2 ->
// ISimpleAudioVolume), which means COM interop, which means a native helper.
// The master slider deliberately stays on zebar's own provider; this tool
// only ever touches per-application sessions.
//
// Commands (argv), matching the tight argsRegex registered in zpack.json --
// anything else exits non-zero having done nothing:
//
//   list              -> JSON to stdout, sessions INCLUDING a base64 PNG icon
//   list --no-icons   -> same JSON, `icon` omitted
//   set <pid> <0-100> -> set that session's volume
//   mute <pid> <0|1>  -> mute/unmute that session
//
// The icon split exists because the panel polls `list` while it is open. The
// icons are the expensive part (extraction + PNG encode + base64, per app)
// and they never change while a process lives, so the panel fetches them once
// on open and polls `list --no-icons` after that.
//
// FAIL-SOFT CONTRACT, identical to fullscreen-detect.exe and app-icon.exe:
// any failure prints nothing useful and exits non-zero; a session that cannot
// be read is SKIPPED rather than aborting the whole enumeration. A mixer that
// silently omits one app is far better than a panel that renders nothing --
// and the caller (panels/panels.js) treats empty output as "no sessions".
//
// PROCESS DISCIPLINE (this pack has lost two debugging sessions to it, see
// fullscreen.js): this process is short-lived and writes only to stdout. The
// caller must never let two overlap and must not poll it when the panel is
// closed.

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

static class AudioMixer
{
    // ---- Core Audio COM interop -----------------------------------------
    // [PreserveSig] on EVERY member is load-bearing, not decoration. Without
    // it the runtime applies HRESULT-transforming marshalling, and a method
    // with no [out] parameter -- IsSystemSoundsSession() being the one that
    // matters here -- has its return value reinterpreted rather than handed
    // back as the raw HRESULT. That produced a mixer where every session
    // reported itself as the system-sounds session (so every row rendered as
    // "System Sounds" with pid 0), while volumes read back perfectly -- a
    // failure that looks like a logic bug and is not one. Declaring the raw
    // HRESULT return everywhere removes the ambiguity.
    //
    // Vtable ORDER is the contract here, not the names: these interfaces are
    // IUnknown-based, so every method of every base interface must be
    // redeclared, in order, before the derived ones. Getting one slot wrong
    // does not fail to compile -- it calls the wrong function pointer at
    // runtime. Each block below is ordered exactly as in the Windows SDK
    // headers (mmdeviceapi.h / audiopolicy.h).

    [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
    class MMDeviceEnumerator { }

    [Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"),
     InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IMMDeviceEnumerator
    {
        [PreserveSig] int EnumAudioEndpoints(int dataFlow, int stateMask, out IntPtr devices);
        [PreserveSig] int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice endpoint);
        [PreserveSig] int GetDevice(string id, out IMMDevice device);
        [PreserveSig] int RegisterEndpointNotificationCallback(IntPtr client);
        [PreserveSig] int UnregisterEndpointNotificationCallback(IntPtr client);
    }

    [Guid("D666063F-1587-4E43-81F1-B948E807363F"),
     InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IMMDevice
    {
        [PreserveSig] int Activate(ref Guid iid, int clsCtx, IntPtr activationParams,
                     [MarshalAs(UnmanagedType.IUnknown)] out object iface);
        [PreserveSig] int OpenPropertyStore(int access, out IntPtr properties);
        [PreserveSig] int GetId([MarshalAs(UnmanagedType.LPWStr)] out string id);
        [PreserveSig] int GetState(out int state);
    }

    [Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"),
     InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioSessionManager2
    {
        // --- IAudioSessionManager
        [PreserveSig] int GetAudioSessionControl(IntPtr sessionGuid, int streamFlags, out IntPtr sessionControl);
        [PreserveSig] int GetSimpleAudioVolume(IntPtr sessionGuid, int streamFlags, out IntPtr audioVolume);
        // --- IAudioSessionManager2
        [PreserveSig] int GetSessionEnumerator(out IAudioSessionEnumerator sessionEnum);
        [PreserveSig] int RegisterSessionNotification(IntPtr notification);
        [PreserveSig] int UnregisterSessionNotification(IntPtr notification);
        [PreserveSig] int RegisterDuckNotification(string sessionId, IntPtr duckNotification);
        [PreserveSig] int UnregisterDuckNotification(IntPtr duckNotification);
    }

    [Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8"),
     InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioSessionEnumerator
    {
        [PreserveSig] int GetCount(out int count);
        [PreserveSig] int GetSession(int index, out IAudioSessionControl session);
    }

    [Guid("F4B1A599-7266-4319-A8CA-E70ACB11E8CD"),
     InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioSessionControl
    {
        [PreserveSig] int GetState(out int state);
        [PreserveSig] int GetDisplayName([MarshalAs(UnmanagedType.LPWStr)] out string name);
        [PreserveSig] int SetDisplayName(string value, ref Guid eventContext);
        [PreserveSig] int GetIconPath([MarshalAs(UnmanagedType.LPWStr)] out string path);
        [PreserveSig] int SetIconPath(string value, ref Guid eventContext);
        [PreserveSig] int GetGroupingParam(out Guid groupingParam);
        [PreserveSig] int SetGroupingParam(ref Guid over, ref Guid eventContext);
        [PreserveSig] int RegisterAudioSessionNotification(IntPtr newNotifications);
        [PreserveSig] int UnregisterAudioSessionNotification(IntPtr newNotifications);
    }

    [Guid("BFB7FF88-7239-4FC9-8FA2-07C950BE9C6D"),
     InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioSessionControl2
    {
        // --- IAudioSessionControl (must be repeated, in order)
        [PreserveSig] int GetState(out int state);
        [PreserveSig] int GetDisplayName([MarshalAs(UnmanagedType.LPWStr)] out string name);
        [PreserveSig] int SetDisplayName(string value, ref Guid eventContext);
        [PreserveSig] int GetIconPath([MarshalAs(UnmanagedType.LPWStr)] out string path);
        [PreserveSig] int SetIconPath(string value, ref Guid eventContext);
        [PreserveSig] int GetGroupingParam(out Guid groupingParam);
        [PreserveSig] int SetGroupingParam(ref Guid over, ref Guid eventContext);
        [PreserveSig] int RegisterAudioSessionNotification(IntPtr newNotifications);
        [PreserveSig] int UnregisterAudioSessionNotification(IntPtr newNotifications);
        // --- IAudioSessionControl2
        [PreserveSig] int GetSessionIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string id);
        [PreserveSig] int GetSessionInstanceIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string id);
        [PreserveSig] int GetProcessId(out uint pid);
        [PreserveSig] int IsSystemSoundsSession();
        [PreserveSig] int SetDuckingPreference(bool optOut);
    }

    [Guid("87CE5498-68D6-44E5-9215-6DA47EF883D8"),
     InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface ISimpleAudioVolume
    {
        [PreserveSig] int SetMasterVolume(float level, ref Guid eventContext);
        [PreserveSig] int GetMasterVolume(out float level);
        [PreserveSig] int SetMute(bool mute, ref Guid eventContext);
        [PreserveSig] int GetMute(out bool mute);
    }

    const int RENDER = 0;      // EDataFlow.eRender
    const int CONSOLE = 0;     // ERole.eConsole
    const int CLSCTX_ALL = 23;
    const int STATE_EXPIRED = 2;

    static Guid IID_IAudioSessionManager2 = new Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F");
    static Guid EMPTY = Guid.Empty;

    // ---- session enumeration --------------------------------------------

    class Session
    {
        public uint Pid;
        public string Process;      // "chrome" -- bare, no extension
        public string Display;      // friendlier label where one is available
        public int Volume;          // 0-100
        public bool Muted;
        public bool IsSystem;
        public ISimpleAudioVolume Volumes;
    }

    static IAudioSessionEnumerator OpenSessions()
    {
        var enumerator = (IMMDeviceEnumerator)(new MMDeviceEnumerator());
        IMMDevice device;
        if (enumerator.GetDefaultAudioEndpoint(RENDER, CONSOLE, out device) != 0 || device == null)
            return null;

        object raw;
        if (device.Activate(ref IID_IAudioSessionManager2, CLSCTX_ALL, IntPtr.Zero, out raw) != 0 || raw == null)
            return null;

        IAudioSessionEnumerator sessions;
        if (((IAudioSessionManager2)raw).GetSessionEnumerator(out sessions) != 0)
            return null;
        return sessions;
    }

    static List<Session> Enumerate()
    {
        var result = new List<Session>();
        var sessions = OpenSessions();
        if (sessions == null) return result;

        int count;
        if (sessions.GetCount(out count) != 0) return result;

        for (int i = 0; i < count; i++)
        {
            // One bad session must never abort the enumeration -- see the
            // fail-soft contract at the top of this file.
            try
            {
                IAudioSessionControl control;
                if (sessions.GetSession(i, out control) != 0 || control == null) continue;

                var control2 = control as IAudioSessionControl2;
                if (control2 == null) continue;

                int state;
                if (control2.GetState(out state) == 0 && state == STATE_EXPIRED) continue;

                uint pid;
                if (control2.GetProcessId(out pid) != 0) continue;
                bool isSystem = control2.IsSystemSoundsSession() == 0;

                var volumes = control as ISimpleAudioVolume;
                if (volumes == null) continue;

                float level;
                bool muted;
                if (volumes.GetMasterVolume(out level) != 0) continue;
                volumes.GetMute(out muted);

                string proc = isSystem ? "System" : ProcessName(pid);
                if (proc == null) continue;   // process died mid-enumeration

                result.Add(new Session
                {
                    Pid = isSystem ? 0u : pid,
                    Process = proc,
                    Display = isSystem ? "System Sounds" : FriendlyName(control2, proc, pid),
                    Volume = (int)Math.Round(level * 100f),
                    Muted = muted,
                    IsSystem = isSystem,
                    Volumes = volumes,
                });
            }
            catch { /* skip this session */ }
        }
        return result;
    }

    static string ProcessName(uint pid)
    {
        try { return Process.GetProcessById((int)pid).ProcessName; }
        catch { return null; }
    }

    // The session's own DisplayName is usually EMPTY for ordinary desktop apps
    // (it is mostly set by UWP/store apps), so fall back to the process's
    // FileDescription -- "Google Chrome" for chrome.exe -- and finally to the
    // bare process name. Never returns null.
    static string FriendlyName(IAudioSessionControl2 control, string proc, uint pid)
    {
        try
        {
            string name;
            if (control.GetDisplayName(out name) == 0 && !string.IsNullOrEmpty(name) && !name.StartsWith("@"))
                return name;
        }
        catch { }
        try
        {
            var p = Process.GetProcessById((int)pid);
            var desc = p.MainModule.FileVersionInfo.FileDescription;
            if (!string.IsNullOrEmpty(desc)) return desc;
        }
        catch { }
        return proc;
    }

    // ---- icon extraction -------------------------------------------------

    static string IconBase64(uint pid)
    {
        try
        {
            var path = Process.GetProcessById((int)pid).MainModule.FileName;
            using (var icon = Icon.ExtractAssociatedIcon(path))
            {
                if (icon == null) return null;
                using (var bmp = icon.ToBitmap())
                using (var ms = new MemoryStream())
                {
                    bmp.Save(ms, System.Drawing.Imaging.ImageFormat.Png);
                    return Convert.ToBase64String(ms.ToArray());
                }
            }
        }
        catch { return null; }
    }

    // ---- JSON (hand-rolled; no serializer dependency) --------------------

    static string Esc(string s)
    {
        if (s == null) return "";
        var sb = new StringBuilder(s.Length + 8);
        foreach (char c in s)
        {
            switch (c)
            {
                case '"':  sb.Append("\\\""); break;
                case '\\': sb.Append("\\\\"); break;
                case '\b': sb.Append("\\b");  break;
                case '\f': sb.Append("\\f");  break;
                case '\n': sb.Append("\\n");  break;
                case '\r': sb.Append("\\r");  break;
                case '\t': sb.Append("\\t");  break;
                default:
                    if (c < ' ') sb.Append("\\u").Append(((int)c).ToString("x4"));
                    else sb.Append(c);
                    break;
            }
        }
        return sb.ToString();
    }

    static int List(bool withIcons)
    {
        var sessions = Enumerate();
        var sb = new StringBuilder();
        sb.Append("{\"sessions\":[");
        bool first = true;
        foreach (var s in sessions)
        {
            if (!first) sb.Append(',');
            first = false;
            sb.Append("{\"pid\":").Append(s.Pid.ToString(CultureInfo.InvariantCulture));
            sb.Append(",\"process\":\"").Append(Esc(s.Process)).Append('"');
            sb.Append(",\"display\":\"").Append(Esc(s.Display)).Append('"');
            sb.Append(",\"volume\":").Append(s.Volume.ToString(CultureInfo.InvariantCulture));
            sb.Append(",\"muted\":").Append(s.Muted ? "true" : "false");
            sb.Append(",\"system\":").Append(s.IsSystem ? "true" : "false");
            if (withIcons && !s.IsSystem)
            {
                var icon = IconBase64(s.Pid);
                if (icon != null) sb.Append(",\"icon\":\"").Append(icon).Append('"');
            }
            sb.Append('}');
        }
        sb.Append("]}");
        Console.Out.Write(sb.ToString());
        return 0;
    }

    static int Apply(uint pid, Action<ISimpleAudioVolume> act)
    {
        foreach (var s in Enumerate())
        {
            if (s.Pid != pid) continue;
            try { act(s.Volumes); return 0; }
            catch { return 1; }
        }
        return 1;   // no such session
    }

    static int Main(string[] argv)
    {
        try
        {
            if (argv.Length == 1 && argv[0] == "list") return List(true);
            if (argv.Length == 2 && argv[0] == "list" && argv[1] == "--no-icons") return List(false);

            if (argv.Length == 3 && argv[0] == "set")
            {
                uint pid; int vol;
                if (!uint.TryParse(argv[1], out pid)) return 2;
                if (!int.TryParse(argv[2], NumberStyles.Integer, CultureInfo.InvariantCulture, out vol)) return 2;
                if (vol < 0) vol = 0;
                if (vol > 100) vol = 100;
                float level = vol / 100f;
                return Apply(pid, v => { v.SetMasterVolume(level, ref EMPTY); });
            }

            if (argv.Length == 3 && argv[0] == "mute")
            {
                uint pid;
                if (!uint.TryParse(argv[1], out pid)) return 2;
                if (argv[2] != "0" && argv[2] != "1") return 2;
                bool mute = argv[2] == "1";
                return Apply(pid, v => { v.SetMute(mute, ref EMPTY); });
            }

            return 2;   // unrecognised invocation -- print nothing
        }
        catch
        {
            return 1;
        }
    }
}
