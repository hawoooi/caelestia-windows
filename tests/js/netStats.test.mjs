// The sampling arithmetic behind the network panel's download/upload figures.
// This is the part that is easy to get subtly wrong and impossible to notice
// by eye: a rate is only ever as good as the interval it was divided by, and a
// wrong one still renders as a plausible number.
//
// The fixture is REAL output captured from the built helper on this machine.

import { test } from 'node:test';
import assert from 'node:assert';

import {
  NET_STATS_PATH,
  EXPLORER_PATH,
  WIFI_URI,
  statsCommand,
  wifiSettingsCommand,
  parseStats,
  intervalSeconds,
  computeRates,
  formatRate,
  formatLink,
  createNetStats,
} from '../../zebar/caelestia/net-stats.js';

const SAMPLE = '{"name":"Hai XM_5G","adapter":"Wi-Fi","wireless":true,"ipv4":"192.168.31.61",'
  + '"linkBps":585000000,"rxBytes":31028454455,"txBytes":3628239300,"tickMs":116548593}';

const sample = (over = {}) => ({ ...parseStats(SAMPLE), ...over });

// --- commands -------------------------------------------------------------

test('commands match the argsRegexes registered in zpack.json', () => {
  const stats = statsCommand();
  assert.strictEqual(stats.program, NET_STATS_PATH);
  assert.match(stats.args.join(' '), /^$/, 'net-stats takes no arguments');

  const wifi = wifiSettingsCommand();
  assert.strictEqual(wifi.program, EXPLORER_PATH);
  assert.match(wifi.args.join(' '), /^ms-availablenetworks:$/);
  assert.strictEqual(WIFI_URI, 'ms-availablenetworks:');
});

// --- parsing --------------------------------------------------------------

test('parses real helper output', () => {
  const s = parseStats(SAMPLE);
  assert.strictEqual(s.name, 'Hai XM_5G');
  assert.strictEqual(s.adapter, 'Wi-Fi');
  assert.strictEqual(s.wireless, true);
  assert.strictEqual(s.ipv4, '192.168.31.61');
  assert.strictEqual(s.linkBps, 585000000);
  assert.strictEqual(s.rxBytes, 31028454455);
});

test('unusable output yields null, never a half-built sample', () => {
  for (const bad of ['', '  ', 'nope', '{}', '[]', '{"rxBytes":"x","txBytes":1}', null, undefined, 7]) {
    assert.strictEqual(parseStats(bad), null, `expected null for ${JSON.stringify(bad)}`);
  }
});

// --- interval / rates -----------------------------------------------------

test('a rate needs two samples; the first poll reports unknown', () => {
  assert.strictEqual(computeRates(null, sample()), null);
  assert.strictEqual(computeRates(sample(), null), null);
});

test('computes a rate from the difference between two samples', () => {
  const a = sample({ rxBytes: 1000, txBytes: 500, tickMs: 10000 });
  const b = sample({ rxBytes: 3000, txBytes: 1500, tickMs: 12000 });   // +2s
  assert.deepStrictEqual(computeRates(a, b), { down: 1000, up: 500 });
});

test('the 32-bit tick counter wrapping does not manufacture a negative interval', () => {
  // GetTickCount wraps every ~49.7 days. Without correction the interval goes
  // hugely negative and the rate becomes nonsense on an uptime-proud machine.
  const beforeWrap = 0xFFFFFF00;
  const afterWrap = 0x00000100;                 // 512 ms later
  assert.strictEqual(intervalSeconds(beforeWrap, afterWrap), 0.512);

  const a = sample({ rxBytes: 0, txBytes: 0, tickMs: beforeWrap });
  const b = sample({ rxBytes: 512, txBytes: 256, tickMs: afterWrap });
  assert.deepStrictEqual(computeRates(a, b), { down: 1000, up: 500 });
});

test('a degenerate interval reports unknown rather than a spike', () => {
  // Two reads inside the same millisecond would divide by ~0 and render an
  // absurd number that looks like real traffic.
  const a = sample({ tickMs: 10000, rxBytes: 0, txBytes: 0 });
  assert.strictEqual(computeRates(a, sample({ tickMs: 10000, rxBytes: 5000, txBytes: 0 })), null);
  assert.strictEqual(computeRates(a, sample({ tickMs: 10010, rxBytes: 5000, txBytes: 0 })), null);
});

test('a long gap reports unknown instead of averaging it into "now"', () => {
  // The panel was closed, or the widget was suspended. Differencing across
  // that would present minutes of accumulated traffic as a current rate.
  const a = sample({ tickMs: 0, rxBytes: 0, txBytes: 0 });
  const b = sample({ tickMs: 120000, rxBytes: 1e9, txBytes: 1e9 });
  assert.strictEqual(computeRates(a, b), null);
});

