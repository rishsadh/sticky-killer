// Builds the page bundle from src/: the devtools snippet, the bookmarklet and the extension copy.
// Usage: node scripts/build.mjs          write the files
//        node scripts/build.mjs --check  exit 1 if the committed files are out of date
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8').replace(/\r\n/g, '\n');

export function bundle() {
  const parts = ['src/core.js', 'src/ui.js', 'src/entry.js'].map((f) => read(f).replace(/^export /gm, ''));
  return parts.join('\n');
}

export function build() {
  const version = JSON.parse(read('package.json')).version;
  const header = '// sticky-killer ' + version + ': names the ancestor that stops position: sticky from sticking.\n' +
    '// Paste into DevTools > Sources > Snippets (or the Console) and run it. MIT. https://github.com/rishsadh/sticky-killer\n';
  const snippet = header + '(function () {\n' + bundle() + '\n})();\n';
  // Bookmarklet: drop comments and indentation, join with spaces. The source ends every statement with a semicolon.
  const small = bundle()
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('//'))
    .map((l) => {
      // Joining lines would let a trailing comment swallow the next statement.
      if (/\s\/\/\s/.test(l.replace(/'[^']*'|"[^"]*"/g, ''))) throw new Error('trailing comment, move it to its own line: ' + l);
      return l;
    })
    .join(' ');
  const bookmarklet = 'javascript:' + encodeURIComponent('(function(){' + small + '})();void 0');
  return { snippet, bookmarklet: bookmarklet + '\n' };
}

const out = { 'dist/sticky-killer.js': 'snippet', 'extension/sticky-killer.js': 'snippet', 'dist/bookmarklet.txt': 'bookmarklet' };

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const b = build();
  let stale = 0;
  for (const [file, key] of Object.entries(out)) {
    const target = path.join(root, file);
    if (process.argv.includes('--check')) {
      const have = fs.existsSync(target) ? fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n') : '';
      if (have !== b[key]) { console.error('out of date: ' + file); stale++; }
    } else {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, b[key]);
      console.log('wrote ' + file + ' (' + b[key].length + ' bytes)');
    }
  }
  if (stale) process.exit(1);
}
