const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createAccumulator, createSSEParser } = require('../chat-stream.js');

test('structured reasoning stays separate and streams immediately', () => {
  const a = createAccumulator({ reasoningExpected: true });
  a.push({ reasoning_content: '先确认问题。' });
  assert.deepEqual(a.snapshot(), { reasoning: '先确认问题。', answer: '' });
  a.push({ content: '结论：' });
  assert.equal(a.snapshot().answer, '结论：');
});

test('typed reasoning does not disable raw think-tag handling', () => {
  const a = createAccumulator({ reasoningExpected: true });
  a.push({ reasoning_content: '第一步。' });
  a.push({ content: '<thi' });
  assert.equal(a.snapshot().answer, '');
  a.push({ content: 'nk>Second analysis</th' });
  assert.equal(a.snapshot().answer, '');
  assert.ok(!a.snapshot().reasoning.includes('</th'));
  a.push({ content: 'ink>中文答案' });
  assert.equal(a.snapshot().answer, '中文答案');
  assert.ok(a.snapshot().reasoning.includes('Second analysis'));
});

test('prefilled raw opening tag is not required and prefix never flashes as an answer', () => {
  const a = createAccumulator({ reasoningExpected: true });
  a.push({ content: 'English analysis' });
  assert.equal(a.snapshot().answer, '');
  a.push({ content: '</thi' });
  assert.equal(a.snapshot().answer, '');
  a.push({ content: 'nk>最终答案' });
  assert.deepEqual(a.snapshot(), { reasoning: 'English analysis', answer: '最终答案' });
});

test('all character boundaries in a tagged stream', () => {
  const a = createAccumulator({ reasoningExpected: true });
  const input = '<think>中文分析</think>中文回答';
  let prefix = '';
  for (const ch of input) {
    prefix += ch;
    a.push({ content: ch });
    if (!prefix.includes('</think>')) assert.equal(a.snapshot().answer, '');
  }
  assert.deepEqual(a.snapshot(), { reasoning: '中文分析', answer: '中文回答' });
});

test('a direct response without reasoning is preserved at normal EOF', () => {
  const a = createAccumulator({ reasoningExpected: true });
  a.push({ content: '直接回答。' });
  assert.equal(a.snapshot({ finished: true, finishReason: 'stop' }).answer, '直接回答。');
});

for (const reason of ['length', 'cancelled']) {
  test(`unfinished raw analysis is not committed to answer on ${reason}`, () => {
    const a = createAccumulator({ reasoningExpected: true });
    a.push({ content: 'unfinished analysis' });
    assert.deepEqual(a.snapshot({ finished: true, finishReason: reason }), {
      reasoning: 'unfinished analysis', answer: ''
    });
  });
}

test('English, code and literal tags in final answers are not stripped', () => {
  const a = createAccumulator({ reasoningExpected: true });
  a.push({ reasoning_content: '按要求翻译。' });
  const answer = 'Browser extension.\n```html\n<think>example</think>\n```';
  a.push({ content: answer });
  assert.equal(a.snapshot().answer, answer);
});

test('non-thinking mode streams content immediately', () => {
  const a = createAccumulator();
  a.push({ content: 'Hello' });
  assert.equal(a.snapshot().answer, 'Hello');
});

test('literal think tags requested as text in non-thinking mode are preserved', () => {
  const a = createAccumulator();
  a.push({ content: '<think>literal XML</think>' });
  assert.equal(a.snapshot().answer, '<think>literal XML</think>');
});

test('duplicate legacy tagged reasoning is not repeated', () => {
  const a = createAccumulator({ reasoningExpected: true });
  a.push({ reasoning_content: '同一段', content: '<think>同一段</think>答案' });
  assert.deepEqual(a.snapshot(), { reasoning: '同一段', answer: '答案' });
});

test('SSE handles byte-split UTF-8, CRLF, comments, usage and no final newline', () => {
  const events = [];
  const sse = createSSEParser(event => events.push(event));
  const bytes = Buffer.from(':ping\r\ndata: {"choices":[{"delta":{"reasoning_content":"中文"}}]}\r\n\r\n' +
    'data: {"usage":{"completion_tokens":2}}');
  const decoder = new TextDecoder();
  for (const byte of bytes) sse.feed(decoder.decode(Uint8Array.of(byte), { stream: true }));
  sse.feed(decoder.decode());
  sse.finish();
  assert.equal(events[0].choices[0].delta.reasoning_content, '中文');
  assert.equal(events[1].usage.completion_tokens, 2);
});

test('SSE supports multiline data and stops at DONE', () => {
  const events = [];
  const sse = createSSEParser(event => events.push(event));
  sse.feed('data: {"choices":\ndata: []}\n\ndata: [DONE]\n\ndata: invalid\n\n');
  sse.finish();
  assert.deepEqual(events, [{ choices: [] }]);
});

test('malformed SSE is an error rather than silently dropping a reasoning boundary', () => {
  const sse = createSSEParser(() => {});
  assert.throws(() => sse.feed('data: invalid\n\n'), SyntaxError);
});
