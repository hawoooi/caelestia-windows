// Rebuild after editing:
//   C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe /nologo /target:exe ^
//     /optimize+ /out:net-stats.exe net-stats.cs
//
// One JSON snapshot of the active network connection: its name, link speed and
// CUMULATIVE byte counters. Direct user feedback: "Add network stats like
// download and upload in there."
//
// Why a helper rather than zebar's own network provider: that provider gives
// `transmitSpeed`/`receiveSpeed`, which sound like throughput and are not --
// they are the NEGOTIATED LINK RATE (confirmed live: 866700000 on this
// machine's Wi-Fi 6E adapter, i.e. exactly 866.7 Mbps, and u64::MAX on an
// unplugged Ethernet port). Nothing in the provider counts bytes, so live
// download/upload rates need the adapter's own counters instead.
//
// This tool is deliberately STATELESS: it prints the counters as they stand
// and exits. The caller samples it on a timer and differences successive
// reads to get a rate. Keeping the arithmetic on the JS side means the helper
// has no memory to get stale, no clock of its own, and nothing to reset when
// a panel closes and reopens.
//
// The connection NAME is read through the Network List Manager COM API, the
// same source PowerShell's Get-NetConnectionProfile uses. That matters on this
// machine: `netsh wlan show interfaces` -- the obvious way to get an SSID --
// is BLOCKED unless Windows Location services are enabled ("Network shell
// commands need location permission ... requires elevation", machine consent
// reads Deny here). NLM is not gated that way and returns the SSID for a Wi-Fi
// connection, so the panel can name the network without the user having to
// turn on location access.
//
// NLM is called through IDispatch LATE BINDING on purpose. The vtable-order
// interop this pack uses for Core Audio (tools/audio-mixer.cs) is precise but
// unforgiving -- one wrong slot is a runtime misbehaviour, not a compile
// error, and it already cost a debugging cycle there. Late binding trades a
// little speed (irrelevant for a once-a-second call) for not having to
// hand-declare a single vtable.
//
// FAIL-SOFT CONTRACT, as with every helper here: any part that cannot be read
// is omitted or falls back, never aborts. No adapter at all exits non-zero
// with no output, and the caller treats that as "no stats".

using System;
using System.Collections;
using System.Globalization;
using System.Linq;
using System.Net.NetworkInformation;
using System.Reflection;
using System.Text;

static class NetStats
{
    // NLM_ENUM_NETWORK_CONNECTED
    const int CONNECTED = 1;

    static string ConnectionName()
    {
        try
        {
            var type = Type.GetTypeFromCLSID(new Guid("DCB00C01-570F-4A9B-8D69-199FDBA5723B"));
            if (type == null) return null;
            object nlm = Activator.CreateInstance(type);
            object networks = type.InvokeMember("GetNetworks", BindingFlags.InvokeMethod,
                                                null, nlm, new object[] { CONNECTED });
            foreach (object net in (IEnumerable)networks)
            {
                var name = net.GetType().InvokeMember("GetName", BindingFlags.InvokeMethod,
                                                      null, net, null) as string;
                if (!string.IsNullOrEmpty(name)) return name;
            }
        }
        catch { }
        return null;
    }

    // The interface the machine is actually using: operational, not loopback or
    // a tunnel, and carrying a real gateway. Picking "the one with a gateway"
    // rather than "the first up interface" is what keeps this off the pile of
    // virtual adapters a dev machine accumulates (Hyper-V, WSL, VPN, Wi-Fi
    // Direct -- this machine reports several, all "Up").
    static NetworkInterface Active()
    {
        NetworkInterface best = null;
        long bestTraffic = -1;
        foreach (var ni in NetworkInterface.GetAllNetworkInterfaces())
        {
            try
            {
                if (ni.OperationalStatus != OperationalStatus.Up) continue;
                if (ni.NetworkInterfaceType == NetworkInterfaceType.Loopback) continue;
                if (ni.NetworkInterfaceType == NetworkInterfaceType.Tunnel) continue;

                var props = ni.GetIPProperties();
                bool hasGateway = props.GatewayAddresses
                    .Any(g => g != null && g.Address != null && !g.Address.ToString().StartsWith("0."));
                if (!hasGateway) continue;

                // Among gateway-bearing interfaces, prefer the busiest -- a
                // machine can legitimately hold two (docked ethernet + Wi-Fi).
                var stats = ni.GetIPv4Statistics();
                long traffic = stats.BytesReceived + stats.BytesSent;
                if (traffic > bestTraffic) { bestTraffic = traffic; best = ni; }
            }
            catch { }
        }
        return best;
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

    static int Main()
    {
        try
        {
            var ni = Active();
            if (ni == null) return 1;

            var stats = ni.GetIPv4Statistics();
            var props = ni.GetIPProperties();

            string ipv4 = "";
            foreach (var ua in props.UnicastAddresses)
            {
                if (ua.Address.AddressFamily == System.Net.Sockets.AddressFamily.InterNetwork)
                { ipv4 = ua.Address.ToString(); break; }
            }

            // Speed is reported in bits/sec, and an adapter that does not know
            // its own rate reports -1 or u64::MAX-as-signed. Emit 0 for
            // "unknown" so the caller has one case to handle, not three.
            long speed = ni.Speed;
            if (speed < 0 || speed == long.MaxValue) speed = 0;

            string name = ConnectionName() ?? ni.Name;
            bool wireless = ni.NetworkInterfaceType == NetworkInterfaceType.Wireless80211;

            var sb = new StringBuilder();
            sb.Append('{');
            sb.Append("\"name\":\"").Append(Esc(name)).Append('"');
            sb.Append(",\"adapter\":\"").Append(Esc(ni.Name)).Append('"');
            sb.Append(",\"wireless\":").Append(wireless ? "true" : "false");
            sb.Append(",\"ipv4\":\"").Append(Esc(ipv4)).Append('"');
            sb.Append(",\"linkBps\":").Append(speed.ToString(CultureInfo.InvariantCulture));
            sb.Append(",\"rxBytes\":").Append(stats.BytesReceived.ToString(CultureInfo.InvariantCulture));
            sb.Append(",\"txBytes\":").Append(stats.BytesSent.ToString(CultureInfo.InvariantCulture));
            // Milliseconds since boot, from the machine's own monotonic-ish
            // clock. The caller differences successive samples to get a rate
            // and must NOT use its own wall clock for the interval: a widget
            // timer can be delayed arbitrarily by a busy main thread, which
            // would inflate the computed rate.
            sb.Append(",\"tickMs\":").Append(((long)Environment.TickCount & 0xFFFFFFFFL).ToString(CultureInfo.InvariantCulture));
            sb.Append('}');

            Console.Out.Write(sb.ToString());
            return 0;
        }
        catch
        {
            return 1;
        }
    }
}
