// Prints the README table of what breaks position: sticky, straight from research/breakers-*.json.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'research');

export function table() {
  const sets = ['chromium', 'webkit'].map((b) => JSON.parse(fs.readFileSync(path.join(dir, 'breakers-' + b + '.json'), 'utf8')));
  const head = '| Setup | ' + sets.map((s) => (s.browser === 'chromium' ? 'Chromium ' : 'WebKit ') + s.version).join(' | ') + ' |';
  const sep = '|---|' + sets.map(() => '---|').join('');
  const rows = sets[0].rows.map((r, i) => {
    const cells = sets.map((s) => (s.rows[i].sticks ? 'sticks' : '**breaks**'));
    return '| ' + r.label.replace(/\|/g, '/') + ' | ' + cells.join(' | ') + ' |';
  });
  return [head, sep, ...rows].join('\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) console.log(table());
