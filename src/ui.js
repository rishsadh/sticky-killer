// The on-page panel for the snippet, bookmarklet and extension. It lists each sticky element,
// outlines the elements involved, and can preview a fix. Close puts everything back.
// Uses functions from core.js (the build puts both in one scope).

function skPanel(doc, win, results) {
  const outlined = [];
  const previews = [];

  function outline(el, color, style) {
    outlined.push([el, el.style.getPropertyValue('outline'), el.style.getPropertyPriority('outline'), el.style.getPropertyValue('outline-offset')]);
    el.style.setProperty('outline', '3px ' + style + ' ' + color, 'important');
    el.style.setProperty('outline-offset', '-3px', 'important');
  }

  results.forEach((r) => {
    outline(r.element, '#d98a5e', 'solid');
    r.findings.forEach((f) => {
      if (f.severity === 'break' && f.target !== r.element) outline(f.target, '#e5484d', 'dashed');
    });
  });

  const host = doc.createElement('div');
  host.setAttribute('data-sticky-killer', '');
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = '<style>' +
    ':host{all:initial}' +
    '.box{position:fixed;right:12px;bottom:12px;width:420px;max-width:calc(100vw - 24px);max-height:70vh;overflow:auto;z-index:2147483647;' +
    'background:#141619;color:#ece9e4;font:13px/1.45 ui-monospace,Menlo,Consolas,monospace;border:1px solid #2b3036;border-radius:8px;box-shadow:0 8px 30px rgba(0,0,0,.45)}' +
    '.h{display:flex;justify-content:space-between;align-items:center;padding:10px 12px;border-bottom:1px solid #2b3036;position:sticky;top:0;background:#141619}' +
    '.h b{color:#d98a5e;font-weight:600}.item{padding:10px 12px;border-bottom:1px solid #22262b}' +
    '.sel{color:#ece9e4;font-weight:600}.ok{color:#6cc08f}.bad{color:#e07a6f}.warn{color:#d8a947}.note{color:#9aa3ad}' +
    'code{display:block;margin:4px 0 0;padding:6px 8px;background:#0f1113;border-radius:4px;color:#c9d0d7;white-space:pre-wrap}' +
    'button{font:inherit;color:#ece9e4;background:#22262b;border:1px solid #3a4047;border-radius:4px;padding:3px 8px;margin:6px 6px 0 0;cursor:pointer}' +
    'button:hover{background:#2b3036}.f{margin-top:6px}</style><div class="box"></div>';
  const box = root.querySelector('.box');

  const head = doc.createElement('div');
  head.className = 'h';
  head.innerHTML = '<span><b>sticky-killer</b> ' + results.length + ' sticky element' + (results.length === 1 ? '' : 's') + '</span>';
  const close = doc.createElement('button');
  close.textContent = 'Close';
  head.appendChild(close);
  box.appendChild(head);

  if (!results.length) {
    const none = doc.createElement('div');
    none.className = 'item note';
    none.textContent = 'No visible element has position: sticky on this page.';
    box.appendChild(none);
  }

  results.forEach((r, i) => {
    const item = doc.createElement('div');
    item.className = 'item';
    const cls = { works: 'ok', broken: 'bad', unverified: 'warn' }[r.status];
    const label = { works: 'sticks', broken: 'broken', unverified: 'not measured' }[r.status];
    const title = doc.createElement('div');
    title.innerHTML = '<span class="sel"></span> <span class="' + cls + '">' + label + '</span>';
    title.firstChild.textContent = '#' + (i + 1) + ' ' + r.selector;
    item.appendChild(title);
    const show = doc.createElement('button');
    show.textContent = 'Show';
    show.onclick = () => r.element.scrollIntoView({ block: 'center', behavior: 'smooth' });
    item.appendChild(show);
    r.findings.forEach((f) => {
      const d = doc.createElement('div');
      d.className = 'f ' + { break: 'bad', warn: 'warn', info: 'note' }[f.severity];
      d.textContent = { break: 'BREAKS: ', warn: 'CHECK: ', info: 'NOTE: ' }[f.severity] + f.message;
      item.appendChild(d);
      if (f.fix) {
        const c = doc.createElement('code');
        c.textContent = fixText(f) + (f.confirmed ? '\n(confirmed by measuring)' : '');
        item.appendChild(c);
        const b = doc.createElement('button');
        b.textContent = 'Try this fix';
        let undo = null;
        b.onclick = () => {
          if (undo) { undo(); undo = null; b.textContent = 'Try this fix'; return; }
          const t = f.fix.target;
          const old = Object.keys(f.fix.css).map((k) => [k, t.style.getPropertyValue(k), t.style.getPropertyPriority(k)]);
          Object.keys(f.fix.css).forEach((k) => t.style.setProperty(k, f.fix.css[k], 'important'));
          undo = () => old.forEach((o) => (o[1] ? t.style.setProperty(o[0], o[1], o[2]) : t.style.removeProperty(o[0])));
          previews.push(() => undo && undo());
          b.textContent = 'Undo fix';
        };
        item.appendChild(b);
        const hit = doc.createElement('button');
        hit.textContent = 'Show ' + describe(f.fix.target);
        hit.onclick = () => f.fix.target.scrollIntoView({ block: 'center', behavior: 'smooth' });
        item.appendChild(hit);
      }
    });
    box.appendChild(item);
  });

  function dispose() {
    previews.forEach((u) => u());
    outlined.forEach((o) => {
      if (o[1]) o[0].style.setProperty('outline', o[1], o[2]); else o[0].style.removeProperty('outline');
      if (o[3]) o[0].style.setProperty('outline-offset', o[3]); else o[0].style.removeProperty('outline-offset');
    });
    host.remove();
    win.__stickyKillerClose = null;
  }
  close.onclick = dispose;
  doc.documentElement.appendChild(host);
  win.__stickyKillerClose = dispose;
  return dispose;
}
