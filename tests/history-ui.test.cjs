const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const C = require('../conversation.js');
const L = require('../chat-library.js');
const source = fs.readFileSync(path.join(__dirname, '..', 'sidepanel.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '..', 'sidepanel.html'), 'utf8');
function setup(incognito = false) {
  const normal = {}, session = {};
  const storage = data => ({ get: async key => key === null ? data : { [key]: data[key] },
    set: async value => Object.assign(data, structuredClone(value)), remove: async key => { delete data[key]; } });
  const element = () => ({ style: {}, classList: { add() {} }, replaceChildren() {}, append() {}, setAttribute() {}, addEventListener() {} });
  const ctx = vm.createContext({ AnanConversation: C, AnanChatLibrary: L,
    AnanPageAccess: { getCurrentWindow: async () => ({ id: 77, incognito }) },
    chrome: { storage: { local: storage(normal), session: storage(session) } },
    conversation: C.create(), conversationKey: null, panelWindowId: null, historyStorage: null,
    chatId: L.newId(), chatCreatedAt: Date.now(), persistQueue: Promise.resolve(), isPreparing: false,
    isBusy: () => false, updateStreamingUI() {}, renderSources() {}, finalizeAssistantMessage() {},
    addMessage: element, messagesEl: element(), welcomeEl: element(), chatHistoryList: element(),
    document: { createElement: element }, closeDrawer() {}, autoResize() {}, updateHint() {},
    userInput: { ...element(), value: '', focus() {} }, toolMenu: element(), confirm: () => true, console });
  vm.runInContext(source.slice(source.indexOf('  async function restoreConversation('), source.indexOf('  function pageRequest(')), ctx);
  vm.runInContext(source.slice(source.indexOf('  async function resetChat('), source.indexOf('  function runQuickAction(')), ctx);
  return { ctx, normal, session };
}

test('drawer contains real history and bottom settings; welcome quick cards removed', () => {
  assert.ok(!html.includes('快速操作')); assert.ok(!html.includes('drawerSummaryBtn'));
  assert.match(html, /id="chatHistoryList"/);
  assert.ok(html.indexOf('id="settingsBtn"') > html.indexOf('class="drawer-foot"'));
  assert.ok(!html.includes('welcome-actions')); assert.ok(!html.includes('hint-card'));
});
test('new chat archives old conversation; selection restores original page and turns', async () => {
  const { ctx, normal, session } = setup(); await ctx.restoreConversation();
  C.addPage(ctx.conversation, { title: '原始网页', url: 'https://example.com/a', text: '需要保留的正文' });
  C.append(ctx.conversation, 'user', '总结网页'); C.append(ctx.conversation, 'assistant', '原始回答');
  const oldId = ctx.chatId; await ctx.persistConversation(); await ctx.resetChat(); await ctx.persistQueue;
  assert.notEqual(ctx.chatId, oldId); assert.equal(ctx.conversation.pages.length, 0);
  assert.equal(L.list(normal).length, 1); assert.equal(normal[L.key(oldId)].title, '总结网页');
  await ctx.switchChat(oldId); assert.equal(ctx.conversation.pages[0].text, '需要保留的正文');
  assert.equal(ctx.conversation.history.at(-1).content, '原始回答');
  assert.equal(session[ctx.conversationKey].chatId, oldId);
  await ctx.deleteChat(normal[L.key(oldId)]); await ctx.persistQueue;
  assert.equal(L.list(normal).length, 0); assert.equal(ctx.conversation.history.length, 0);
});
test('private conversations never enter persistent storage', async () => {
  const { ctx, normal, session } = setup(true); await ctx.restoreConversation();
  C.append(ctx.conversation, 'user', '私密聊天'); await ctx.persistConversation();
  assert.deepEqual(normal, {}); assert.equal(L.list(session).length, 1);
});
test('save failure keeps current chat instead of losing it during new chat', async () => {
  const { ctx } = setup(); await ctx.restoreConversation();
  C.append(ctx.conversation, 'user', '不能丢失'); const id = ctx.chatId;
  ctx.historyStorage.set = async () => { throw new Error('Quota exceeded'); };
  await ctx.resetChat(); assert.equal(ctx.chatId, id); assert.equal(ctx.conversation.history[0].content, '不能丢失');
});
test('long transcript is archived separately from short model context', () => {
  const state = C.create(); for (let i = 0; i < 101; i++) C.append(state, 'user', '问题' + i);
  const restored = C.create(C.serialize(state)); assert.equal(restored.history.length, 101);
  assert.equal(C.buildMessages(restored, 'system').length, 13);
  const data = { irrelevant: { id: 'bad' }, [L.key('a')]: L.entry('a', C.serialize(state)) };
  assert.equal(L.list(data).length, 1);
});
