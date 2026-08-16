// Rebuild after editing:
//   C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe /nologo /target:exe \
//     /optimize+ /out:app-list.exe /r:System.Drawing.dll app-list.cs
//
// Enumerates the installed applications for the launcher, as one JSON line on
// stdout:
//
//   app-list.exe list                names and paths only
//   app-list.exe list --icons        the same, plus a base64 PNG per entry
//   app-list.exe icons <p1> <p2> ..  icons for just those paths
//
// **Why the third verb exists.** Measured on this machine: 254 Start Menu
// entries enumerate in 70ms, and extracting all 254 icons takes 11.9 SECONDS
// (~47ms each -- ExtractAssociatedIcon resolves the shortcut and loads the
// target's icon) for a 581KB payload. Blocking the launcher on that is not an
// option, and spawning one process per icon is against this pack's standing
// rule that a spawn must justify itself. So the launcher lists instantly, then
// asks for icons for the handful of rows actually on screen, in ONE spawn.
//
// **Start Menu shortcuts, not an installed-programs registry scan.** The Start
// Menu is what the user actually thinks of as "my apps": it excludes the
// uninstallers, redistributables and update helpers that Uninstall\* is full
// of, and it already carries the name a human chose. Both the machine-wide and
// per-user trees are read, because most things land in one or the other and
// nothing lands in both reliably.
//
// **The .lnk files are never resolved.** Reading a shortcut's target needs
// either COM (IWshShell) or a hand-rolled binary parser, and buys nothing:
// ShellExecute launches a .lnk directly, honouring its own working directory
// and arguments -- which is more correct than launching the resolved target
// without them. The .lnk path IS the identity.
//
// Icons come from Icon.ExtractAssociatedIcon, the same shell-standard call
// app-icon.cs uses, which follows a shortcut to whatever it points at.
//
// ONE process for the whole list, deliberately. This pack's standing rule is
// that a spawn has to justify itself, and one ~200KB payload beats a hundred
// separate icon extractions.

using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Text;

static class AppList
{
    static int Main(string[] args)
    {
        try
        {
            if (args.Length < 1) return 1;
            if (args[0] == "icons") return Icons(args);
            if (args[0] != "list") return 1;
            bool withIcons = Array.IndexOf(args, "--icons") >= 0;

            var roots = new[]
            {
                Environment.GetFolderPath(Environment.SpecialFolder.CommonStartMenu),
                Environment.GetFolderPath(Environment.SpecialFolder.StartMenu),
            };

            // Keyed by lowercased display name: the same app very often appears
            // in both the machine-wide and per-user trees, and a launcher that
            // lists Chrome twice looks broken.
            var seen = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            var order = new List<string>();

            foreach (string root in roots)
            {
                if (string.IsNullOrEmpty(root) || !Directory.Exists(root)) continue;
                string[] files;
                try { files = Directory.GetFiles(root, "*.lnk", SearchOption.AllDirectories); }
                catch (Exception) { continue; }   // a single unreadable subtree must not lose the rest

                foreach (string f in files)
                {
                    string name = Path.GetFileNameWithoutExtension(f);
                    if (IsNoise(name)) continue;
                    if (seen.ContainsKey(name)) continue;
                    seen[name] = f;
                    order.Add(name);
                }
            }

            order.Sort(StringComparer.OrdinalIgnoreCase);

            var sb = new StringBuilder();
            sb.Append("{\"apps\":[");
            bool first = true;
            foreach (string name in order)
            {
                string path = seen[name];
                if (!first) sb.Append(',');
                first = false;
                sb.Append("{\"name\":").Append(Json(name));
                sb.Append(",\"path\":").Append(Json(path));
                if (withIcons)
                {
                    string icon = IconFor(path);
                    sb.Append(",\"icon\":").Append(icon == null ? "null" : Json(icon));
                }
                sb.Append('}');
            }
            sb.Append("]}");

            Write(sb.ToString());
            return 0;
        }
        catch (Exception)
        {
            // Silent by design: anything on stdout would be parsed as JSON.
            return 1;
        }
    }

    // Icons for an explicit set of paths, keyed by path so the caller can match
    // them back up. A path that yields nothing comes back as null rather than
    // being omitted -- "no icon" is a fact worth caching, or the caller re-asks
    // for the same missing icon on every keystroke.
    static int Icons(string[] args)
    {
        var sb = new StringBuilder();
        sb.Append("{\"icons\":{");
        bool first = true;
        for (int i = 1; i < args.Length; i++)
        {
            string path = args[i];
            if (!first) sb.Append(',');
            first = false;
            string icon = IconFor(path);
            sb.Append(Json(path)).Append(':').Append(icon == null ? "null" : Json(icon));
        }
        sb.Append("}}");
        Write(sb.ToString());
        return 0;
    }

    static void Write(string s)
    {
        // Bytes straight to the stream rather than Console.Write, so the
        // console's own code page cannot mangle a non-ASCII application name.
        var outStream = Console.OpenStandardOutput();
        byte[] payload = new UTF8Encoding(false).GetBytes(s);
        outStream.Write(payload, 0, payload.Length);
        outStream.Flush();
    }

    // Shortcuts that are in the Start Menu but are not applications a person
    // launches by name. Kept deliberately short -- over-filtering hides real
    // apps, and the search box already makes a long list cheap to navigate.
    static bool IsNoise(string name)
    {
        string n = name.ToLowerInvariant();
        return n.StartsWith("uninstall")
            || n.EndsWith("uninstall")
            || n.Contains("uninstaller")
            || n.EndsWith("website")
            || n.EndsWith("homepage")
            || n.EndsWith("release notes")
            || n.EndsWith("readme")
            || n.EndsWith(" help")
            || n.EndsWith("documentation");
    }

    static string IconFor(string path)
    {
        try
        {
            using (Icon icon = Icon.ExtractAssociatedIcon(path))
            {
                if (icon == null) return null;
                using (Bitmap bmp = icon.ToBitmap())
                using (var ms = new MemoryStream())
                {
                    bmp.Save(ms, ImageFormat.Png);
                    return "data:image/png;base64," + Convert.ToBase64String(ms.ToArray());
                }
            }
        }
        catch (Exception)
        {
            // An icon that cannot be extracted is ordinary -- the caller shows
            // the entry without one rather than dropping it.
            return null;
        }
    }

    static string Json(string s)
    {
        var sb = new StringBuilder("\"");
        foreach (char c in s)
        {
            switch (c)
            {
                case '"': sb.Append("\\\""); break;
                case '\\': sb.Append("\\\\"); break;
                case '\b': sb.Append("\\b"); break;
                case '\f': sb.Append("\\f"); break;
                case '\n': sb.Append("\\n"); break;
                case '\r': sb.Append("\\r"); break;
                case '\t': sb.Append("\\t"); break;
                default:
                    if (c < 0x20 || c > 0x7e) sb.Append("\\u").Append(((int)c).ToString("x4"));
                    else sb.Append(c);
                    break;
            }
        }
        return sb.Append('"').ToString();
    }
}
