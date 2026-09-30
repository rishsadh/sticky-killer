// Measures which CSS properties on an ancestor stop position: sticky from sticking to the viewport.
// Dev tool only. It needs Playwright, which is NOT a dependency of this repo:
//   PLAYWRIGHT_DIR=/path/to/node_modules [BROWSER_PATH=/path/to/browser] node research/measure-breakers.mjs [chromium|webkit|firefox]
// The result is written to research/breakers-<browser>.json with the browser version and the date.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = process.env.PLAYWRIGHT_DIR;
const require = createRequire(import.meta.url);
const pw = dir ? require(path.join(dir, 'playwright')) : require('playwright');
const which = process.argv[2] || 'chromium';

// Each case styles ONE ancestor (#anc) of a sticky element. The ancestor is auto height, so it
// never scrolls by itself. "sticks" means the element pinned to top: 0 of the viewport.
const CASES = [
  ['baseline (no ancestor styling)', ''],
  ['overflow: hidden', 'overflow:hidden'],
  ['overflow: auto', 'overflow:auto'],
  ['overflow: scroll', 'overflow:scroll'],
  ['overflow: overlay', 'overflow:overlay'],
  ['overflow: clip', 'overflow:clip'],
  ['overflow-x: hidden', 'overflow-x:hidden'],
  ['overflow-x: clip', 'overflow-x:clip'],
  ['overflow-y: hidden', 'overflow-y:hidden'],
  ['overflow-x: clip + overflow-y: visible', 'overflow-x:clip;overflow-y:visible'],
  ['contain: paint', 'contain:paint'],
  ['contain: layout', 'contain:layout'],
  ['contain: strict', 'contain:strict;height:2500px;width:100%'],
  ['contain: content', 'contain:content'],
  ['content-visibility: auto', 'content-visibility:auto'],
  ['transform: translateZ(0)', 'transform:translateZ(0)'],
  ['filter: blur(0)', 'filter:blur(0)'],
  ['backdrop-filter: blur(1px)', 'backdrop-filter:blur(1px)'],
  ['perspective: 100px', 'perspective:100px'],
  ['will-change: transform', 'will-change:transform'],
  ['opacity: 0.99', 'opacity:.99'],
  ['position: relative', 'position:relative'],
  ['position: absolute', 'position:absolute;left:0;right:0;top:0'],
  ['isolation: isolate', 'isolation:isolate'],
  ['clip-path: inset(0)', 'clip-path:inset(0)'],
  ['container-type: inline-size', 'container-type:inline-size'],
  ['display: flow-root', 'display:flow-root'],
  ['display: contents', 'display:contents'],
];

function page(css) {
  return `<!doctype html><html><head><style>body{margin:0}</style></head><body>
<div id="anc" style="${css}">
  <div style="height:300px"></div>
  <div id="parent" style="height:1800px"><div id="s" style="position:sticky;top:0;height:50px;background:#c60"></div></div>
</div><div style="height:2500px"></div></body></html>`;
}
const SPECIAL = [
  ['html + body both overflow-x: hidden (body becomes the scroll container)',
    `<!doctype html><html style="overflow-x:hidden"><head><style>body{margin:0;overflow-x:hidden}</style></head><body><div style="height:300px"></div><div style="height:1800px"><div id="s" style="position:sticky;top:0;height:50px"></div></div><div style="height:2500px"></div></body></html>`],
  ['only body overflow-x: hidden (propagates to the viewport)',
    `<!doctype html><html><head><style>body{margin:0;overflow-x:hidden}</style></head><body><div style="height:300px"></div><div style="height:1800px"><div id="s" style="position:sticky;top:0;height:50px"></div></div><div style="height:2500px"></div></body></html>`],
  ['only html overflow-x: hidden (applies to the viewport)',
    `<!doctype html><html style="overflow-x:hidden"><head><style>body{margin:0}</style></head><body><div style="height:300px"></div><div style="height:1800px"><div id="s" style="position:sticky;top:0;height:50px"></div></div><div style="height:2500px"></div></body></html>`],
  ['no inset (top/bottom/left/right all auto)',
    `<!doctype html><html><head><style>body{margin:0}</style></head><body><div style="height:300px"></div><div style="height:1800px"><div id="s" style="position:sticky;height:50px"></div></div><div style="height:2500px"></div></body></html>`],
  ['parent is exactly as tall as the sticky element',
    `<!doctype html><html><head><style>body{margin:0}</style></head><body><div style="height:300px"></div><div style="height:50px"><div id="s" style="position:sticky;top:0;height:50px"></div></div><div style="height:2500px"></div></body></html>`],
  ['flex parent, child stretched by align-items: stretch',
    `<!doctype html><html><head><style>body{margin:0}</style></head><body><div style="height:300px"></div><div style="display:flex;height:1800px"><div id="s" style="position:sticky;top:0;width:100px;background:#c60"></div><div style="flex:1"></div></div><div style="height:2500px"></div></body></html>`],
  ['flex parent with align-self: flex-start on the sticky child',
    `<!doctype html><html><head><style>body{margin:0}</style></head><body><div style="height:300px"></div><div style="display:flex;height:1800px"><div id="s" style="position:sticky;top:0;width:100px;height:50px;align-self:flex-start;background:#c60"></div><div style="flex:1"></div></div><div style="height:2500px"></div></body></html>`],
];

const PROBE = async (p) => {
  await p.evaluate(() => window.scrollTo(0, 0));
  const before = await p.evaluate(() => document.getElementById('s').getBoundingClientRect().top);
  await p.evaluate(() => window.scrollTo(0, 800));
  const scrolled = await p.evaluate(() => window.scrollY);
  const after = await p.evaluate(() => document.getElementById('s').getBoundingClientRect().top);
  return { before, scrolled, after, sticks: Math.abs(after) < 1 && scrolled > before };
};

const browser = await pw[which].launch(process.env.BROWSER_PATH ? { executablePath: process.env.BROWSER_PATH } : {});
const version = browser.version();
const p = await browser.newPage({ viewport: { width: 900, height: 700 } });
const rows = [];
for (const [label, css] of CASES) {
  await p.setContent(page(css));
  rows.push({ label, css, ...(await PROBE(p)) });
}
for (const [label, html] of SPECIAL) {
  await p.setContent(html);
  rows.push({ label, css: null, ...(await PROBE(p)) });
}
await browser.close();
const out = { browser: which, version, date: new Date().toISOString().slice(0, 10), viewport: '900x700', rows };
fs.writeFileSync(path.join(here, `breakers-${which}.json`), JSON.stringify(out, null, 2) + '\n');
for (const r of rows) console.log((r.sticks ? 'sticks ' : 'BREAKS ') + r.label + `  (top ${Math.round(r.after)})`);
console.log(`${which} ${version}`);
