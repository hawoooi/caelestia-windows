// Rebuild after editing:
//   C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe /nologo /target:exe \
//     /optimize+ /out:media-art.exe \
//     /r:"C:\Program Files (x86)\Windows Kits\10\UnionMetadata\10.0.22621.0\Windows.winmd" \
//     /r:"C:\Windows\Microsoft.NET\Framework64\v4.0.30319\System.Runtime.WindowsRuntime.dll" \
//     media-art.cs
//
// Prints a base64-encoded image of the CURRENTLY PLAYING track's album art
// to stdout, plus the track it belongs to, as one line:
//
//   <title>\t<artist>\t<base64>
//
// Prints nothing and exits non-zero on any failure -- no session, no
// thumbnail, a player that does not publish one, a timeout. dashboard.js
// treats "no output" as "keep the placeholder glyph", the same fail-soft
// contract app-icon.exe and fullscreen-detect.exe already have.
//
// WHY THIS TOOL EXISTS. Direct user report: "it still can't fetch the current
// playing media image (this was possible in my previous yasb bar)". They are
// right on both counts. Zebar's media provider carries title/artist/album/
// position and nothing else -- grepping the vendored bundle for
// thumbnail/artwork/albumArt/coverArt returns zero hits, so there is no field
// being missed. yasb could do it because it read the same Windows API this
// tool reads, directly, rather than going through a provider.
//
// The API is SMTC -- GlobalSystemMediaTransportControlsSessionManager, the
// thing behind the volume-flyout media popup. It is the only universal source
// on Windows: it works for Spotify, browsers, foobar2000 and anything else
// that registers a transport session, and it is what the OS itself displays.
//
// TITLE AND ARTIST ARE ECHOED BACK ON PURPOSE. Fetching art costs a process
// spawn and a WinRT round trip, so the caller caches per track -- but a cache
// keyed on the caller's idea of "current track" races the player: the art that
// arrives may already belong to the previous song. Returning the track this
// image is actually FOR lets the caller discard a stale answer instead of
// showing the wrong cover. (The same race exists in app-icon.exe, where it is
// harmless because a window's icon does not change under it; here it is not.)
//
// A note on the toolchain: csc.exe here is C# 5, which is fine -- async/await
// is C# 5's own headline feature, and .AsTask() comes from
// System.Runtime.WindowsRuntime. What is NOT available: interpolated strings,
// discards (out _), and expression-bodied members. Keep to C# 5.

using System;
using System.IO;
using System.Runtime.InteropServices.WindowsRuntime;
using System.Threading.Tasks;
using Windows.Media.Control;
using Windows.Storage.Streams;

static class MediaArt
{
    // Every await is raced against this. A hung player (or a WinRT call that
    // never returns because the session died mid-request) must not leave a
    // process parked forever: this pack has twice been broken by a helper
    // outliving its parent zebar and inheriting zebar's listening socket on
    // port 6124, after which every later start paints nothing at all. A tool
    // that always exits cannot become that orphan.
    const int TimeoutMs = 4000;

    static int Main()
    {
        try
        {
            Task<int> work = Run();
            if (!work.Wait(TimeoutMs)) return 3;
            return work.Result;
        }
        catch (Exception)
        {
            // Deliberately silent. Any diagnostic on stdout would be parsed as
            // an answer by the caller; stderr is not read by anyone.
            return 1;
        }
    }

    static async Task<int> Run()
    {
        GlobalSystemMediaTransportControlsSessionManager manager =
            await GlobalSystemMediaTransportControlsSessionManager.RequestAsync().AsTask();
        if (manager == null) return 2;

        GlobalSystemMediaTransportControlsSession session = manager.GetCurrentSession();
        if (session == null) return 2;

        GlobalSystemMediaTransportControlsSessionMediaProperties props =
            await session.TryGetMediaPropertiesAsync().AsTask();
        if (props == null) return 2;

        IRandomAccessStreamReference thumbRef = props.Thumbnail;
        // A session with no artwork is ordinary, not an error: a browser tab
        // playing a bare audio file has none.
        if (thumbRef == null) return 2;

        byte[] bytes;
        using (IRandomAccessStreamWithContentType stream = await thumbRef.OpenReadAsync().AsTask())
        {
            if (stream == null || stream.Size == 0) return 2;
            // Guard against a pathological stream: the caller turns this into
            // a data: URI, and a multi-megabyte one would bloat the DOM for a
            // 240px tile. Real SMTC thumbnails are tens of KB.
            if (stream.Size > 8 * 1024 * 1024) return 2;

            uint size = (uint)stream.Size;
            Windows.Storage.Streams.Buffer buffer = new Windows.Storage.Streams.Buffer(size);
            IBuffer read = await stream.ReadAsync(buffer, size, InputStreamOptions.None).AsTask();
            bytes = read.ToArray();
        }

        if (bytes == null || bytes.Length == 0) return 2;

        string title = props.Title == null ? "" : props.Title;
        string artist = props.Artist == null ? "" : props.Artist;
        // Tabs separate the three fields, so strip any that appear in the
        // metadata itself rather than emitting a line the caller cannot split.
        title = title.Replace('\t', ' ').Replace('\r', ' ').Replace('\n', ' ');
        artist = artist.Replace('\t', ' ').Replace('\r', ' ').Replace('\n', ' ');

        Console.Out.Write(title);
        Console.Out.Write('\t');
        Console.Out.Write(artist);
        Console.Out.Write('\t');
        Console.Out.Write(Convert.ToBase64String(bytes));
        Console.Out.Flush();
        return 0;
    }
}
