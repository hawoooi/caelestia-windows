// Rebuild after editing:
//   C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe /nologo /target:winexe \
//     /optimize+ /out:launcher-key.exe launcher-key.cs
//
// Opens the Caelestia launcher when the Windows key is TAPPED on its own,
// while leaving every Win+<key> combination completely untouched.
//
// Built as /target:winexe, not exe, so it has no console window. It runs for
// the whole session -- it is a hotkey daemon, not a probe -- and it is the one
// helper in this pack that must NOT be reaped alongside zebar (see
// Restart-ZebarWidgets). Being started outside zebar is also what keeps it
// clear of the port-6124 trap: it never inherits zebar's listening socket,
// because zebar never spawns it.
//
// **Why a low-level hook and not whkd.** whkd 0.2.10 parses modifier+key; it
// cannot bind a bare modifier at all. AutoHotkey is not installed. So the only
// route to the lone Windows key is WH_KEYBOARD_LL.
//
// **The hard part is not detecting the tap, it is suppressing the Start menu
// without breaking anything else.**
//
// Explorer opens Start on the Win key RELEASE, and only if no other key was
// pressed in between. Three approaches, two of them wrong:
//
//   * Swallow the Win KEYDOWN. Kills every Win+<key> combination, including
//     the ten komorebi bindings in ~/.config/whkdrc. Unacceptable.
//   * Swallow the Win KEYUP. The system then still believes Win is HELD, so
//     every subsequent keystroke becomes a Win chord. Much worse than the
//     problem it solves.
//   * Let both through, and inject a harmless keystroke just before the
//     release. Tried first, and it does NOT work: keybd_event posts
//     asynchronously, so returning from the hook lets the real release reach
//     Explorer before the injected key does. Measured -- Start opened anyway.
//
// What works is the fourth option: SWALLOW the bare release, then synthesise
// the whole tail ourselves in a controlled order -- harmless key down, harmless
// key up, then the Windows key release. Explorer sees a combination and stays
// shut, and because we send the release ourselves the key state is still left
// correctly up, which is what made swallowing alone unusable.
//
// Every Win+<key> combination is untouched by all of this: it only ever runs
// when no other key was pressed while Win was held.
//
// The harmless key is VK_NONAME (0xFC), which exists precisely to be a keypress
// that means nothing. It has no Win+ binding to collide with, unlike the
// VK_CONTROL that is often used for this.
//
// The hook callback itself does no work beyond bookkeeping: it signals a
// worker thread and returns. A slow low-level keyboard hook makes the whole
// machine's typing stutter, and Windows silently unhooks one that exceeds
// LowLevelHooksTimeout.

using System;
using System.Runtime.InteropServices;
using System.Threading;

static class LauncherKey
{
    const int WH_KEYBOARD_LL = 13;
    const int WM_KEYDOWN = 0x0100;
    const int WM_KEYUP = 0x0101;
    const int WM_SYSKEYDOWN = 0x0104;
    const int WM_SYSKEYUP = 0x0105;

    const int VK_LWIN = 0x5B;
    const int VK_RWIN = 0x5C;
    const int VK_NONAME = 0xFC;

    const uint KEYEVENTF_KEYUP = 0x0002;

    // Stamped into dwExtraInfo on every key this process synthesises, so the
    // hook can recognise its OWN events and nothing else.
    //
    // The first version skipped anything with LLKHF_INJECTED set instead. That
    // is wrong twice over: it makes the Windows key inert for anyone using a
    // remapper, a macro keyboard or any other software that synthesises input
    // -- and it silently defeats testing, because a synthesised Win tap is
    // exactly how this gets exercised without a human at the keyboard. Both
    // failures look identical to "the hook is broken".
    static readonly UIntPtr SELF_TAG = (UIntPtr)0x43414C55;   // 'CALU'

    // The window Zebar gives the launcher widget. Zebar names every widget
    // window "Zebar - <pack> / <widget>", so nothing has to be renamed -- and
    // the name survives restarts and repositioning, which a rect match would
    // not.
    const string LAUNCHER_TITLE = "Zebar - caelestia / launcher";

    [StructLayout(LayoutKind.Sequential)]
    struct KBDLLHOOKSTRUCT
    {
        public uint vkCode;
        public uint scanCode;
        public uint flags;
        public uint time;
        public IntPtr dwExtraInfo;
    }

    delegate IntPtr HookProc(int nCode, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern IntPtr SetWindowsHookExW(int idHook, HookProc lpfn, IntPtr hMod, uint dwThreadId);
    [DllImport("user32.dll", SetLastError = true)]
    static extern bool UnhookWindowsHookEx(IntPtr hhk);
    [DllImport("user32.dll")]
    static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    static extern IntPtr GetModuleHandleW(string name);
    [DllImport("user32.dll")]
    static extern bool GetMessageW(out MSG msg, IntPtr hWnd, uint min, uint max);
    [DllImport("user32.dll")]
    static extern bool TranslateMessage(ref MSG msg);
    [DllImport("user32.dll")]
    static extern IntPtr DispatchMessageW(ref MSG msg);
    [DllImport("user32.dll")]
    static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    static extern IntPtr FindWindowW(string cls, string name);
    [DllImport("user32.dll")]
    static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")]
    static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")]
    static extern bool BringWindowToTop(IntPtr h);
    [DllImport("user32.dll")]
    static extern IntPtr SetFocus(IntPtr h);
    [DllImport("user32.dll")]
    static extern bool AttachThreadInput(uint attachTo, uint attachFrom, bool attach);
    [DllImport("user32.dll")]
    static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("kernel32.dll")]
    static extern uint GetCurrentThreadId();
    [DllImport("user32.dll")]
    static extern bool IsWindow(IntPtr h);

