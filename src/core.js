// sticky-killer core: finds position: sticky elements and names what stops them sticking.
// No imports, no DOM globals at load time. It runs in a page (snippet, bookmarklet, extension)
// and in Node against plain objects (tests). The build strips the `export` keywords.

const INSET_PROPS = ['top', 'bottom', 'left', 'right'];
const SCROLLING = ['hidden', 'scroll', 'auto', 'overlay'];

export function prop(style, name) {
  if (!style) return '';
  return (style.getPropertyValue ? style.getPropertyValue(name) : style[name]) || '';
}

export function parentOf(el) {
  if (!el) return null;
  if (el.parentElement) return el.parentElement;
  const p = el.parentNode;
  // step out of a shadow root
  return p && p.host ? p.host : null;
}

export function stickyInsets(style) {
  const out = {};
  for (const side of INSET_PROPS) {
    const v = prop(style, side);
    if (v && v !== 'auto') out[side] = v;
  }
  return out;
}

export function axesOf(insets) {
  return { vertical: 'top' in insets || 'bottom' in insets, horizontal: 'left' in insets || 'right' in insets };
}

export function isScrollingValue(v) {
  return SCROLLING.indexOf(v) !== -1;
}

// An element is a scroll container for sticky purposes when overflow is hidden, scroll, auto
// or overlay on either axis. overflow: clip is not one. html never is (its overflow belongs to
// the viewport), and body is not one when html's overflow is visible (body's propagates up).
export function isScrollContainer(el, win) {
  const s = win.getComputedStyle(el);
  const ox = prop(s, 'overflow-x');
  const oy = prop(s, 'overflow-y');
  if (!isScrollingValue(ox) && !isScrollingValue(oy)) return false;
  const tag = String(el.tagName || '').toLowerCase();
  if (tag === 'html') return false;
  if (tag === 'body') {
    const html = el.parentElement;
    if (html) {
      const hs = win.getComputedStyle(html);
      if (prop(hs, 'overflow-x') === 'visible' && prop(hs, 'overflow-y') === 'visible') return false;
    }
  }
  return true;
}

// inert: nothing to scroll on the sticky axis, so sticky is pinned to a box that never moves.
// scrolls: a real scroller. hidden-overflowing: overflow hidden with content past the edge,
// which only scripts can scroll.
export function containerKind(el, win, insets) {
  const s = win.getComputedStyle(el);
  const ox = prop(s, 'overflow-x');
  const oy = prop(s, 'overflow-y');
  const ax = axesOf(insets);
  const canY = ax.vertical && isScrollingValue(oy) && el.scrollHeight > el.clientHeight + 1;
  const canX = ax.horizontal && isScrollingValue(ox) && el.scrollWidth > el.clientWidth + 1;
  if (!canY && !canX) return 'inert';
  const live = (canY && oy !== 'hidden') || (canX && ox !== 'hidden');
  return live ? 'scrolls' : 'hidden-overflowing';
}

export function describe(el) {
  if (!el) return '(none)';
  const tag = String(el.tagName || 'node').toLowerCase();
  if (tag === 'html' || tag === 'body') return tag;
  if (el.id) return tag + '#' + el.id;
  const cls = String(el.getAttribute ? el.getAttribute('class') || '' : '').split(/\s+/).filter(Boolean).slice(0, 2);
  let out = tag + cls.map((c) => '.' + c).join('');
  const p = el.parentElement;
  if (!cls.length && p && p.children && p.children.length > 1) {
    out += ':nth-child(' + (Array.prototype.indexOf.call(p.children, el) + 1) + ')';
  }
  return out;
}

// The containing block of a sticky element is its parent, skipping display: contents wrappers.
function blockParent(el, win) {
  let p = parentOf(el);
  while (p && prop(win.getComputedStyle(p), 'display') === 'contents') p = parentOf(p);
  return p;
}

function px(v) {
  const n = parseFloat(v);
  return isNaN(n) ? 0 : n;
}

