const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'service-worker.js'), 'utf8');
function harness() {
  let listener;
  const calls = [];
  const tab = { id: 7, title: '原页面', url: 'https://example.com/a' };
  const chrome = {
    sidePanel: { setPanelBehavior: () => Promise.resolve() },
    contextMenus: { onClicked: { addListener() {} } },
    runtime: { onInstalled: { addListener() {} }, onMessage: { addListener(fn) { listener = fn; } } },
    tabs: { get: async id => { calls.push(['get', id]); return tab; },
      query: async query => { calls.push(['query', query]); return [tab]; } },
    scripting: { executeScript: async args => { calls.push(['extract', args.target.tabId]);
      return [{ result: { title: tab.title, url: tab.url, text: '正文内容'.repeat(40) } }]; } }
  };
  const ctx = vm.createContext({ chrome, console });
  ctx.importScripts = (...files) => files.forEach(f => vm.runInContext(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), ctx));
  vm.runInContext(source, ctx);
  return { chrome, tab, calls, request: msg => new Promise(resolve => listener(msg, {}, resolve)) };
}

test('routing metadata is window scoped and never extracts a page body', async () => {
  const h = harness(); const data = await h.request({ action: 'getActivePage', windowId: 22 });
  assert.equal(data.tabId, 7); assert.equal(data.text, undefined);
  assert.equal(h.calls[0][1].windowId, 22); assert.equal(h.calls[0][1].lastFocusedWindow, undefined);
  assert.equal(h.calls.length, 1);
});
test('extraction uses captured tab id, not a subsequently focused tab', async () => {
  const h = harness(); const data = await h.request({ action: 'extractPage', tabId: 7, expectedUrl: h.tab.url, windowId: 22 });
  assert.equal(data.tabId, 7); assert.ok(data.text);
  assert.deepEqual(h.calls, [['get', 7], ['extract', 7]]);
});
test('navigation before extraction rejects without reading another document', async () => {
  const h = harness(); const data = await h.request({ action: 'extractPage', tabId: 7, expectedUrl: 'https://example.com/old' });
  assert.match(data.error, /地址已变化/); assert.equal(h.calls.length, 1);
});
test('navigation during extraction also rejects the new document', async () => {
  const h = harness(); h.chrome.scripting.executeScript = async () => [{ result: { text: 'wrong', url: 'https://other.example/' } }];
  const data = await h.request({ action: 'extractPage', tabId: 7, expectedUrl: h.tab.url });
  assert.match(data.error, /发生跳转/); assert.equal(data.text, undefined);
});
test('closed and restricted tabs return actionable errors', async () => {
  const h = harness(); h.tab.url = 'chrome://settings';
  assert.match((await h.request({ action: 'extractPage', tabId: 7 })).error, /不是普通网页/);
  h.chrome.tabs.get = async () => { throw new Error('No tab with id: 7'); };
  assert.match((await h.request({ action: 'extractPage', tabId: 7 })).error, /No tab/);
});
