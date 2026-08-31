const { test } = require('node:test');
const assert = require('node:assert/strict');
const P = require('../page-access.js');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function callbackApi() {
  const calls = [];
  const page = { id: 42, windowId: 7, title: '测试页面', url: 'https://example.com/a' };
  const api = { runtime: { sendMessage() { throw new Error('worker unavailable'); } },
    windows: { getCurrent(options, cb) { cb({ id: 7 }); } },
    tabs: { query(query, cb) { calls.push(query); cb([page]); }, get(id, cb) { cb(page); } },
    scripting: { executeScript(options, cb) { calls.push(options.target); cb([{ result: { title: page.title, url: page.url, text: '测试正文'.repeat(30) } }]); } }
  };
  return { api, calls, page };
}
test('callback-only APIs locate and read without messaging a worker', async () => {
  const h = callbackApi(); const win = await P.getCurrentWindow(h.api);
  const active = await P.getActivePage(h.api, { windowId: win.id });
  const data = await P.extractPage(h.api, active);
  assert.equal(active.tabId, 42); assert.equal(data.tabId, 42); assert.match(data.text, /测试正文/);
  assert.deepEqual(h.calls, [{ active: true, windowId: 7 }, { tabId: 42 }]);
});
test('Promise APIs are also supported', async () => {
  const h = callbackApi(); h.api.tabs.query = async () => [h.page];
  assert.equal((await P.getActivePage(h.api)).tabId, 42);
});
test('unknown or negative window id falls back to last-focused only after current window is empty', async () => {
  const h = callbackApi(); h.api.tabs.query = (q, cb) => { h.calls.push(q); cb(q.currentWindow ? [] : [h.page]); };
  assert.equal((await P.getActivePage(h.api, { windowId: -1 })).tabId, 42);
  assert.deepEqual(h.calls, [{ active: true, currentWindow: true }, { active: true, lastFocusedWindow: true }]);
});
test('known window with no active tab does not silently read another window', async () => {
  const h = callbackApi(); h.api.tabs.query = (q, cb) => { h.calls.push(q); cb([]); };
  await assert.rejects(P.getActivePage(h.api, { windowId: 7 }), /没有返回活动标签页/);
  assert.equal(h.calls.length, 1);
});
test('native lastError reaches the caller instead of becoming null', async () => {
  const h = callbackApi(); h.api.tabs.query = (q, cb) => { h.api.runtime.lastError = { message: 'No window with id: 7' }; cb(); delete h.api.runtime.lastError; };
  await assert.rejects(P.getActivePage(h.api, { windowId: 7 }), /No window with id: 7/);
});
test('plain HTTP UI without extension APIs gives the correct actionable error', async () => {
  await assert.rejects(P.getActivePage({}), /从浏览器工具栏打开/);
});
test('invalid window response does not contaminate subsequent tab lookup', async () => {
  const h = callbackApi(); h.api.windows.getCurrent = (o, cb) => cb({ id: -1 });
  await assert.rejects(P.getCurrentWindow(h.api), /无法确定/);
  assert.equal((await P.getActivePage(h.api)).tabId, 42);
});
test('actual sidepanel pageRequest reads successfully when worker never replies', async () => {
  const h = callbackApi(); const source = fs.readFileSync(path.join(__dirname, '..', 'sidepanel.js'), 'utf8');
  const start = source.indexOf('  function pageRequest('), end = source.indexOf('  function renderSources(', start);
  const ctx = vm.createContext({ chrome: h.api, AnanPageAccess: P, panelWindowId: 7 });
  vm.runInContext(source.slice(start, end), ctx);
  const page = await ctx.pageRequest('getActivePage');
  assert.match((await ctx.pageRequest('extractPage', { tabId: page.tabId, expectedUrl: page.url })).text, /测试正文/);
});
