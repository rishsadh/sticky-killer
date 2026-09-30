// Unit tests for the decision logic, run against plain objects (no browser needed).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  prop, parentOf, stickyInsets, axesOf, isScrollingValue, isScrollContainer, containerKind,
  describe, overflowFix, analyze, formatReport, toJSON, fixText,
} from '../src/core.js';

// A tiny fake DOM: el(tag, style, parent, extra)
function el(tag, style = {}, parent = null, extra = {}) {
  const node = {
    tagName: tag.toUpperCase(), _style: style, parentElement: parent, children: [],
    scrollHeight: 100, clientHeight: 100, scrollWidth: 100, clientWidth: 100,
    getAttribute: (n) => (n === 'class' ? extra.class || '' : null), id: extra.id || '', ...extra,
  };
  if (parent) parent.children.push(node);
  return node;
}
const win = { getComputedStyle: (n) => ({ 'overflow-x': 'visible', 'overflow-y': 'visible', position: 'static', ...n._style }) };

test('prop reads plain objects and CSSStyleDeclaration-like objects', () => {
  assert.equal(prop({ top: '0px' }, 'top'), '0px');
  assert.equal(prop({ getPropertyValue: (n) => n + '!' }, 'top'), 'top!');
  assert.equal(prop(null, 'top'), '');
});

test('stickyInsets ignores auto and empty values', () => {
  assert.deepEqual(stickyInsets({ top: '0px', bottom: 'auto', left: '', right: '12px' }), { top: '0px', right: '12px' });
  assert.deepEqual(axesOf({ top: '0px' }), { vertical: true, horizontal: false });
  assert.deepEqual(axesOf({ left: '0px', bottom: '1px' }), { vertical: true, horizontal: true });
});

test('isScrollingValue: clip and visible are not scroll containers', () => {
  for (const v of ['hidden', 'scroll', 'auto', 'overlay']) assert.equal(isScrollingValue(v), true, v);
  for (const v of ['visible', 'clip', '']) assert.equal(isScrollingValue(v), false, v);
});

test('isScrollContainer: hidden on one axis counts, clip does not', () => {
  const div = el('div', { 'overflow-x': 'hidden', 'overflow-y': 'auto' });
  assert.equal(isScrollContainer(div, win), true);
  assert.equal(isScrollContainer(el('div', { 'overflow-x': 'clip', 'overflow-y': 'clip' }), win), false);
  assert.equal(isScrollContainer(el('div'), win), false);
});

test('html is never a scroll container, body is one only when html is not visible', () => {
  const html = el('html', { 'overflow-x': 'hidden', 'overflow-y': 'auto' });
  assert.equal(isScrollContainer(html, win), false);
  const plainHtml = el('html');
  const body = el('body', { 'overflow-x': 'hidden', 'overflow-y': 'auto' }, plainHtml);
  assert.equal(isScrollContainer(body, win), false, 'body overflow propagates to the viewport');
  const setHtml = el('html', { 'overflow-x': 'hidden', 'overflow-y': 'auto' });
  const body2 = el('body', { 'overflow-x': 'hidden', 'overflow-y': 'auto' }, setHtml);
  assert.equal(isScrollContainer(body2, win), true, 'html set overflow, so body is its own box');
});

test('containerKind: inert, scrolls and hidden-overflowing', () => {
  const vertical = { top: '0px' };
  assert.equal(containerKind(el('div', { 'overflow-y': 'auto' }), win, vertical), 'inert');
  assert.equal(containerKind(el('div', { 'overflow-y': 'auto' }, null, { scrollHeight: 900 }), win, vertical), 'scrolls');
  assert.equal(containerKind(el('div', { 'overflow-y': 'hidden', 'overflow-x': 'hidden' }, null, { scrollHeight: 900 }), win, vertical), 'hidden-overflowing');
  // horizontal overflow does not matter for a top offset
  assert.equal(containerKind(el('div', { 'overflow-x': 'auto' }, null, { scrollWidth: 900 }), win, vertical), 'inert');
  assert.equal(containerKind(el('div', { 'overflow-x': 'auto', 'overflow-y': 'auto' }, null, { scrollWidth: 900 }), win, { left: '0px' }), 'scrolls');
});

test('describe: id beats class, body and html stay bare, nth-child is the fallback', () => {
  const root = el('body');
  const a = el('div', {}, root, { id: 'main', class: 'x y z' });
  const b = el('section', {}, root, { class: 'wrap big huge' });
  const c = el('p', {}, root);
  assert.equal(describe(a), 'div#main');
  assert.equal(describe(b), 'section.wrap.big');
  assert.equal(describe(c), 'p:nth-child(3)');
  assert.equal(describe(root), 'body');
  assert.equal(describe(null), '(none)');
});

test('parentOf steps out of a shadow root', () => {
  const host = el('div');
  const inner = { tagName: 'DIV', parentElement: null, parentNode: { host } };
  assert.equal(parentOf(inner), host);
  assert.equal(parentOf({ parentElement: null, parentNode: null }), null);
});

