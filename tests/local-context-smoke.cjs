// Optional: run against the already-running local llama-server; no web data is read.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const C = require('../conversation.js');
const policy = require('../chat-policy.js');
const source = fs.readFileSync(path.join(__dirname, '..', 'sidepanel.js'), 'utf8');
function fn(name) {
  const start = source.indexOf(`  async function ${name}(`);
  const next = source.slice(start + 3).search(/\n  (?:async )?function /);
  assert.ok(start >= 0 && next >= 0);
  return source.slice(start, start + 3 + next);
}
const state = C.create();
const ctx = vm.createContext({
  AnanChatPolicy: policy, AnanConversation: C, conversation: state,
  settings: { serverUrl: 'http://127.0.0.1:8080', model: 'local-model', systemPrompt: policy.DEFAULT_SYSTEM_PROMPT, maxTokens: 1200 },
  fetch, AbortController, abortController: new AbortController(), contextShortened: false, renderSources() {}
});
vm.runInContext(fn('classifyRequest') + '\n' + fn('prepareConversationMessages'), ctx);
const pageA = { title: '星屿发布计划（合成测试资料）', url: 'https://example.com/star-island', tabId: 1,
  text: '星屿项目是一个离线阅读工具。本次发布代号为蓝鹭。负责人为林澈。验收定在2031年9月17日。计划分为两点：第一点，完成离线阅读与数据导入；第二点，在验收前做三轮故障恢复测试，每轮覆盖断电、断网和磁盘满三个场景。测试预算为3760元。以上信息仅用于软件回归测试。' };
const pageB = { title: '完全不同的活动标签页', url: 'https://example.com/different', tabId: 2 };

async function answer(question, budget = 0) {
  C.append(state, 'user', question);
  const messages = await ctx.prepareConversationMessages(budget);
  const response = await fetch('http://127.0.0.1:8080/v1/chat/completions', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(90000),
    body: JSON.stringify({ ...policy.generationOptions(messages, budget), stream: false,
      temperature: 0, max_tokens: 1200 })
  });
  const data = await response.json(); assert.equal(response.status, 200, JSON.stringify(data));
  const text = data.choices?.[0]?.message?.content || '';
  assert.ok(text.trim()); C.append(state, 'assistant', text);
  console.log(JSON.stringify({ question, answer: text.slice(0, 800) }));
  return text;
}
(async () => {
  C.addPage(state, pageA);
  await answer('简短总结网页，保留两点计划的顺序。');
  const route = await ctx.classifyRequest('第二点展开说说，负责人是谁、哪天验收、测试预算多少？', AbortSignal.timeout(30000), null, pageB);
  assert.equal(route.intent, 'chat', 'follow-up must not read the unrelated active tab');
  const followup = await answer('第二点展开说说，负责人是谁、哪天验收、测试预算多少？', 256);
  assert.match(followup, /林澈/); assert.match(followup, /3760|3,760/); assert.match(followup, /17/);
  assert.match(followup, /断电/);
  assert.equal((await ctx.classifyRequest('总结当前新打开的网页', AbortSignal.timeout(30000), null, pageB)).intent, 'summary');
  assert.equal((await ctx.classifyRequest('你好', AbortSignal.timeout(30000), null, pageB)).intent, 'chat');
  const unrelated = await answer('换个话题：17乘以23等于多少？只回答结果。');
  assert.match(unrelated, /391/); assert.ok(!unrelated.includes('林澈'));
  C.addPage(state, { ...pageA, text: pageA.text.repeat(120) });
  C.addPage(state, { ...pageB, text: '第二份测试资料'.repeat(2000) });
  C.append(state, 'user', '请比较两个网页');
  const fitted = await ctx.prepareConversationMessages(768);
  assert.ok(ctx.contextShortened); assert.equal(fitted.at(-1).content, '请比较两个网页');
  console.log('PASS: real template/token limits, summary follow-up, tab-switch routing, unrelated chat');
})().catch(error => { console.error(error); process.exitCode = 1; });
