// Rebuild after editing:
//   C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe /nologo /target:exe ^
//     /optimize+ /out:window-list.exe window-list.cs
//
// Enumerates the windows a taskbar should show, and focuses one on request.
//
// Direct user feedback: "the taskbar should also show hidden and ignored apps
// as well". The dock was built on komorebi's provider, which by definition
// cannot satisfy that: komorebi reports the windows it MANAGES on the focused
// workspace, so anything on another workspace is absent, and anything matched
// by ~/komorebi.json's ignore_rules (PowerToys, Taskmgr, Lively, and the rest)
// is absent too -- it is not merely hidden from the list, it is not in
// komorebi's model at all. The only source that knows about those is the OS.
//
// Commands, matching the tight argsRegex registered in zpack.json:
//
//   list          -> JSON of every alt-tab-able top-level window
//   focus <hwnd>  -> bring that window forward, restoring it if minimized
//
// THE FILTER is the whole substance of this tool, and it is the standard
// "would Alt-Tab show this?" test rather than anything invented here. A window
// qualifies when it is visible, has a title, owns itself, is not a tool
// window, and is not DWM-cloaked. That last one matters more than it looks:
// UWP apps leave permanently-invisible host windows lying around that pass
// every other check, so without the cloak test a taskbar built on this shows
// half a dozen phantom entries with names like "Windows Shell Experience
// Host".
//
// FAIL-SOFT, like every other helper here: a window that cannot be read is
// skipped rather than aborting the enumeration, and any hard failure exits
// non-zero having printed nothing, which the caller treats as "no windows".

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Text;