// How far the element could travel inside its parent, measured with the sticky offsets switched
// off so we see its natural position. Only in a real DOM (needs layout).
export function measureRoom(el, win, insets) {
  const parent = blockParent(el, win);
  if (!parent || !el.style || !el.getBoundingClientRect) return null;
  const ps = win.getComputedStyle(parent);
  const es = win.getComputedStyle(el);
  const keep = ['position'].concat(INSET_PROPS).map((p) => [p, el.style.getPropertyValue(p), el.style.getPropertyPriority(p)]);
  el.style.setProperty('position', 'relative', 'important');
  INSET_PROPS.forEach((p) => el.style.setProperty(p, 'auto', 'important'));
  const er = el.getBoundingClientRect();
  const pr = parent.getBoundingClientRect();
  keep.forEach((k) => (k[1] ? el.style.setProperty(k[0], k[1], k[2]) : el.style.removeProperty(k[0])));
  const pTop = pr.top + px(prop(ps, 'border-top-width')) + px(prop(ps, 'padding-top'));
  const pBottom = pr.bottom - px(prop(ps, 'border-bottom-width')) - px(prop(ps, 'padding-bottom'));
  const pLeft = pr.left + px(prop(ps, 'border-left-width')) + px(prop(ps, 'padding-left'));
  const pRight = pr.right - px(prop(ps, 'border-right-width')) - px(prop(ps, 'padding-right'));
  const room = {};
  if ('top' in insets) room.top = pBottom - (er.bottom + px(prop(es, 'margin-bottom')));
  if ('bottom' in insets) room.bottom = er.top - px(prop(es, 'margin-top')) - pTop;
  if ('left' in insets) room.left = pRight - (er.right + px(prop(es, 'margin-right')));
  if ('right' in insets) room.right = er.left - px(prop(es, 'margin-left')) - pLeft;
  return {
    parent, room,
    parentDisplay: prop(ps, 'display'), alignSelf: prop(es, 'align-self'),
    alignItems: prop(ps, 'align-items'), flexDirection: prop(ps, 'flex-direction'),
  };
}

export function overflowFix(el, win) {
  const s = win.getComputedStyle(el);
  const ox = prop(s, 'overflow-x');
  const oy = prop(s, 'overflow-y');
  const css = {};
  // A pair like hidden + auto usually means one axis was set and the other was coerced.
  const coerced = (mine, other) => mine === 'auto' && (other === 'hidden' || other === 'clip');
  if (isScrollingValue(ox)) css['overflow-x'] = coerced(ox, oy) ? 'visible' : 'clip';
  if (isScrollingValue(oy)) css['overflow-y'] = coerced(oy, ox) ? 'visible' : 'clip';
  return css;
}

function cssText(css) {
  return Object.keys(css).map((k) => k + ': ' + css[k]).join('; ');
}

// Static analysis of one sticky element. Returns findings; each finding that can be fixed
// carries { target, css } so verify() can try it.
export function analyze(el, win) {
  const style = win.getComputedStyle(el);
  const insets = stickyInsets(style);
  const ax = axesOf(insets);
  const findings = [];
  const res = { element: el, selector: describe(el), insets, findings, status: 'unverified', engages: null };

  if (!ax.vertical && !ax.horizontal) {
    findings.push({
      code: 'no-inset', severity: 'break', target: el,
      message: 'position: sticky does nothing without at least one of top, bottom, left or right.',
      fix: { target: el, css: { top: '0' } },
    });
  }

  let p = parentOf(el);
  let ownsViewport = true;
  let nearest = true;
  while (p) {
    const tag = String(p.tagName || '').toLowerCase();
    if (tag === 'html') break;
    if (isScrollContainer(p, win)) {
      const kind = containerKind(p, win, insets);
      const ps = win.getComputedStyle(p);
      const ov = prop(ps, 'overflow-x') + ' / ' + prop(ps, 'overflow-y');
      if (kind === 'inert') {
        findings.push({
          code: 'inert-scroll-container', severity: 'break', target: p, nearest,
          message: describe(p) + ' has overflow ' + ov + ' but nothing to scroll' + (ax.vertical || ax.horizontal ? ' on the sticky axis' : '') +
            '. It is a scroll container that never scrolls, so the element sticks inside it, not to the page.' +
            (tag === 'body' ? ' html sets overflow too, so body is no longer handed to the viewport and becomes a box of its own.' : ''),
          fix: { target: p, css: overflowFix(p, win) },
        });
        nearest = false;
      } else {
        ownsViewport = false;
        findings.push({
          code: kind === 'scrolls' ? 'sticks-inside-scroller' : 'sticks-inside-hidden-scroller',
          severity: kind === 'scrolls' ? 'info' : 'warn', target: p,
          message: kind === 'scrolls'
            ? 'Sticks inside ' + describe(p) + ' (overflow ' + ov + '), which scrolls. That is how sticky is meant to work, but it will not stick to the page.'
            : describe(p) + ' has overflow ' + ov + ' and its content runs past the edge, but users cannot scroll it. The element sticks to a box only scripts can scroll.',
        });
        break;
      }
    }
    p = parentOf(p);
  }

  const m = (ax.vertical || ax.horizontal) ? measureRoom(el, win, insets) : null;
  if (m) {
    res.room = m.room;
    const blocked = Object.keys(m.room).filter((k) => m.room[k] <= 1);
    if (blocked.length) {
      const flex = /flex/.test(m.parentDisplay) && /^(row|row-reverse)?$/.test(m.flexDirection || 'row') && ax.vertical;
      const grid = /grid/.test(m.parentDisplay) && ax.vertical;
      const stretch = (flex || grid) && /^(auto|normal|stretch)$/.test(m.alignSelf) && /^(normal|stretch)$/.test(m.alignItems);
      findings.push({
        code: stretch ? 'stretched-in-flex-or-grid' : 'no-room-in-parent', severity: 'break', target: el,
        message: stretch
          ? 'The parent is a ' + (flex ? 'flex' : 'grid') + ' container and the element is stretched to its full height, so it has no room to move.'
          : 'The element already sits at the edge of its parent, with no room to move ' + blocked.map((k) => ({ top: 'down', bottom: 'up', left: 'right', right: 'left' })[k]).join(' or ') + '. Sticky only moves inside its parent, so there is nothing for it to do. Give the parent more height after the element, or move the element earlier.',
        fix: stretch ? { target: el, css: { 'align-self': flex ? 'flex-start' : 'start' } } : undefined,
      });
    }
  }
  res.status = findings.some((f) => f.severity === 'break') ? 'broken' : 'unverified';
  res.ownsViewport = ownsViewport;
  return res;
}

