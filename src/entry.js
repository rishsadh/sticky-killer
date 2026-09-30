// Entry point for the page bundle. Set window.__STICKY_KILLER_MODE = 'headless' before loading
// the bundle to skip the panel and the console report (the CLI does this).

(function () {
  if (window.__stickyKillerClose) window.__stickyKillerClose();
  const api = { diagnose, formatReport, toJSON, analyze, verify, probeEngages, findStickyElements };
  window.stickyKiller = api;
  if (window.__STICKY_KILLER_MODE === 'headless') return;
  const results = diagnose(document, window, { verify: true });
  api.results = results;
  const text = formatReport(results, 'sticky-killer ' + location.host);
  console.log(text);
  results.forEach((r) => {
    console.log(r.selector, r.status, r.element);
    r.findings.forEach((f) => { if (f.target !== r.element) console.log('  ' + f.code, f.target); });
  });
  const culprit = results.map((r) => r.findings.find((f) => f.severity === 'break' && f.target !== r.element)).find(Boolean);
  // inspect() exists only in the DevTools console
  if (culprit && typeof inspect === 'function') inspect(culprit.target);
  skPanel(document, window, results);
})();