static class WindowList
{
    [DllImport("user32.dll")]
    static extern bool EnumWindows(EnumWindowsProc callback, IntPtr param);
    delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr param);

    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr hWnd);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    static extern int GetWindowTextW(IntPtr hWnd, StringBuilder text, int count);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    static extern int GetWindowTextLengthW(IntPtr hWnd);
    [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr hWnd, uint cmd);
    [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr hWnd, int index);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr hWnd, int cmd);
    [DllImport("user32.dll")] static extern bool AttachThreadInput(uint attach, uint to, bool fAttach);
    [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();

    [DllImport("dwmapi.dll")]
    static extern int DwmGetWindowAttribute(IntPtr hWnd, int attr, out int value, int size);

    const uint GW_OWNER = 4;
    const int GWL_EXSTYLE = -20;
    const int WS_EX_TOOLWINDOW = 0x00000080;
    const int WS_EX_APPWINDOW = 0x00040000;
    const int DWMWA_CLOAKED = 14;
    const int SW_RESTORE = 9;

    static bool IsCloaked(IntPtr hWnd)
    {
        try
        {
            int cloaked;
            if (DwmGetWindowAttribute(hWnd, DWMWA_CLOAKED, out cloaked, sizeof(int)) != 0) return false;
            return cloaked != 0;
        }
        catch { return false; }
    }

    // The Alt-Tab test. Order matters only for cost: the cheap checks come
    // first so the DWM call runs for the few windows that survive them.
    static bool IsTaskbarWindow(IntPtr hWnd)
    {
        if (!IsWindowVisible(hWnd)) return false;
        if (GetWindowTextLengthW(hWnd) == 0) return false;

        int ex = GetWindowLong(hWnd, GWL_EXSTYLE);
        // WS_EX_APPWINDOW forces a window onto the taskbar even when the other
        // rules would exclude it, so it is honoured before they are applied.
        bool forced = (ex & WS_EX_APPWINDOW) != 0;
        if (!forced)
        {
            if ((ex & WS_EX_TOOLWINDOW) != 0) return false;
            if (GetWindow(hWnd, GW_OWNER) != IntPtr.Zero) return false;
        }
        if (IsCloaked(hWnd)) return false;
        return true;
    }

    class Win
    {
        public IntPtr Handle;
        public uint Pid;
        public string Exe;
        public string Title;
        public bool Minimized;
    }

    static List<Win> Enumerate()
    {
        var found = new List<Win>();
        var self = Process.GetCurrentProcess().Id;

        EnumWindows((hWnd, _) =>
        {
            try
            {
                if (!IsTaskbarWindow(hWnd)) return true;

                uint pid;
                GetWindowThreadProcessId(hWnd, out pid);
                if (pid == 0 || pid == (uint)self) return true;

                string exe = null;
                try { exe = Process.GetProcessById((int)pid).ProcessName + ".exe"; }
                catch { return true; }   // process died mid-enumeration

                // The bar, the frame, the flyouts and the dock are all windows
                // too. A taskbar listing its own shell would be silly, and the
                // flyouts come and go, which would make the row flicker.
                if (string.Equals(exe, "zebar.exe", StringComparison.OrdinalIgnoreCase)) return true;

                int len = GetWindowTextLengthW(hWnd);
                var sb = new StringBuilder(len + 1);
                GetWindowTextW(hWnd, sb, sb.Capacity);

                found.Add(new Win
                {
                    Handle = hWnd,
                    Pid = pid,
                    Exe = exe,
                    Title = sb.ToString(),
                    Minimized = IsIconic(hWnd),
                });
            }
            catch { /* skip this window */ }
            return true;
        }, IntPtr.Zero);

        return found;
    }

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

    static int List()
    {
        var foreground = GetForegroundWindow();
        var sb = new StringBuilder();
        sb.Append("{\"windows\":[");
        bool first = true;
        foreach (var w in Enumerate())
        {
            if (!first) sb.Append(',');
            first = false;
            sb.Append("{\"hwnd\":").Append(w.Handle.ToInt64().ToString(CultureInfo.InvariantCulture));
            sb.Append(",\"pid\":").Append(w.Pid.ToString(CultureInfo.InvariantCulture));
            sb.Append(",\"exe\":\"").Append(Esc(w.Exe)).Append('"');
            sb.Append(",\"title\":\"").Append(Esc(w.Title)).Append('"');
            sb.Append(",\"minimized\":").Append(w.Minimized ? "true" : "false");
            sb.Append(",\"focused\":").Append(w.Handle == foreground ? "true" : "false");
            sb.Append('}');
        }
        sb.Append("]}");
        Console.Out.Write(sb.ToString());
        return 0;
    }

    // SetForegroundWindow refuses when the calling process does not own the
    // foreground -- which is always the case here, since this is a short-lived
    // helper launched by a widget. Attaching to the foreground thread's input
    // queue for the duration is the long-standing way round that; without it
    // the call silently does nothing and the taskbar button appears dead.
    static int Focus(long handle)
    {
        var hWnd = new IntPtr(handle);
        try
        {
            if (IsIconic(hWnd)) ShowWindow(hWnd, SW_RESTORE);

            var foreground = GetForegroundWindow();
            // No discards: this compiles under the .NET Framework csc, which is
            // C# 5 and rejects `out _`.
            uint ignoredPid;
            uint targetThread = GetWindowThreadProcessId(hWnd, out ignoredPid);
            uint foreThread = GetWindowThreadProcessId(foreground, out ignoredPid);
            uint thisThread = GetCurrentThreadId();

            bool attachedFore = false, attachedTarget = false;
            if (foreThread != thisThread) attachedFore = AttachThreadInput(thisThread, foreThread, true);
            if (targetThread != thisThread) attachedTarget = AttachThreadInput(thisThread, targetThread, true);

            bool ok = SetForegroundWindow(hWnd);

            if (attachedFore) AttachThreadInput(thisThread, foreThread, false);
            if (attachedTarget) AttachThreadInput(thisThread, targetThread, false);

            return ok ? 0 : 1;
        }
        catch { return 1; }
    }

    static int Main(string[] argv)
    {
        try
        {
            if (argv.Length == 1 && argv[0] == "list") return List();
            if (argv.Length == 2 && argv[0] == "focus")
            {
                long handle;
                if (!long.TryParse(argv[1], NumberStyles.Integer, CultureInfo.InvariantCulture, out handle)) return 2;
                return Focus(handle);
            }
            return 2;
        }
        catch { return 1; }
    }
}
