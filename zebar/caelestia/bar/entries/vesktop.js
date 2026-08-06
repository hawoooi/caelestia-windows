import { register } from './registry.js';

export function pingState(stdout) {
  const n = parseInt(String(stdout).trim(), 10);
  if (!Number.isFinite(n) || n <= 0) return { pinged: false, count: 0 };
  return { pinged: true, count: n };
}

const HELPER = 'C:\\Users\\PC\\.config\\yasb\\scripts\\vesktop-unread.exe';

// Task 1 Step 5 flagged shellExec as source-verified-only. Task 7 confirmed
// against the live vendored bundle (zebar/caelestia/bar/vendor/zebar.js) that
// there is no `shell.exec(...)` method on a context object -- `shellExec` is
// a top-level named export of the zebar module itself, `(program, args?,
// options?) => Promise<{ code, signal, stdout, stderr }>`. bar.js already
// wires `ctx.shell = zebar.shellExec ? zebar : null`, i.e. `shell` IS the
// zebar module, so the call is `shell.shellExec(HELPER, [])`, not
// `shell.exec(HELPER, [])`.
register('vesktop', ({ shell }) => {
  const el = document.createElement('div');
  el.className = 'vesktop';

  async function poll() {
    try {
      const { stdout } = await shell.shellExec(HELPER, []);
      const s = pingState(stdout);
      el.textContent = s.pinged ? String(s.count) : '';
      el.classList.toggle('vesktop--pinged', s.pinged);
      el.style.display = s.pinged ? '' : 'none';
    } catch (e) {
      console.error('vesktop poll failed', e);
      el.style.display = 'none';
    }
  }

  poll();
  setInterval(poll, 5000);
  return { el, update() {} };
});
