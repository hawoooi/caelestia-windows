// GPU readings for the dashboard, from nvidia-smi.
//
// Zebar has no GPU provider -- there is `cpu`, `memory`, `disk`, `network`
// and no equivalent for the graphics card, so the only route is the vendor's
// own tool. This machine has an RTX 4060 Ti and nvidia-smi.exe is already on
// PATH at C:\Windows\system32 (it ships with the driver, not the CUDA
// toolkit, so it is present on any machine with an NVIDIA driver installed).
//
// **This is NVIDIA-only, and that is a deliberate limit rather than an
// oversight.** There is no vendor-neutral GPU utilisation API on Windows that
// does not involve either performance counters (slow, and the GPU engine
// counters are per-process, needing summation across every process to get a
// device total) or a WMI class that reports nothing useful on most drivers.
// On a machine without nvidia-smi every function here fails soft and the GPU
// row simply does not render -- see the caller in dashboard/dashboard.js.
//
// Shaped exactly like net-stats.js: pure parsing separated from the shellExec
// plumbing, so the parsing is unit-testable without a shell (tests/js/
// gpuStats.test.mjs) and the poller can be started and STOPPED with the panel
// it belongs to.

export const NVIDIA_SMI_PATH = 'C:\\Windows\\System32\\nvidia-smi.exe';

// One query for everything, so a panel refresh is one process spawn rather
// than four. `noheader,nounits` gives a bare CSV line -- "56, 43, 1935, 16380"
// -- which is far easier to parse correctly than the default table.
export const GPU_QUERY = 'utilization.gpu,temperature.gpu,memory.used,memory.total';

export function gpuCommand() {
  return {
    program: NVIDIA_SMI_PATH,
    args: ['--query-gpu=' + GPU_QUERY, '--format=csv,noheader,nounits'],
  };
}

/**
 * Parses one nvidia-smi CSV line into a reading.
 *
 * Never throws. Returns null for anything it cannot read -- a missing tool
 * prints nothing, a driver fault prints an error line, and a laptop with the
 * GPU powered down prints "[N/A]" in place of numbers. All three must degrade
 * to "no GPU row", never to NaN% on the panel.
 *
 * Memory is reported in MEBIBYTES by nvidia-smi (its docs say MiB and the
 * numbers agree: 16380 for a 16GB card). It is converted to bytes here so
 * every size in this pack flows through one formatter.
 */
export function parseGpu(stdout) {
  if (typeof stdout !== 'string') return null;
  const line = stdout.split(/\r?\n/).map((l) => l.trim()).find((l) => l.length > 0);
  if (!line) return null;

  const parts = line.split(',').map((p) => p.trim());
  if (parts.length < 4) return null;

  const nums = parts.slice(0, 4).map((p) => {
    // "[N/A]" and "[Not Supported]" are nvidia-smi's own placeholders.
    if (/^\[/.test(p)) return null;
    const n = Number(p);
    return Number.isFinite(n) ? n : null;
  });

  const [usage, temperature, usedMib, totalMib] = nums;
  // Utilisation is the one field the GPU row cannot render without.
  if (usage === null) return null;

  return {
    usage,
    temperature,
    usedBytes: usedMib === null ? null : usedMib * 1024 * 1024,
    totalBytes: totalMib === null ? null : totalMib * 1024 * 1024,
  };
}

/**
 * A poller with the same contract as createNetStats: one outstanding call at
 * a time, and every failure is a silent null rather than a rejection.
 *
 * The in-flight guard is not decoration. A helper process that outlives its
 * parent zebar inherits zebar's listening socket on port 6124, after which
 * every later start binds nothing and paints nothing -- this pack has lost two
 * debugging sessions to exactly that. Never stacking spawns is half the
 * defence; the caller stopping the poll when the panel closes is the other.
 */
export function createGpuStats(shell) {
  let inFlight = false;
  let available = true;

  return {
    // Lets a caller stop rendering the row entirely once the tool has proved
    // absent, rather than spawning a doomed process every tick forever.
    get available() { return available; },

    async sample() {
      if (inFlight || !available) return null;
      if (!shell || typeof shell.shellExec !== 'function') return null;
      inFlight = true;
      try {
        const cmd = gpuCommand();
        let stdout;
        try {
          const res = await shell.shellExec(cmd.program, cmd.args);
          stdout = res && typeof res.stdout === 'string' ? res.stdout : '';
        } catch (e) {
          // A nonzero exit means no NVIDIA driver, no GPU, or a privilege the
          // widget was not granted. All three are permanent for this session.
          available = false;
          return null;
        }
        const parsed = parseGpu(stdout);
        if (!parsed) available = false;
        return parsed;
      } finally {
        inFlight = false;
      }
    },
  };
}