    [StructLayout(LayoutKind.Sequential)]
    struct MSG { public IntPtr hwnd; public uint message; public IntPtr wParam, lParam; public uint time; public int ptx, pty; }

    static IntPtr _hook = IntPtr.Zero;
    static HookProc _proc;                       // held in a field so the GC cannot collect the delegate
    static volatile bool _winDown;
    static volatile bool _comboUsed;
    static readonly AutoResetEvent _trigger = new AutoResetEvent(false);
    // The window that had focus before the launcher took it, so a second tap
    // gives it back -- which is what makes the Windows key a toggle rather
    // than a one-way trip.
    static IntPtr _previous = IntPtr.Zero;

    static int Main(string[] args)
    {
        var worker = new Thread(WorkerLoop);
        worker.IsBackground = true;
        worker.Start();

        _proc = HookCallback;
        _hook = SetWindowsHookExW(WH_KEYBOARD_LL, _proc, GetModuleHandleW(null), 0);
        if (_hook == IntPtr.Zero) return 1;

        // A low-level hook needs a message pump on the thread that installed
        // it: Windows delivers hook callbacks through that thread's queue.
        MSG msg;
        while (GetMessageW(out msg, IntPtr.Zero, 0, 0))
        {
            TranslateMessage(ref msg);
            DispatchMessageW(ref msg);
        }

        UnhookWindowsHookEx(_hook);
        return 0;
    }

    static IntPtr HookCallback(int nCode, IntPtr wParam, IntPtr lParam)
    {
        if (nCode < 0) return CallNextHookEx(_hook, nCode, wParam, lParam);

        var info = (KBDLLHOOKSTRUCT)Marshal.PtrToStructure(lParam, typeof(KBDLLHOOKSTRUCT));
        int msg = wParam.ToInt32();
        bool isDown = msg == WM_KEYDOWN || msg == WM_SYSKEYDOWN;
        bool isUp = msg == WM_KEYUP || msg == WM_SYSKEYUP;
        bool isWin = info.vkCode == VK_LWIN || info.vkCode == VK_RWIN;
        bool ours = info.dwExtraInfo == (IntPtr)(long)(ulong)SELF_TAG;

        // Ignore only OUR OWN synthesised keys -- the VK_NONAME and the
        // Windows-key release below. Without this they would count as the
        // "other key" and cancel the very tap they exist to permit. Every
        // other event, injected or not, is handled normally.
        if (ours) return CallNextHookEx(_hook, nCode, wParam, lParam);

        if (isWin && isDown)
        {
            // Auto-repeat re-fires keydown while held; only the first one
            // starts a candidate tap, and it must not clear _comboUsed after
            // a combination has already begun.
            if (!_winDown) { _winDown = true; _comboUsed = false; }
        }
        else if (isWin && isUp)
        {
            bool bare = _winDown && !_comboUsed;
            _winDown = false;
            _comboUsed = false;
            if (bare)
            {
                // Swallow this release and send the tail ourselves, in an order
                // we control: harmless key down, harmless key up, then the
                // Windows key release. Letting the real release through and
                // injecting beforehand does not work -- keybd_event is
                // asynchronous, so Explorer sees the release first and opens
                // Start anyway.
                byte win = (byte)info.vkCode;
                keybd_event(VK_NONAME, 0, 0, SELF_TAG);
                keybd_event(VK_NONAME, 0, KEYEVENTF_KEYUP, SELF_TAG);
                keybd_event(win, 0, KEYEVENTF_KEYUP, SELF_TAG);
                _trigger.Set();
                return (IntPtr)1;
            }
        }
        else if (isDown && _winDown)
        {
            // Any other key while Win is held makes this a combination, not a
            // tap -- so Win+E, Win+D and every komorebi binding are untouched.
            _comboUsed = true;
        }

        return CallNextHookEx(_hook, nCode, wParam, lParam);
    }

    // Everything slow happens here, off the hook callback. A low-level
    // keyboard hook that takes too long makes the whole machine's typing
    // stutter, and Windows will silently unhook one that exceeds
    // LowLevelHooksTimeout.
    static void WorkerLoop()
    {
        for (;;)
        {
            _trigger.WaitOne();
            try { Toggle(); }
            catch (Exception) { /* a hotkey daemon must never die on one bad press */ }
        }
    }

    static void Toggle()
    {
        IntPtr launcher = FindWindowW(null, LAUNCHER_TITLE);
        if (launcher == IntPtr.Zero) return;      // widget not running; do nothing rather than guess

        IntPtr fg = GetForegroundWindow();
        if (fg == launcher)
        {
            // Second tap: hand focus back to whatever had it. The launcher
            // closes itself on blur, so this is all "close" needs to be.
            if (_previous != IntPtr.Zero && IsWindow(_previous) && _previous != launcher)
                Focus(_previous);
            return;
        }

        _previous = fg;
        Focus(launcher);
    }

    // SetForegroundWindow is allowed to silently no-op for a process that does
    // not own the foreground. Attaching to the current foreground thread's
    // input queue first is the documented way around that.
    static void Focus(IntPtr h)
    {
        IntPtr fg = GetForegroundWindow();
        uint pid;
        uint tForeground = GetWindowThreadProcessId(fg, out pid);
        uint tSelf = GetCurrentThreadId();
        bool attached = tForeground != 0 && tForeground != tSelf
            && AttachThreadInput(tForeground, tSelf, true);
        try
        {
            BringWindowToTop(h);
            SetForegroundWindow(h);
            SetFocus(h);
        }
        finally
        {
            if (attached) AttachThreadInput(tForeground, tSelf, false);
        }
    }
}
