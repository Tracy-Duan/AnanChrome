const { test } = require('node:test');
const assert = require('node:assert/strict');
const policy = require('../chat-policy.js');

test('old default upgrades but custom and deliberately empty prompts survive', () => {
  assert.equal(policy.upgradeSystemPrompt(policy.LEGACY_SYSTEM_PROMPT), policy.DEFAULT_SYSTEM_PROMPT);
  assert.equal(policy.upgradeSystemPrompt('自定义角色，请保留。'), '自定义角色，请保留。');
  assert.equal(policy.upgradeSystemPrompt(''), '');
});

test('generation policy applies to existing custom prompts without modifying the original', () => {
  const original = [{ role: 'system', content: '你是数学老师。' }, { role: 'user', content: '请用英语回答。' }];
  const result = policy.prepareMessages(original);
  assert.equal(original[0].content, '你是数学老师。');
  assert.ok(result[0].content.startsWith('你是数学老师。'));
  assert.ok(result[0].content.includes('思考阶段使用简体中文'));
  assert.ok(result[0].content.includes('用户明确要求其他语言'));
  assert.deepEqual(result[1], original[1]);
});

test('policy is not duplicated on retries', () => {
  const once = policy.prepareMessages([{ role: 'system', content: policy.LEGACY_SYSTEM_PROMPT }]);
  assert.deepEqual(policy.prepareMessages(once), once);
});

test('a missing system prompt gets the policy and budget message respects requested languages', () => {
  const result = policy.prepareMessages([{ role: 'user', content: 'Hello' }]);
  assert.equal(result[0].role, 'system');
  assert.ok(policy.BUDGET_END_MESSAGE.includes('不再分析或评价草稿'));
  assert.ok(policy.BUDGET_END_MESSAGE.includes('其他语言'));
});

test('thinking uses the native reasoning continuation without changing user history or budgets', () => {
  const input = [{ role: 'user', content: '问题' }];
  for (const budget of [256, 768]) {
    const request = policy.generationOptions(input, budget);
    assert.equal(request.thinking_budget_tokens, budget);
    assert.equal(request.continue_final_message, 'reasoning_content');
    assert.equal(request.add_generation_prompt, false);
    assert.equal(request.messages.at(-1).reasoning_content, policy.REASONING_PREFIX);
    assert.equal(request.reasoning_format, 'deepseek');
  }
  assert.deepEqual(input, [{ role: 'user', content: '问题' }]);
});

test('non-thinking adds no thought prefill or continuation options', () => {
  const request = policy.generationOptions([{ role: 'user', content: '问题' }], 0);
  assert.equal(request.messages.at(-1).role, 'user');
  assert.equal(request.chat_template_kwargs.enable_thinking, false);
  assert.equal(request.thinking_budget_tokens, 0);
  assert.equal(request.continue_final_message, undefined);
  assert.equal(request.reasoning_budget_message, undefined);
});