test('a changed adapter reports unknown, not the difference between two NICs', () => {
  const a = sample({ adapter: 'Wi-Fi', rxBytes: 5000, tickMs: 1000 });
  const b = sample({ adapter: 'Ethernet', rxBytes: 10, tickMs: 2000 });
  assert.strictEqual(computeRates(a, b), null);
});

test('counters going backwards report unknown, not a negative rate', () => {
  const a = sample({ rxBytes: 5000, txBytes: 5000, tickMs: 1000 });
  const b = sample({ rxBytes: 10, txBytes: 10, tickMs: 2000 });   // adapter reset
  assert.strictEqual(computeRates(a, b), null);
});

// --- formatting -----------------------------------------------------------

test('rates format across every unit boundary', () => {
  assert.strictEqual(formatRate(0), '0 B/s');
  assert.strictEqual(formatRate(999), '999 B/s');
  assert.strictEqual(formatRate(1000), '1.0 kB/s');
  assert.strictEqual(formatRate(6200), '6.2 kB/s');
  assert.strictEqual(formatRate(150000), '150 kB/s');
  assert.strictEqual(formatRate(1.5e6), '1.5 MB/s');
  assert.strictEqual(formatRate(2.5e8), '250 MB/s');
  assert.strictEqual(formatRate(3e9), '3.0 GB/s');
});

test('an unknown rate renders as a dash, never as zero', () => {
  // Zero would be a lie: "no traffic" and "we cannot tell yet" are different
  // states, and the first poll after opening is always the second one.
  assert.strictEqual(formatRate(null), '--');
  assert.strictEqual(formatRate(undefined), '--');
  assert.strictEqual(formatRate(NaN), '--');
  assert.strictEqual(formatRate(Infinity), '--');
});

test('link speed formats, and unknown link speed is omitted entirely', () => {
  assert.strictEqual(formatLink(585000000), '585 Mbps');
  assert.strictEqual(formatLink(1e9), '1 Gbps');
  assert.strictEqual(formatLink(2.5e9), '2.5 Gbps');
  assert.strictEqual(formatLink(0), null, 'an adapter that does not know its rate shows nothing');
  assert.strictEqual(formatLink(undefined), null);
});

// --- the sampler ----------------------------------------------------------

function fakeShell(outputs) {
  const calls = [];
  let i = 0;
  return {
    calls,
    shellExec(program, args) {
      calls.push({ program, args: args.join(' ') });
      const out = Array.isArray(outputs) ? outputs[Math.min(i++, outputs.length - 1)] : outputs;
      if (out === null) return Promise.reject(new Error('exit 1'));
      return Promise.resolve({ stdout: out, stderr: '', exitCode: 0 });
    },
  };
}

test('the first sample has no rate, the second does', async () => {
  const second = SAMPLE.replace('"rxBytes":31028454455', '"rxBytes":31028456455')
                       .replace('"tickMs":116548593', '"tickMs":116549593');
  const net = createNetStats(fakeShell([SAMPLE, second]));
  const a = await net.sample();
  assert.strictEqual(a.rates, null);
  assert.strictEqual(a.stats.name, 'Hai XM_5G');
  const b = await net.sample();
  assert.strictEqual(b.rates.down, 2000, '2000 bytes over 1s');
});

test('reset() drops the remembered sample so a reopen cannot report a stale rate', async () => {
  const second = SAMPLE.replace('"rxBytes":31028454455', '"rxBytes":31028456455')
                       .replace('"tickMs":116548593', '"tickMs":116549593');
  const net = createNetStats(fakeShell([SAMPLE, second]));
  await net.sample();
  net.reset();
  const b = await net.sample();
  assert.strictEqual(b.rates, null, 'no rate against a forgotten baseline');
});

test('samples never overlap', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  let running = 0, peak = 0;
  const net = createNetStats({
    async shellExec() {
      running++; peak = Math.max(peak, running);
      await gate;
      running--;
      return { stdout: SAMPLE, stderr: '', exitCode: 0 };
    },
  });
  const first = net.sample();
  assert.strictEqual(await net.sample(), null, 'the second is dropped, not queued');
  release();
  await first;
  assert.strictEqual(peak, 1);
});

test('a failing helper or missing shell degrades to null', async () => {
  assert.strictEqual(await createNetStats(fakeShell(null)).sample(), null);
  assert.strictEqual(await createNetStats(null).sample(), null);
  await assert.doesNotReject(() => createNetStats(null).openWifiSettings());
});

test('the Wi-Fi handoff swallows explorer.exe returning nonzero', async () => {
  // explorer.exe reports a nonzero exit for a URI handoff even on success, so
  // a rejection here carries no information and must not surface.
  const net = createNetStats(fakeShell(null));
  await assert.doesNotReject(() => net.openWifiSettings());
});