function isVisible(el) {
  return !el.getClientRects || el.getClientRects().length > 0;
}

function walkElements(root, out) {
  const all = root.querySelectorAll('*');
  for (let i = 0; i < all.length; i++) {
    out.push(all[i]);
    if (all[i].shadowRoot) walkElements(all[i].shadowRoot, out);
  }
  return out;
}

export function findStickyElements(doc, win) {
  return walkElements(doc, []).filter((el) => prop(win.getComputedStyle(el), 'position') === 'sticky' && isVisible(el));
}

// ---- verification: does the element really stick? Needs a real browser. ----

function nearestLiveScroller(el, win, ax) {
  let p = parentOf(el);
  const insets = {};
  if (ax.vertical) insets.top = '0';
  if (ax.horizontal) insets.left = '0';
  while (p) {
    if (String(p.tagName || '').toLowerCase() === 'html') break;
    if (isScrollContainer(p, win) && containerKind(p, win, insets) === 'scrolls') return p;
    p = parentOf(p);
  }
  return el.ownerDocument.scrollingElement || el.ownerDocument.documentElement;
}

function scrollTo(scroller, axis, pos, win) {
  const opt = axis === 'y' ? { top: pos, behavior: 'instant' } : { left: pos, behavior: 'instant' };
  const doc = scroller.ownerDocument;
  if (scroller === doc.scrollingElement || scroller === doc.documentElement) win.scrollTo(opt);
  else scroller.scrollTo(opt);
}

// Scrolls through the page and compares how far the element moved with how far it would have
// moved if it were not sticky. A difference means sticky engaged. The scroll position is restored.
export function probeEngages(el, win, samples) {
  const n = samples || 40;
  const insets = stickyInsets(win.getComputedStyle(el));
  const ax = axesOf(insets);
  const axes = [];
  if (ax.vertical) axes.push('y');
  if (ax.horizontal) axes.push('x');
  if (!axes.length) return { engages: false, measurable: true, reason: 'no inset' };
  const scroller = nearestLiveScroller(el, win, ax);
  const startY = scroller.scrollTop;
  const startX = scroller.scrollLeft;
  let measurable = false;
  let engages = false;
  try {
    for (const axis of axes) {
      const max = axis === 'y' ? scroller.scrollHeight - scroller.clientHeight : scroller.scrollWidth - scroller.clientWidth;
      if (max < 4) continue;
      measurable = true;
      let prev = null;
      for (let i = 0; i <= n && !engages; i++) {
        const pos = Math.round((max * i) / n);
        scrollTo(scroller, axis, pos, win);
        const r = el.getBoundingClientRect();
        const v = axis === 'y' ? r.top : r.left;
        if (prev && Math.abs(v - (prev.v - (pos - prev.pos))) > 1.5) engages = true;
        prev = { pos, v };
      }
      if (engages) break;
    }
  } finally {
    scrollTo(scroller, 'y', startY, win);
    scrollTo(scroller, 'x', startX, win);
  }
  return { engages, measurable, scroller };
}

