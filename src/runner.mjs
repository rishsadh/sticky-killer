// Node side of the CLI: loads a page, injects the bundle, runs it in headless Chrome or Edge that
// is already installed, and reads the result back. No dependencies.
import { spawnSync, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function findChrome(env = process.env, platform = process.platform) {
  const pick = (list) => list.find((p) => p && fs.existsSync(p));
  if (env.CHROME_PATH) return fs.existsSync(env.CHROME_PATH) ? env.CHROME_PATH : null;
  if (platform === 'win32') {
    const roots = [env.PROGRAMFILES, env['PROGRAMFILES(X86)'], env.LOCALAPPDATA].filter(Boolean);
    const rel = ['Google\\Chrome\\Application\\chrome.exe', 'Microsoft\\Edge\\Application\\msedge.exe', 'Chromium\\Application\\chrome.exe'];
    return pick(roots.flatMap((r) => rel.map((x) => path.join(r, x)))) || null;
  }
  if (platform === 'darwin') {
    return pick([
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
    ]) || null;
  }
  for (const name of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge']) {
    try {
      const out = execFileSync('which', [name], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      if (out) return out;
    } catch (e) { /* not on PATH */ }
  }
  return null;
}

export function bundleText() {
  return fs.readFileSync(path.join(root, 'dist', 'sticky-killer.js'), 'utf8');
}

export async function loadSource(target) {
  if (/^https?:\/\//i.test(target)) {
    const res = await fetch(target, { headers: { 'user-agent': 'sticky-killer (+https://github.com/rishsadh/sticky-killer)' } });
    if (!res.ok) throw new Error('could not fetch ' + target + ': HTTP ' + res.status);
    return { html: await res.text(), base: res.url || target };
  }
  const file = path.resolve(target);
  if (!fs.existsSync(file)) throw new Error('no such file: ' + file);
  return { html: fs.readFileSync(file, 'utf8'), base: pathToFileURL(file).href };
}

export function inject(html, base, bundle, opts = {}) {
  let out = html.replace(/<meta[^>]+http-equiv\s*=\s*["']?content-security-policy["']?[^>]*>/gi, '');
  const head = '<meta charset="utf-8">' + (/<base[\s>]/i.test(out) ? '' : '<base href="' + base.replace(/"/g, '&quot;') + '">');
  if (/<head[^>]*>/i.test(out)) out = out.replace(/<head[^>]*>/i, (m) => m + head);
  else if (/<html[^>]*>/i.test(out)) out = out.replace(/<html[^>]*>/i, (m) => m + '<head>' + head + '</head>');
  else out = head + out;
  const verify = opts.verify === false ? 'false' : 'true';
  const tail =
    '<script>window.__STICKY_KILLER_MODE="headless";</script><script>' + bundle + '</script>' +
    '<script>(function(){function done(){var pre=document.createElement("pre");try{' +
    'var r=stickyKiller.diagnose(document,window,{verify:' + verify + '});' +
    'var j=JSON.stringify(stickyKiller.toJSON(r));pre.id="__sk_result";pre.textContent=btoa(unescape(encodeURIComponent(j)));' +
    '}catch(e){pre.id="__sk_error";pre.textContent=String(e&&e.message||e);}document.body.appendChild(pre);}' +
    'function go(){setTimeout(done,' + (opts.wait || 400) + ');}' +
    'if(document.readyState==="complete")go();else addEventListener("load",go);})();</script>';
  return /<\/body>/i.test(out) ? out.replace(/<\/body>/i, () => tail + '</body>') : out + tail;
}

export function parseDump(dump) {
  const ok = /id="__sk_result"[^>]*>([A-Za-z0-9+/=]+)</.exec(dump);
  if (ok) return JSON.parse(Buffer.from(ok[1], 'base64').toString('utf8'));
  const err = /id="__sk_error"[^>]*>([^<]*)</.exec(dump);
  if (err) throw new Error('the page run failed: ' + err[1]);
  throw new Error('no result came back. The page may have blocked the script, or Chrome did not finish loading it.');
}

export async function check(target, opts = {}) {
  const chrome = opts.chrome || findChrome();
  if (!chrome) throw new Error('no Chrome or Edge found. Set CHROME_PATH, or use the snippet or bookmarklet in your own browser.');
  const { html, base } = await loadSource(target);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sticky-killer-'));
  const page = path.join(dir, 'page.html');
  fs.writeFileSync(page, inject(html, base, bundleText(), opts));
  const [w, h] = (opts.viewport || '1280x900').split('x').map(Number);
  const args = [
    '--headless=new', '--disable-gpu', '--no-first-run', '--disable-extensions', '--allow-file-access-from-files',
    '--user-data-dir=' + path.join(dir, 'profile'), '--window-size=' + w + ',' + h,
    '--virtual-time-budget=' + (opts.budget || 6000), '--dump-dom',
  ];
  if (process.env.STICKY_KILLER_NO_SANDBOX) args.push('--no-sandbox');
  args.push(pathToFileURL(page).href);
  try {
    const p = spawnSync(chrome, args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: 90000 });
    if (p.error) throw p.error;
    return parseDump(p.stdout || '');
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* a lock on Windows; the OS temp cleaner gets it */ }
  }
}
