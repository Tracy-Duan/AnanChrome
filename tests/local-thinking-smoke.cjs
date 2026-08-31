// Optional integration check. Uses the already-running local model only.
const assert = require('node:assert/strict');
const policy = require('../chat-policy.js');
const { createAccumulator, createSSEParser } = require('../chat-stream.js');
const cases = [
  { name: 'simple-256', budget: 256, prompt: '为什么浏览器扩展不能直接读取硬盘上的模型文件？用三句话解释。' },
  { name: 'complex-768', budget: 768, prompt: '比较把9B模型打进浏览器扩展和使用独立Windows运行时的优缺点，从安装、更新、安全三方面简短回答。' },
  { name: 'non-thinking', budget: 0, prompt: '用一句话解释本地模型是什么。' },
  { name: 'english-translation', budget: 256, prompt: '请把“浏览器扩展”翻译成英语，只输出译文。', english: true },
  { name: 'forced-boundary', budget: 16, prompt: '17乘以23等于多少？只给出结果。', expected: '391' }
];

(async () => {
  for (const item of cases) {
    const a = createAccumulator({ reasoningExpected: item.budget > 0 });
    let finishReason;
    const sse = createSSEParser(json => {
      if (json.error) throw new Error(JSON.stringify(json.error));
      if (json.choices?.[0]?.delta) a.push(json.choices[0].delta);
      if (json.choices?.[0]?.finish_reason) finishReason = json.choices[0].finish_reason;
    });
    const response = await fetch('http://127.0.0.1:8080/v1/chat/completions', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(90000),
      body: JSON.stringify({
        model: 'local-model', ...policy.generationOptions([
          { role: 'system', content: policy.LEGACY_SYSTEM_PROMPT }, { role: 'user', content: item.prompt }
        ], item.budget), stream: true, seed: 42, temperature: 0.7, top_p: 0.9, max_tokens: item.budget + 700
      })
    });
    assert.equal(response.status, 200);
    const decoder = new TextDecoder();
    for await (const bytes of response.body) sse.feed(decoder.decode(bytes, { stream: true }));
    sse.feed(decoder.decode()); sse.finish();
    const result = a.snapshot({ finished: true, finishReason });
    const metaLeak = /Thinking Process|Analyze the Request|Critique\s*\d*\s*:|Attempt\s*\d|We need to|I need to/i;
    console.log(JSON.stringify({ name: item.name, finishReason, reasoningStart: result.reasoning.slice(0, 90),
      answerStart: result.answer.slice(0, 400), reasoningChars: result.reasoning.length, answerChars: result.answer.length }));
    assert.ok(result.answer.trim(), 'final answer missing');
    assert.ok(!metaLeak.test(result.answer), 'English drafting leaked into the final answer');
    assert.equal(finishReason, 'stop');
    if (item.budget > 0 && result.reasoning.trim()) {
      const generatedThought = result.reasoning.replace(policy.REASONING_PREFIX, '');
      assert.ok(/[\u3400-\u9fff]/.test(generatedThought.slice(0, 80)), 'reasoning did not start in Chinese');
      assert.ok(!metaLeak.test(generatedThought.slice(0, 80)), 'reasoning starts with an English analysis scaffold');
    }
    if (item.english) assert.match(result.answer, /browser extension/i);
    else if (item.expected) assert.ok(result.answer.includes(item.expected));
    else assert.match(result.answer, /[\u3400-\u9fff]/);
    if (item.budget === 0) assert.equal(result.reasoning.trim(), '');
  }
  console.log('PASS: all local generation checks');
})().catch(error => { console.error(error); process.exitCode = 1; });