function applyFix(fix) {
  const t = fix.target;
  const undo = Object.keys(fix.css).map((k) => [k, t.style.getPropertyValue(k), t.style.getPropertyPriority(k)]);
  Object.keys(fix.css).forEach((k) => t.style.setProperty(k, fix.css[k], 'important'));
  return () => undo.forEach((u) => (u[1] ? t.style.setProperty(u[0], u[1], u[2]) : t.style.removeProperty(u[0])));
}

// Runs the probe, then applies each suggested fix in turn (nearest first, cumulative) and probes
// again. The finding whose fix makes the element stick is marked confirmed. All changes are undone.
export function verify(res, win) {
  const el = res.element;
  const now = probeEngages(el, win);
  res.engages = now.measurable ? now.engages : null;
  if (!now.measurable) {
    res.status = res.findings.some((f) => f.severity === 'break') ? 'broken' : 'unverified';
    return res;
  }
  if (now.engages) {
    res.status = 'works';
    return res;
  }
  res.status = 'broken';
  const fixable = res.findings.filter((f) => f.severity === 'break' && f.fix);
  const undos = [];
  try {
    for (let i = 0; i < fixable.length; i++) {
      undos.push(applyFix(fixable[i].fix));
      const p = probeEngages(el, win);
      if (p.measurable && p.engages) {
        for (let j = 0; j <= i; j++) fixable[j].confirmed = true;
        break;
      }
    }
  } finally {
    undos.reverse().forEach((u) => u());
  }
  if (!res.findings.some((f) => f.severity === 'break' || f.severity === 'warn')) {
    res.findings.push({
      code: 'unexplained', severity: 'warn', target: el,
      message: 'It does not stick, and no overflow, inset or room problem explains it. A script may be moving the element, or the sticky range is empty.',
    });
  }
  return res;
}

export function diagnose(doc, win, opts) {
  const o = opts || {};
  const results = findStickyElements(doc, win).map((el) => analyze(el, win));
  if (o.verify !== false) results.forEach((r) => verify(r, win));
  return results;
}

export function fixText(f) {
  return f.fix ? describe(f.fix.target) + ' { ' + cssText(f.fix.css) + '; }' : '';
}

export function formatReport(results, title) {
  const lines = [];
  lines.push((title || 'sticky-killer') + ': ' + results.length + ' sticky element' + (results.length === 1 ? '' : 's') + ' found');
  results.forEach((r, i) => {
    const ins = Object.keys(r.insets).map((k) => k + ': ' + r.insets[k]).join('; ') || 'no inset';
    const tag = { works: 'WORKS', broken: 'BREAKS', unverified: 'UNVERIFIED' }[r.status] || r.status;
    lines.push('');
    lines.push('#' + (i + 1) + ' ' + r.selector + '  (position: sticky; ' + ins + ')  ' + tag);
    r.findings.forEach((f) => {
      lines.push('  ' + { break: 'BREAK', warn: 'WARN ', info: 'NOTE ' }[f.severity] + ' ' + f.message);
      if (f.fix) lines.push('       fix: ' + fixText(f) + (f.confirmed ? '   (confirmed: the element sticks once this is applied)' : ''));
    });
    if (r.status === 'works' && !r.findings.length) lines.push('  Sticks to the page as expected (measured by scrolling).');
    if (r.status === 'works' && r.findings.length) lines.push('  Measured by scrolling: it does stick.');
    if (r.status === 'unverified' && !r.findings.length) lines.push('  No blocker found. The page has nothing to scroll here, so stickiness could not be measured.');
  });
  return lines.join('\n');
}

export function toJSON(results) {
  return results.map((r) => ({
    selector: r.selector, status: r.status, engages: r.engages, insets: r.insets, room: r.room || null,
    findings: r.findings.map((f) => ({
      code: f.code, severity: f.severity, target: describe(f.target), message: f.message,
      fix: f.fix ? { target: describe(f.fix.target), css: f.fix.css, text: fixText(f) } : null,
      confirmed: !!f.confirmed,
    })),
  }));
}
