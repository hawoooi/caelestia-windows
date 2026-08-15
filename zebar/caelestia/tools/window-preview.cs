// Rebuild after editing:
//   C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe /nologo /target:exe \
//     /optimize+ /out:window-preview.exe /r:System.Drawing.dll window-preview.cs
//
// Prints a base64-encoded PNG snapshot of one window's contents to stdout, for
// the dock's hover preview card. Same contract as app-icon.exe: nothing on
// stdout and a nonzero exit on ANY failure, so the caller treats "no output"
// as "no preview available" and shows the card without one.
//
//   window-preview.exe <hwnd> [maxWidth]
//
// PrintWindow with PW_RENDERFULLCONTENT is the capture route, chosen over the
// two alternatives for one reason: it produces an ordinary bitmap that can be
// handed to an <img> and composed INSIDE the HTML card -- rounded corners, the
// title row above it, a fade at the edges, whatever the design wants.
//
//   * DwmRegisterThumbnail gives a genuinely live preview and is what the
//     Windows taskbar itself uses, but DWM composites it OVER the destination
//     window rather than into its content. Inside a WebView2 widget that means
//     a live rectangle painted on top of the page, with no way to round its
//     corners or draw anything above it.
//   * Windows.Graphics.Capture gives a real frame stream, but needs a D3D
//     device and per-frame encoding to reach WebView2 at all.
//
// **The known risk, and why this tool reports it rather than hiding it.**
// PrintWindow returns solid black for some Windows 11 windows -- anything
// drawn through the XAML/DWM composition path rather than into its own DC.
// This repo has already hit that: capturing Shell_TrayWnd returns pure black
// even with PW_RENDERFULLCONTENT. So an all-black result is treated as a
// FAILURE here, not as a valid dark screenshot, because shipping a black
// rectangle labelled "preview" is worse than shipping no preview at all.
//
// The blackness test samples rather than scanning every pixel: a full scan of
// a 2560x1440 window is millions of reads for a question that a few hundred
// answers just as well.

using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;

static class WindowPreview
{
    [DllImport("user32.dll")]
    static extern bool PrintWindow(IntPtr hwnd, IntPtr hdcBlt, uint nFlags);

    [DllImport("user32.dll")]
    static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);

    [DllImport("user32.dll")]
    static extern bool IsWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    static extern bool IsWindowVisible(IntPtr hWnd);

    [StructLayout(LayoutKind.Sequential)]
    struct RECT { public int Left, Top, Right, Bottom; }

    // Renders the full window including parts occluded by other windows, which
    // plain BitBlt cannot do.
    const uint PW_RENDERFULLCONTENT = 2;

    static int Main(string[] args)
    {
        try
        {
            if (args.Length < 1) return 1;

            long raw;
            if (!long.TryParse(args[0], out raw) || raw <= 0) return 1;
            IntPtr hWnd = new IntPtr(raw);
            if (!IsWindow(hWnd) || !IsWindowVisible(hWnd)) return 2;

            int maxWidth = 320;
            if (args.Length > 1)
            {
                int parsed;
                if (int.TryParse(args[1], out parsed) && parsed >= 32 && parsed <= 1920) maxWidth = parsed;
            }

            RECT r;
            if (!GetWindowRect(hWnd, out r)) return 2;
            int w = r.Right - r.Left;
            int h = r.Bottom - r.Top;
            if (w <= 0 || h <= 0) return 2;
            // A window larger than any plausible desktop is a sign something is
            // wrong; refuse rather than allocate hundreds of MB for it.
            if (w > 16384 || h > 16384) return 2;

            using (Bitmap shot = new Bitmap(w, h, PixelFormat.Format32bppArgb))
            {
                using (Graphics g = Graphics.FromImage(shot))
                {
                    IntPtr hdc = g.GetHdc();
                    bool ok;
                    try { ok = PrintWindow(hWnd, hdc, PW_RENDERFULLCONTENT); }
                    finally { g.ReleaseHdc(hdc); }
                    if (!ok) return 3;
                }

                if (IsEffectivelyBlank(shot)) return 4;

                // Scale to the requested width. The card shows this at a few
                // hundred pixels; sending a full-resolution window as base64
                // would be megabytes per hover.
                int outW = Math.Min(maxWidth, w);
                int outH = Math.Max(1, (int)Math.Round(h * (outW / (double)w)));

                using (Bitmap small = new Bitmap(outW, outH, PixelFormat.Format32bppArgb))
                {
                    using (Graphics g2 = Graphics.FromImage(small))
                    {
                        g2.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.HighQualityBicubic;
                        g2.PixelOffsetMode = System.Drawing.Drawing2D.PixelOffsetMode.HighQuality;
                        g2.DrawImage(shot, 0, 0, outW, outH);
                    }

                    using (MemoryStream ms = new MemoryStream())
                    {
                        small.Save(ms, ImageFormat.Png);
                        Console.Out.Write(Convert.ToBase64String(ms.ToArray()));
                        Console.Out.Flush();
                    }
                }
            }

            return 0;
        }
        catch (Exception)
        {
            // Silent by design: any diagnostic on stdout would be parsed as an
            // image by the caller.
            return 1;
        }
    }

    // True when the capture came back as a single flat colour -- which is what
    // PrintWindow produces for windows it cannot render (pure black), and also
    // catches a window that genuinely has nothing on it yet.
    static bool IsEffectivelyBlank(Bitmap bmp)
    {
        int stepX = Math.Max(1, bmp.Width / 24);
        int stepY = Math.Max(1, bmp.Height / 24);

        bool first = true;
        int r0 = 0, g0 = 0, b0 = 0;
        int differing = 0;
        int sampled = 0;

        for (int x = 0; x < bmp.Width; x += stepX)
        {
            for (int y = 0; y < bmp.Height; y += stepY)
            {
                Color c = bmp.GetPixel(x, y);
                sampled++;
                if (first) { r0 = c.R; g0 = c.G; b0 = c.B; first = false; continue; }
                // Tolerance, so a near-uniform gradient still counts as flat.
                if (Math.Abs(c.R - r0) > 8 || Math.Abs(c.G - g0) > 8 || Math.Abs(c.B - b0) > 8) differing++;
            }
        }

        if (sampled < 4) return true;
        // Fewer than 2% of samples differing from the first means a flat fill.
        return differing * 50 < sampled;
    }
}
