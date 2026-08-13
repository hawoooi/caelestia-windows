import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseGpu,
  gpuCommand,
  createGpuStats,
  NVIDIA_SMI_PATH,
} from '../../zebar/caelestia/gpu-stats.js';

const MIB = 1024 * 1024;

test('gpuCommand is pinned to the real nvidia-smi path and asks for one CSV line', () => {
  assert.equal(NVIDIA_SMI_PATH, 'C:\\Windows\\System32\\nvidia-smi.exe');
  const cmd = gpuCommand();
  assert.equal(cmd.program, NVIDIA_SMI_PATH);
  assert.deepEqual(cmd.args, [
    '--query-gpu=utilization.gpu,temperature.gpu,memory.used,memory.total',
    '--format=csv,noheader,nounits',
  ]);
});

test('parseGpu reads a real nvidia-smi line, converting MiB to bytes', () => {
  // Captured verbatim from this machine's RTX 4060 Ti.
  const r = parseGpu('56, 43, 1935, 16380\n');
  assert.equal(r.usage, 56);
  assert.equal(r.temperature, 43);
  assert.equal(r.usedBytes, 1935 * MIB);
  assert.equal(r.totalBytes, 16380 * MIB);
});

test('parseGpu tolerates missing spaces and trailing blank lines', () => {
  assert.deepEqual(parseGpu('0,31,512,8188'), {
    usage: 0, temperature: 31, usedBytes: 512 * MIB, totalBytes: 8188 * MIB,
  });
  assert.equal(parseGpu('\n\n  7, 40, 100, 200  \n\n').usage, 7);
});

test('parseGpu keeps a zero reading -- 0% is a measurement, not a missing one', () => {
  assert.equal(parseGpu('0, 0, 0, 8188').usage, 0);
});

test('parseGpu returns null for output it cannot read, rather than NaN', () => {
  assert.equal(parseGpu(''), null);
  assert.equal(parseGpu('   \n  '), null);
  assert.equal(parseGpu(null), null);
  assert.equal(parseGpu(undefined), null);
  assert.equal(parseGpu(42), null);
  assert.equal(parseGpu('NVIDIA-SMI has failed because it could not communicate with the driver'), null);
  assert.equal(parseGpu('56, 43'), null); // truncated
});

test('parseGpu treats nvidia-smi\'s own [N/A] placeholders as missing, not zero', () => {
  // A laptop with the discrete GPU powered down prints these. Reporting them
  // as 0 would show a confident, wrong reading.
  const r = parseGpu('12, [N/A], [N/A], 16380');
  assert.equal(r.usage, 12);
  assert.equal(r.temperature, null);
  assert.equal(r.usedBytes, null);
  assert.equal(r.totalBytes, 16380 * MIB);
  // Utilisation is the one field the row cannot render without.
  assert.equal(parseGpu('[N/A], 43, 100, 200'), null);
});

test('createGpuStats returns the parsed reading from the shell', async () => {
  const calls = [];
  const shell = {
    shellExec: async (program, args) => { calls.push({ program, args }); return { stdout: '33, 50, 2048, 16380' }; },
  };
  const stats = createGpuStats(shell);
  const r = await stats.sample();
  assert.equal(r.usage, 33);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].program, NVIDIA_SMI_PATH);
});

test('createGpuStats never stacks spawns -- a slow sample blocks the next one', async () => {
  let started = 0;
  let release;
  const gate = new Promise((r) => { release = r; });
  const shell = { shellExec: async () => { started++; await gate; return { stdout: '1, 2, 3, 4' }; } };
  const stats = createGpuStats(shell);

  const first = stats.sample();
  const second = await stats.sample();   // must be refused while first is out
  assert.equal(second, null);
  assert.equal(started, 1);
  release();
  await first;
});

test('createGpuStats stops trying once the tool has proved absent', async () => {
  let calls = 0;
  const shell = { shellExec: async () => { calls++; throw new Error('not found'); } };
  const stats = createGpuStats(shell);
  assert.equal(stats.available, true);
  assert.equal(await stats.sample(), null);
  assert.equal(stats.available, false);
  // A machine with no NVIDIA driver must not spawn a doomed process per tick
  // for the rest of the session.
  assert.equal(await stats.sample(), null);
  assert.equal(calls, 1);
});

test('createGpuStats also gives up on output it cannot parse', async () => {
  const shell = { shellExec: async () => ({ stdout: 'Unable to determine the device handle' }) };
  const stats = createGpuStats(shell);
  assert.equal(await stats.sample(), null);
  assert.equal(stats.available, false);
});

test('createGpuStats without a shell is a silent null, never a throw', async () => {
  assert.equal(await createGpuStats(null).sample(), null);
  assert.equal(await createGpuStats({}).sample(), null);
});
