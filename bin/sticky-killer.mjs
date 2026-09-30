#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { check, bundleText } from '../src/runner.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

const HELP = `sticky-killer ${pkg.version}: names the ancestor that stops position: sticky from sticking

  sticky-killer check <file.html|url> [--json] [--no-verify] [--viewport 1280x900] [--chrome PATH]
      Loads the page in a headless Chrome or Edge you already have, finds every sticky element,
      and names what blocks it. Exit code 1 when something is blocked, 0 when not, 2 on an error.
  sticky-killer snippet          Print the DevTools snippet (paste into Sources > Snippets).
  sticky-killer bookmarklet      Print the bookmarklet URL (make a bookmark, paste it as the URL).
  sticky-killer extension <dir>  Copy the unpacked Chrome extension to <dir> (chrome://extensions, Load unpacked).
  sticky-killer --version

check works on static HTML. For a page that needs its own logins or API calls, run the snippet,
bookmarklet or extension inside your own browser instead.
`;

function fail(msg) {
  console.error('sticky-killer: ' + msg);
  process.exit(2);
}

function wrap(text, first, rest, width = 100) {
  const words = text.split(' ');
  const lines = [];
  let line = first;
  for (const w of words) {
    if (line.trim() && line.length + w.length + 1 > width) { lines.push(line); line = rest; }
    line += (line.endsWith(' ') ? '' : ' ') + w;
  }
  lines.push(line);
  return lines;
}

function formatText(results, target) {
  const lines = ['sticky-killer ' + target + ': ' + results.length + ' sticky element' + (results.length === 1 ? '' : 's') + ' found'];
  results.forEach((r, i) => {
    const ins = Object.keys(r.insets).map((k) => k + ': ' + r.insets[k]).join('; ') || 'no inset';
    const tag = { works: 'WORKS', broken: 'BREAKS', unverified: 'UNVERIFIED' }[r.status] || r.status;
    lines.push('', '#' + (i + 1) + ' ' + r.selector + '  (position: sticky; ' + ins + ')  ' + tag);
    for (const f of r.findings) {
      lines.push(...wrap(f.message, '  ' + { break: 'BREAK', warn: 'WARN ', info: 'NOTE ' }[f.severity], '        '));
      if (f.fix) lines.push('        fix: ' + f.fix.text + (f.confirmed ? '  [confirmed: it sticks once applied]' : ''));
    }
    if (r.status === 'works') lines.push('  Sticks as expected (measured by scrolling).');
    if (r.status === 'unverified' && !r.findings.length) lines.push('  No blocker found, but the page had nothing to scroll so it could not be measured.');
  });
  return lines.join('\n');
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') { console.log(HELP); return; }
  if (cmd === '--version' || cmd === '-v') { console.log(pkg.version); return; }
  if (cmd === 'snippet') { process.stdout.write(bundleText()); return; }
  if (cmd === 'bookmarklet') { process.stdout.write(fs.readFileSync(path.join(root, 'dist', 'bookmarklet.txt'), 'utf8')); return; }
  if (cmd === 'extension') {
    const dir = rest[0];
    if (!dir) fail('usage: sticky-killer extension <dir>');
    fs.mkdirSync(dir, { recursive: true });
    for (const f of fs.readdirSync(path.join(root, 'extension'))) fs.copyFileSync(path.join(root, 'extension', f), path.join(dir, f));
    console.log('copied the extension to ' + path.resolve(dir) + '\nOpen chrome://extensions, turn on Developer mode, choose Load unpacked, and pick that folder.');
    return;
  }
  if (cmd === 'check') {
    const flags = { json: false, verify: true, viewport: undefined, chrome: undefined };
    let target;
    for (let i = 0; i < rest.length; i++) {
      const a = rest[i];
      if (a === '--json') flags.json = true;
      else if (a === '--no-verify') flags.verify = false;
      else if (a === '--viewport') flags.viewport = rest[++i];
      else if (a === '--chrome') flags.chrome = rest[++i];
      else if (a.startsWith('--')) fail('unknown option ' + a);
      else target = a;
    }
    if (!target) fail('usage: sticky-killer check <file.html|url>');
    let results;
    try { results = await check(target, flags); } catch (e) { fail(e.message); }
    console.log(flags.json ? JSON.stringify(results, null, 2) : formatText(results, target));
    process.exit(results.some((r) => r.status === 'broken') ? 1 : 0);
  }
  fail('unknown command ' + cmd + '. Run sticky-killer --help');
}

main().catch((e) => fail(e.stack || e.message));
