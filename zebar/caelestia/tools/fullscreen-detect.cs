// Rebuild after editing:
//   C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe /nologo /target:exe \
//     /optimize+ /out:fullscreen-detect.exe fullscreen-detect.cs
//
// Prints "1" when the current foreground window looks like it's showing
// fullscreen content -- its own window rect exactly matches the full bounds
// of the monitor it's on -- AND it isn't one of this pack's own zebar.exe
// windows (the bar, the four corner arcs, the three edge strips all run as
// the SAME zebar.exe process, so excluding by owning-process-name excludes
// every one of them in a single check). Prints nothing otherwise, including
// on any internal error -- see fullscreen.js's own comment for why "no
// output" must mean "not fullscreen" (fail soft: stay visible).
//
// Zebar has no built-in fullscreen awareness (checked zebar.exe --help,
// zpack-schema.json and settings-schema.json -- see docs/zebar-bar.md) --
// this is how the desktop frame widgets detect it themselves. Modelled on
// the existing ~/.config/yasb/scripts/vesktop-unread.cs helper (same
// EnumWindows/shellExec-via-stdout pattern), but this one only needs the
// SINGLE foreground window, not an enumeration of every window on the
// desktop.
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;

class FullscreenDetect
{
    [DllImport("user32.dll")]
    static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);

    [DllImport("user32.dll")]
    static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);

    [DllImport("user32.dll")]
    static extern bool IsIconic(IntPtr hWnd);

    [DllImport("user32.dll")]
    static extern IntPtr MonitorFromWindow(IntPtr hWnd, uint dwFlags);

    [DllImport("user32.dll", CharSet = CharSet.Auto)]
    static extern bool GetMonitorInfo(IntPtr hMonitor, ref MONITORINFO lpmi);

    const uint MONITOR_DEFAULTTONEAREST = 2;

    [StructLayout(LayoutKind.Sequential)]
    struct RECT { public int Left, Top, Right, Bottom; }

    [StructLayout(LayoutKind.Sequential)]
    struct MONITORINFO
    {
        public uint cbSize;
        public RECT rcMonitor;
        public RECT rcWork;
        public uint dwFlags;
    }

    static void Main()
    {
        try
        {
            IntPtr hWnd = GetForegroundWindow();
            if (hWnd == IntPtr.Zero) return;
            if (IsIconic(hWnd)) return; // minimized -- never "fullscreen"

            uint pid;
            GetWindowThreadProcessId(hWnd, out pid);
            using (var proc = Process.GetProcessById((int)pid))
            {
                // Excludes every widget this pack runs (bar, corners x4,
                // edges x3) in one check -- they all share this one exe name.
                if (string.Equals(proc.ProcessName, "zebar", StringComparison.OrdinalIgnoreCase))
                    return;
            }

            RECT winRect;
            if (!GetWindowRect(hWnd, out winRect)) return;

            IntPtr hMon = MonitorFromWindow(hWnd, MONITOR_DEFAULTTONEAREST);
            if (hMon == IntPtr.Zero) return;

            var mi = new MONITORINFO();
            mi.cbSize = (uint)Marshal.SizeOf(typeof(MONITORINFO));
            if (!GetMonitorInfo(hMon, ref mi)) return;

            bool coversMonitor =
                winRect.Left == mi.rcMonitor.Left &&
                winRect.Top == mi.rcMonitor.Top &&
                winRect.Right == mi.rcMonitor.Right &&
                winRect.Bottom == mi.rcMonitor.Bottom;

            if (!coversMonitor) return;

            var bytes = new UTF8Encoding(false).GetBytes("1");
            using (var stdout = Console.OpenStandardOutput())
                stdout.Write(bytes, 0, bytes.Length);
        }
        catch
        {
            // Any failure (AccessDenied on GetProcessById for a
            // higher-privilege foreground window, a process exiting between
            // the pid lookup and GetProcessById, etc.) prints nothing,
            // exactly like the "not fullscreen" case -- fail soft, per this
            // helper's own contract.
        }
    }
}
