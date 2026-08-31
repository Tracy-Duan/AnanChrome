const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const policy = require('../chat-policy.js');
const stream = require('../chat-stream.js');

// Exercise the real streamChat function with a minimal rendering surface.
const source = fs.readFileSync(path.join(__dirname, '..', 'sidepanel.js'), 'utf8');
const start = source.indexOf('  async function streamChat(');
const end = source.indexOf('  function addMessage(', start);
assert.ok(start >= 0 && end > start);

class Element {
  constructor() {
    this.children = [];
    this.classList = { remove() {}, toggle() {} };
    this._content = '';
  }
  set innerHTML(value) { this._content = value; }
  get innerHTML() { return this._content; }
  set textContent(value) { this._content = value; }
  get textContent() { return this._content; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
}

function harness(events) {
  let request;
  let listenerCount = 0;
  const body = new Element();
  const payload = events.map(event => 'data: ' + JSON.stringify(event) + '\r\n\r\n').join('') + 'data: [DONE]';
  const ctx = vm.createContext({
    AnanChatPolicy: policy, AnanStream: stream,
    performance, TextDecoder, AbortController,
    document: { createElement: () => new Element() },
    settings: { serverUrl: 'http://localhost:8080', model: 'local-model', temperature: 0.7, topP: 0.9, maxTokens: 2048 },
    fetch: async (url, options) => { request = JSON.parse(options.body); return new Response(payload); },
    chatArea: { addEventListener() { listenerCount++; }, removeEventListener() { listenerCount--; } },
    renderMarkdown: text => text, isNearBottom: () => true, scrollToBottom() {}, formatDuration: () => '1 秒',
    requestAnimationFrame: callback => setTimeout(callback, 0), cancelAnimationFrame: clearTimeout
  });
  vm.runInContext(source.slice(start, end), ctx);
  return { body, run: budget => ctx.streamChat([{ role: 'system', content: '自定义角色' },
    { role: 'user', content: '测试' }], body, new AbortController().signal, budget),
    request: () => request, listeners: () => listenerCount };
}

test('streamChat renders only answer text in answer pane and sends native thought options', async () => {
  const h = harness([
    { choices: [{ delta: { reasoning_content: '思考一。' } }] },
    { choices: [{ delta: { content: '<think>思考二。</th' } }] },
    { choices: [{ delta: { content: 'ink>中文回答' }, finish_reason: 'stop' }] },
    { usage: { completion_tokens: 20 } }
  ]);
  const result = await h.run(256);
  assert.equal(result.content, '中文回答');
  assert.ok(result.reasoning.includes('思考二。'));
  const shell = h.body.children[0];
  assert.equal(shell.children[1].innerHTML, '中文回答');
  assert.ok(shell.children[0].children[1].innerHTML.includes('思考一。'));
  assert.equal(h.request().continue_final_message, 'reasoning_content');
  assert.equal(h.request().thinking_budget_tokens, 256);
  assert.equal(result.usage.completion_tokens, 20);
  assert.equal(h.listeners(), 0);
});

test('non-thinking English content is preserved by the real renderer', async () => {
  const h = harness([{ choices: [{ delta: { content: 'Browser Extension' }, finish_reason: 'stop' }] }]);
  const result = await h.run(0);
  assert.equal(result.content, 'Browser Extension');
  assert.equal(result.reasoning, '');
  assert.equal(h.request().continue_final_message, undefined);
  assert.equal(h.listeners(), 0);
});

test('unfinished reasoning is not shown as answer and reports a missing final response', async () => {
  const h = harness([{ choices: [{ delta: { reasoning_content: '尚未完成。' }, finish_reason: 'length' }] }]);
  const result = await h.run(256);
  assert.equal(result.content, '');
  assert.equal(result.finishReason, 'length');
  assert.match(h.body.children[0].children[1].textContent, /没有给出最终回答/);
  assert.equal(h.listeners(), 0);
});
