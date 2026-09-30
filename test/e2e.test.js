// End to end: real pages in a real headless Chrome or Edge. Skipped when none is installed
// (set CHROME_PATH to point at one). The fixtures live in test/fixtures.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { check, findChrome, inject, bundleText } from '../src/runner.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const fx = (n) => path.join(here, 'fixtures', n + '.html');
const chrome = findChrome();
const skip = chrome ? false : 'no Chrome or Edge found';

const codes = (r) => r.findings.map((f) => f.code);
const culprit = (r) => r.findings.find((f) => f.severity === 'break' && f.target !== r.selector);

test('wrapper with overflow-x: hidden is named and the fix is confirmed', { skip }, async () => {
  const [r] = await check(fx('wrapper-overflow'));
  assert.equal(r.status, 'broken');
  assert.equal(r.selector, 'header.hdr.site-header');
  assert.equal(culprit(r).target, 'div.page');
  assert.equal(culprit(r).confirmed, true);
  assert.deepEqual(culprit(r).fix.css, { 'overflow-x': 'clip', 'overflow-y': 'visible' });
});

test('html and body both setting overflow makes body the culprit', { skip }, async () => {
  const [r] = await check(fx('html-and-body'));
  assert.equal(r.status, 'broken');
  assert.equal(culprit(r).target, 'body');
  assert.equal(culprit(r).confirmed, true);
});

test('two nested inert containers are both needed', { skip }, async () => {
  const [r] = await check(fx('nested-inert'));
  const breaks = r.findings.filter((f) => f.code === 'inert-scroll-container');
  assert.deepEqual(breaks.map((f) => f.target), ['section.inner', 'div.outer']);
  assert.ok(breaks.every((f) => f.confirmed));
});

test('flex stretch is found and align-self fixes it', { skip }, async () => {
  const [r] = await check(fx('flex-stretch'));
  assert.deepEqual(codes(r), ['stretched-in-flex-or-grid']);
  assert.deepEqual(r.findings[0].fix.css, { 'align-self': 'flex-start' });
  assert.equal(r.findings[0].confirmed, true);
});

test('missing inset is found', { skip }, async () => {
  const [r] = await check(fx('no-inset'));
  assert.deepEqual(codes(r), ['no-inset']);
  assert.equal(r.findings[0].confirmed, true);
});

test('a sticky element at the end of its parent has no room', { skip }, async () => {
  const [r] = await check(fx('last-child'));
  assert.equal(r.status, 'broken');
  assert.deepEqual(codes(r), ['no-room-in-parent']);
});

test('shadow DOM: the host with overflow is named', { skip }, async () => {
  const [r] = await check(fx('shadow-dom'));
  assert.equal(r.selector, 'div#shadow-header');
  assert.equal(culprit(r).target, 'div#host');
  assert.equal(culprit(r).confirmed, true);
});

test('hidden overflow with content past the edge is flagged, not called broken', { skip }, async () => {
  const [r] = await check(fx('horizontal-sticky'));
  assert.deepEqual(codes(r), ['sticks-inside-hidden-scroller']);
});

test('working pages produce no findings', { skip }, async () => {
  for (const name of ['works', 'overflow-clip', 'transform-ancestors']) {
    const results = await check(fx(name));
    assert.equal(results.length, 1, name);
    assert.equal(results[0].status, 'works', name);
    assert.deepEqual(results[0].findings, [], name);
  }
});

test('transform, filter, contain, will-change and perspective do not break sticky (measured)', { skip }, async () => {
  const [r] = await check(fx('transform-ancestors'));
  assert.equal(r.engages, true);
});

test('a real inner scroller is a note, and sticky works inside it', { skip }, async () => {
  for (const name of ['inner-scroller', 'horizontal-scroller']) {
    const [r] = await check(fx(name));
    assert.equal(r.status, 'works', name);
    assert.deepEqual(codes(r), ['sticks-inside-scroller'], name);
  }
});

test('a page too short to scroll is reported as unverified, not broken', { skip }, async () => {
  const [r] = await check(fx('short-page'));
  assert.equal(r.status, 'unverified');
  assert.equal(r.engages, null);
});

test('--no-verify skips the scroll probe and keeps the static findings', { skip }, async () => {
  const [r] = await check(fx('wrapper-overflow'), { verify: false });
  assert.equal(culprit(r).target, 'div.page');
  assert.equal(culprit(r).confirmed, false);
});

test('the CLI exits 1 when something is blocked, 0 when not, 2 on a bad path', { skip }, () => {
  const bin = path.join(here, '..', 'bin', 'sticky-killer.mjs');
  const run = (...a) => spawnSync(process.execPath, [bin, ...a], { encoding: 'utf8' });
  assert.equal(run('check', fx('wrapper-overflow')).status, 1);
  assert.equal(run('check', fx('works')).status, 0);
  assert.equal(run('check', fx('does-not-exist')).status, 2);
  const out = run('check', fx('wrapper-overflow'), '--json');
  assert.equal(JSON.parse(out.stdout)[0].findings[0].target, 'div.page');
});

// The same bundle, run the way a user runs it: the snippet text and the bookmarklet text, with the panel.
function runInPage(code, page) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-e2e-'));
  const file = path.join(dir, 'p.html');
  const html = fs.readFileSync(page, 'utf8').replace('</body>',
    '<script>' + code + '</script><script>addEventListener("load",function(){setTimeout(function(){' +
    'var h=document.querySelector("[data-sticky-killer]");var pre=document.createElement("pre");pre.id="out";' +
    'pre.textContent=h?h.shadowRoot.textContent.replace(/\\s+/g," "):"NO PANEL";document.body.appendChild(pre);},300)});</script></body>');
  fs.writeFileSync(file, html);
  const args = ['--headless=new', '--disable-gpu', '--no-first-run', '--user-data-dir=' + path.join(dir, 'p'),
    '--window-size=1280,900', '--virtual-time-budget=4000', '--dump-dom'];
  if (process.env.STICKY_KILLER_NO_SANDBOX) args.push('--no-sandbox');
  args.push('file:///' + file.replace(/\\/g, '/'));
  const out = execFileSync(chrome, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* lock */ }
  const m = /<pre id="out">([^<]*)<\/pre>/.exec(out);
  return m ? m[1] : out.slice(0, 300);
}

test('the snippet shows the panel and names the culprit', { skip }, () => {
  const text = runInPage(bundleText(), fx('wrapper-overflow'));
  assert.match(text, /sticky-killer 1 sticky element/);
  assert.match(text, /header\.hdr\.site-header/);
  assert.match(text, /div\.page/);
  assert.match(text, /Try this fix/);
});

test('the bookmarklet URL runs as a script and shows the same panel', { skip }, () => {
  const url = fs.readFileSync(path.join(here, '..', 'dist', 'bookmarklet.txt'), 'utf8').trim();
  assert.ok(url.startsWith('javascript:'));
  const code = decodeURIComponent(url.slice('javascript:'.length));
  const text = runInPage(code, fx('wrapper-overflow'));
  assert.match(text, /div\.page/);
});

test('inject keeps the page and removes a CSP meta tag', () => {
  const html = '<html><head><meta http-equiv="Content-Security-Policy" content="script-src \'none\'"></head><body><p>x</p></body></html>';
  const out = inject(html, 'https://example.com/a/', 'var a=1;');
  assert.ok(!/Content-Security-Policy/i.test(out));
  assert.match(out, /<base href="https:\/\/example\.com\/a\/">/);
  assert.match(out, /var a=1;<\/script>/);
  assert.ok(out.indexOf('<p>x</p>') < out.indexOf('__STICKY_KILLER_MODE'));
});
