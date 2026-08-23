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

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    static extern int GetClassNameW(IntPtr hWnd, System.Text.StringBuilder name, int count);

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

            // THE DESKTOP IS NOT A FULLSCREEN APP.
            //
            // Direct user report: "when i click on the desktop, everything
            // dissappears". This check used to be rect-only -- does the
            // foreground window cover the monitor? -- and the desktop covers
            // it exactly. Clicking the wallpaper makes Progman (or WorkerW,
            // the layer Wallpaper Engine paints into) the foreground window,
            // so the whole shell hid itself behind the wallpaper.
            //
            // Class is the reliable discriminator, not size: these windows are
            // ALWAYS monitor-sized, so no rect test can tell them from a game.
            var cls = new System.Text.StringBuilder(256);
            GetClassNameW(hWnd, cls, cls.Capacity);
            string className = cls.ToString();
            if (className == "Progman" ||          // the desktop
                className == "WorkerW" ||          // wallpaper host layer
                className == "Shell_TrayWnd" ||    // taskbar
                className == "Shell_SecondaryTrayWnd")
                return;

            // THE TASK SWITCHER IS NOT A FULLSCREEN APP EITHER.
            //
            // Direct user report: "when i alt tab, why does it hide my zebar
            // widgets?" Windows 11 hosts Alt+Tab and Task View in an
            // explorer.exe window of class XamlExplorerHostIslandWindow, and
            // on this machine it measures exactly 0,0 2560x1440 -- a perfect
            // monitor cover, so it satisfies the containment test below and
            // trips the gate the moment Alt is held down. The whole frame then
            // vanishes for as long as the switcher is up, which is precisely
            // when you are looking at the screen.
            //
            // Excluded by CLASS, not by process: explorer.exe also owns real
            // File Explorer windows, and blanket-excluding the process would
            // silently stop a genuinely fullscreen one from counting. This is
            // the same reasoning that made Progman/WorkerW class checks rather
            // than a shell-process check, and the same reasoning that keeps
            // TextInputHost a process check rather than a CoreWindow class
            // check further down.
            //
            // ForegroundStaging is the transition window Windows parks the
            // outgoing app in during the switch. It measures 0x0 while idle,
            // so it cannot trip the test in that state -- but it is monitor
            // sized mid-animation, which is exactly when it is foreground.
            //
            // MultitaskingViewFrame and TaskSwitcherWnd/TaskSwitcherOverlayWnd
            // are the Windows 10 era equivalents. Neither exists on this
            // machine (enumerated, only the two above were found); they are
            // listed defensively because they cost one string compare each and
            // would reproduce this exact bug on a different Windows build.
            if (className == "XamlExplorerHostIslandWindow" ||  // Win11 Alt+Tab / Task View
                className == "ForegroundStaging" ||             // switch transition host
                className == "MultitaskingViewFrame" ||         // legacy Task View
                className == "TaskSwitcherWnd" ||               // legacy Alt+Tab
                className == "TaskSwitcherOverlayWnd")
                return;

            uint pid;
            GetWindowThreadProcessId(hWnd, out pid);
            using (var proc = Process.GetProcessById((int)pid))
            {
                // Excludes every widget this pack runs (bar, corners, edges,
                // flyouts, dock) in one check -- they share one exe name.
                if (string.Equals(proc.ProcessName, "zebar", StringComparison.OrdinalIgnoreCase))
                    return;

                // Wallpaper Engine's renderer is permanently monitor-sized by
                // definition. Whichever binary is live on this machine
                // (wallpaper32 or wallpaper64 -- both exist, see CLAUDE.md) it
                // must never count as a fullscreen app.
                if (proc.ProcessName.StartsWith("wallpaper", StringComparison.OrdinalIgnoreCase))
                    return;

                // The IME host also owns a permanently monitor-sized window
                // (class Windows.UI.Core.CoreWindow, found while enumerating
                // what actually covers this monitor). Excluded by PROCESS, not
                // by that class -- the class itself belongs to every UWP app,
                // and a genuinely fullscreen UWP game must still count.
                if (string.Equals(proc.ProcessName, "TextInputHost", StringComparison.OrdinalIgnoreCase))
                    return;
            }

            RECT winRect;
            if (!GetWindowRect(hWnd, out winRect)) return;

            IntPtr hMon = MonitorFromWindow(hWnd, MONITOR_DEFAULTTONEAREST);
            if (hMon == IntPtr.Zero) return;

            var mi = new MONITORINFO();
            mi.cbSize = (uint)Marshal.SizeOf(typeof(MONITORINFO));
            if (!GetMonitorInfo(hMon, ref mi)) return;

            // COVERS the monitor, not exactly equals it.
            //
            // Exact equality was the original test and it is too strict. A
            // borderless-fullscreen window is routinely a pixel or two larger
            // than the monitor, or is positioned at -1,-1 to hide its frame,
            // and every one of those returned "not fullscreen" -- the hover
            // widgets then opened over the game, which is what was reported.
            //
            // Containment is the honest test: a window that covers every pixel
            // of the monitor is fullscreen on it whether or not it stops there.
            // Nothing komorebi manages can match it -- tiled windows are inset
            // by the workspace padding -- and the classes and processes that
            // are permanently monitor-sized are already excluded above.
            bool coversMonitor =
                winRect.Left <= mi.rcMonitor.Left &&
                winRect.Top <= mi.rcMonitor.Top &&
                winRect.Right >= mi.rcMonitor.Right &&
                winRect.Bottom >= mi.rcMonitor.Bottom;

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
