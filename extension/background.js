// Runs the bundle in the active tab when the toolbar button is clicked. activeTab means the
// extension touches only the tab you click it on, and only at that moment.
chrome.action.onClicked.addListener((tab) => {
  if (!tab.id) return;
  chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['sticky-killer.js'], world: 'MAIN' });
});
