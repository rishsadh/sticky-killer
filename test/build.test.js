import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { build } from '../scripts/build.mjs';
import { findChrome, parseDump } from '../src/runner.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('committed dist and extension bundle match src (run npm run build)', () => {
  const p = spawnSync(process.execPath, [path.join(root, 'scripts', 'build.mjs'), '--check'], { encoding: 'utf8' });
  assert.equal(p.status, 0, p.stderr);
});

test('bookmarklet is one line, starts with javascript:, and has no raw spaces or quotes', () => {
  const { bookmarklet } = build();
  const url = bookmarklet.trim();
  assert.ok(url.startsWith('javascript:'));
  assert.equal(url.includes('\n'), false);
  assert.ok(/^[A-Za-z0-9%._~!*'()\-:]+$/.test(url), 'only URL-safe characters');
});

test('the bundle never contains a closing script tag (it is inlined into pages)', () => {
  assert.equal(/<\/script/i.test(build().snippet), false);
});

test('extension manifest is valid MV3 with the narrowest permissions', () => {
  const m = JSON.parse(fs.readFileSync(path.join(root, 'extension', 'manifest.json'), 'utf8'));
  assert.equal(m.manifest_version, 3);
  assert.deepEqual(m.permissions.sort(), ['activeTab', 'scripting']);
  assert.equal(m.host_permissions, undefined, 'no host permissions');
  for (const f of [m.background.service_worker, ...Object.values(m.icons)]) assert.ok(fs.existsSync(path.join(root, 'extension', f)), f);
  assert.ok(fs.existsSync(path.join(root, 'extension', 'sticky-killer.js')));
});

test('package.json bin and version are consistent', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const man = JSON.parse(fs.readFileSync(path.join(root, 'extension', 'manifest.json'), 'utf8'));
  assert.equal(man.version, pkg.version);
  assert.ok(fs.existsSync(path.join(root, pkg.bin['sticky-killer'])));
  assert.deepEqual(Object.keys(pkg.dependencies || {}), [], 'zero dependencies');
});

test('findChrome honours CHROME_PATH and returns null for a missing path', () => {
  assert.equal(findChrome({ CHROME_PATH: path.join(root, 'nope.exe') }, 'linux'), null);
  assert.equal(findChrome({ CHROME_PATH: process.execPath }, 'linux'), process.execPath);
});

test('parseDump reads the result and reports a missing one', () => {
  const payload = Buffer.from(JSON.stringify([{ selector: 'div', status: 'works' }])).toString('base64');
  assert.deepEqual(parseDump('<pre id="__sk_result">' + payload + '</pre>'), [{ selector: 'div', status: 'works' }]);
  assert.throws(() => parseDump('<html></html>'), /no result came back/);
  assert.throws(() => parseDump('<pre id="__sk_error">boom</pre>'), /boom/);
});

test('the CLI prints help, the snippet and the bookmarklet without a browser', () => {
  const bin = path.join(root, 'bin', 'sticky-killer.mjs');
  const run = (...a) => spawnSync(process.execPath, [bin, ...a], { encoding: 'utf8' });
  assert.match(run().stdout, /sticky-killer check/);
  assert.match(run('snippet').stdout, /window\.stickyKiller/);
  assert.ok(run('bookmarklet').stdout.startsWith('javascript:'));
  assert.equal(run('nonsense').status, 2);
});

test('README carries the measured table exactly as the research files produce it', async () => {
  const { table } = await import('../scripts/breakers-table.mjs');
  const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8').split(String.fromCharCode(13)).join('');
  assert.ok(readme.includes(table()), 'run node scripts/breakers-table.mjs and paste it into the README');
});

test('measured data agrees with what the detector assumes', () => {
  for (const b of ['chromium', 'webkit']) {
    const d = JSON.parse(fs.readFileSync(path.join(root, 'research', 'breakers-' + b + '.json'), 'utf8'));
    const by = (label) => d.rows.find((r) => r.label === label).sticks;
    assert.equal(d.date, '2026-09-30');
    assert.equal(by('baseline (no ancestor styling)'), true, b);
    assert.equal(by('overflow: hidden'), false, b);
    assert.equal(by('overflow: clip'), true, b);
    assert.equal(by('transform: translateZ(0)'), true, b);
    assert.equal(by('contain: paint'), true, b);
    assert.equal(by('no inset (top/bottom/left/right all auto)'), false, b);
  }
});
