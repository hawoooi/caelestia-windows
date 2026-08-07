// Rebuild after editing:
//   C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe /nologo /target:exe \
//     /optimize+ /out:app-icon.exe /r:System.Drawing.dll app-icon.cs
//
// Prints a base64-encoded PNG of the running application's own icon to
// stdout -- the real icon Explorer/Alt-Tab shows for that exe, not a
// hand-mapped Font Awesome brand glyph (a brand-glyph table covers Chrome
// and Discord, then falls over on WezTerm/foobar2000/everything else on
// this machine -- see the brief this tool shipped under). Prints nothing
// and exits non-zero on ANY failure -- entries/activeWindow.js's caller
// treats "no output" as "fall back to the neutral window-maximize glyph",
// exactly matching fullscreen-detect.exe's own fail-soft contract
// (docs/zebar-bar.md).
//
// Input is a single argument: an EXE NAME (e.g. "chrome.exe"), never a
// path. The komorebi provider's KomorebiWindow.exe field is a bare name,
// confirmed against a live `komorebic state` capture and zebar's own
// dist/index.d.ts (docs/zebar-bar.md, "The komorebi provider's
// window-focus shape"). This tool resolves that name to a real path
// itself, by finding a RUNNING process with that name and reading its own
// MainModule.FileName -- it does not assume any fixed install directory.
// This pack has already been bitten twice by assuming a provider field's
// shape without checking it first (the invented `isFocused` on
// KomorebiWindow; the CLI-vs-provider layout spelling mismatch -- see
// docs/zebar-bar.md) -- resolving via a live process, rather than guessing
// a Program Files/AppData layout, avoids a third.
//
// Extraction uses Icon.ExtractAssociatedIcon, the same shell-standard icon
// Explorer itself shows (native resolution, typically 32x32) -- plenty for
// this bar's ~18px CSS-rendered glyph (CSS scales it down; see style.css's
// --icon-size). No SHGetImageList/jumbo-icon COM interop was judged worth
// the added risk for a target this small.
using System;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Text;

class AppIcon
{
    static int Main(string[] args)
    {
        try
        {
            if (args.Length != 1) return 1;
            string exeName = args[0].Trim();
            if (exeName.Length == 0) return 1;

            string processName = exeName.EndsWith(".exe", StringComparison.OrdinalIgnoreCase)
                ? exeName.Substring(0, exeName.Length - 4)
                : exeName;
            if (processName.Length == 0) return 1;

            string path = ResolvePath(processName);
            if (string.IsNullOrEmpty(path) || !File.Exists(path)) return 1;

            using (var icon = Icon.ExtractAssociatedIcon(path))
            {
                if (icon == null) return 1;
                using (var bmp = icon.ToBitmap())
                using (var ms = new MemoryStream())
                {
                    bmp.Save(ms, ImageFormat.Png);
                    string b64 = Convert.ToBase64String(ms.ToArray());
                    var bytes = new UTF8Encoding(false).GetBytes(b64);
                    using (var stdout = Console.OpenStandardOutput())
                        stdout.Write(bytes, 0, bytes.Length);
                }
            }
            return 0;
        }
        catch
        {
            // Any failure (access denied reading a higher-privilege
            // process's module, the process exiting mid-lookup, a corrupt
            // or missing icon resource, ...) -- print nothing and fail
            // non-zero, exactly per this tool's documented contract.
            return 1;
        }
    }

    // Finds a currently running process named `processName` (no ".exe")
    // and returns its own executable path, or null if none is found or
    // every match is inaccessible. Several windows can legitimately share
    // one exe name (e.g. multiple chrome.exe instances) -- the first one
    // this process can actually read MainModule from wins; an
    // access-denied on one match (a different-session/elevated instance)
    // is skipped rather than failing the whole lookup.
    static string ResolvePath(string processName)
    {
        foreach (var p in Process.GetProcessesByName(processName))
        {
            try
            {
                string candidate = p.MainModule.FileName;
                if (!string.IsNullOrEmpty(candidate)) return candidate;
            }
            catch
            {
                // Try the next matching process, if any.
            }
            finally
            {
                p.Dispose();
            }
        }
        return null;
    }
}