test('overflowFix prefers clip, and frees the coerced axis', () => {
  assert.deepEqual(overflowFix(el('div', { 'overflow-x': 'hidden', 'overflow-y': 'hidden' }), win), { 'overflow-x': 'clip', 'overflow-y': 'clip' });
  assert.deepEqual(overflowFix(el('div', { 'overflow-x': 'hidden', 'overflow-y': 'auto' }), win), { 'overflow-x': 'clip', 'overflow-y': 'visible' });
  assert.deepEqual(overflowFix(el('div', { 'overflow-x': 'auto', 'overflow-y': 'hidden' }), win), { 'overflow-x': 'visible', 'overflow-y': 'clip' });
  assert.deepEqual(overflowFix(el('div', { 'overflow-x': 'auto', 'overflow-y': 'auto' }), win), { 'overflow-x': 'clip', 'overflow-y': 'clip' });
});

test('analyze: nearest inert container is named, nearest first', () => {
  const html = el('html');
  const body = el('body', {}, html);
  const outer = el('div', { 'overflow-x': 'hidden', 'overflow-y': 'hidden' }, body, { class: 'outer' });
  const inner = el('section', { 'overflow-y': 'auto', 'overflow-x': 'auto' }, outer, { class: 'inner' });
  const sticky = el('header', { position: 'sticky', top: '0px' }, inner, { id: 'hdr' });
  const r = analyze(sticky, win);
  const breaks = r.findings.filter((f) => f.severity === 'break');
  assert.deepEqual(breaks.map((f) => f.code), ['inert-scroll-container', 'inert-scroll-container']);
  assert.equal(describe(breaks[0].target), 'section.inner');
  assert.equal(breaks[0].nearest, true);
  assert.equal(breaks[1].nearest, false);
  assert.equal(describe(breaks[1].target), 'div.outer');
  assert.equal(r.status, 'broken');
  assert.match(fixText(breaks[0]), /section\.inner \{ overflow-x: clip; overflow-y: clip; \}/);
});

test('analyze: a real scroller ends the walk and is reported as a note', () => {
  const body = el('body');
  const far = el('div', { 'overflow-y': 'hidden', 'overflow-x': 'hidden' }, body);
  const box = el('div', { 'overflow-y': 'auto', 'overflow-x': 'auto' }, far, { class: 'box', scrollHeight: 1500 });
  const sticky = el('header', { position: 'sticky', top: '0px' }, box);
  const r = analyze(sticky, win);
  assert.deepEqual(r.findings.map((f) => f.code), ['sticks-inside-scroller']);
  assert.equal(r.findings[0].severity, 'info');
  assert.equal(r.status, 'unverified');
  assert.equal(r.ownsViewport, false);
});

test('analyze: hidden overflow with content past the edge is a warning', () => {
  const body = el('body');
  const box = el('div', { 'overflow-x': 'hidden', 'overflow-y': 'auto' }, body, { scrollWidth: 3000 });
  const sticky = el('div', { position: 'sticky', left: '0px' }, box);
  const r = analyze(sticky, win);
  assert.equal(r.findings[0].code, 'sticks-inside-hidden-scroller');
  assert.equal(r.findings[0].severity, 'warn');
});

test('analyze: no inset is reported with a top: 0 fix', () => {
  const body = el('body');
  const sticky = el('header', { position: 'sticky', top: 'auto', bottom: 'auto', left: 'auto', right: 'auto' }, body);
  const r = analyze(sticky, win);
  assert.equal(r.findings[0].code, 'no-inset');
  assert.deepEqual(r.findings[0].fix.css, { top: '0' });
});

test('analyze: a clean tree has no findings', () => {
  const body = el('body');
  const wrap = el('div', { 'overflow-x': 'clip', 'overflow-y': 'clip' }, body);
  const sticky = el('header', { position: 'sticky', top: '0px' }, wrap);
  assert.deepEqual(analyze(sticky, win).findings, []);
});

test('formatReport and toJSON carry the same story', () => {
  const body = el('body');
  const wrap = el('div', { 'overflow-x': 'hidden', 'overflow-y': 'auto' }, body, { class: 'page' });
  const sticky = el('header', { position: 'sticky', top: '0px' }, wrap, { id: 'hdr' });
  const results = [analyze(sticky, win)];
  results[0].findings[0].confirmed = true;
  const text = formatReport(results, 'demo');
  assert.match(text, /^demo: 1 sticky element found/);
  assert.match(text, /header#hdr/);
  assert.match(text, /div\.page \{ overflow-x: clip; overflow-y: visible; \}/);
  assert.match(text, /confirmed/);
  const json = toJSON(results);
  assert.equal(json[0].findings[0].target, 'div.page');
  assert.equal(json[0].findings[0].confirmed, true);
  assert.equal(JSON.parse(JSON.stringify(json))[0].selector, 'header#hdr');
});
