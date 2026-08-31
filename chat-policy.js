/* Shared generation policy. Never replace a user's custom system prompt in storage. */
var AnanChatPolicy = (() => {
  const LEGACY_SYSTEM_PROMPT = '你是 AnanChrome 中的本地 AI 助手 Anan。请优先使用中文，准确、清晰、简洁地帮助用户阅读网页、查找信息和完成日常任务。';
  const OUTPUT_POLICY = '语言与输出规则：思考阶段使用简体中文，保持简短。最终回答默认使用简体中文；用户明确要求其他语言、翻译或外语练习时，相应内容遵循用户要求。代码、命令、专有名词和必要的原文引用保留原样。最终回答直接给出结论或用户要求的内容，不要继续分析、评价自己的草稿、展示翻译过程，也不要输出英文过渡句或“现在用中文回答”等自我说明。';
  const DEFAULT_SYSTEM_PROMPT = `${LEGACY_SYSTEM_PROMPT}\n\n${OUTPUT_POLICY}`;
  const BUDGET_END_MESSAGE = '\n分析阶段结束。现在直接给出最终回答，不再分析或评价草稿。默认使用简体中文；若用户明确要求其他语言则遵循要求。\n';
  const REASONING_PREFIX = '用中文简要分析：\n';

  function upgradeSystemPrompt(value) {
    if (typeof value !== 'string' || value.trim() === LEGACY_SYSTEM_PROMPT) return DEFAULT_SYSTEM_PROMPT;
    return value;
  }

  function prepareMessages(messages) {
    let foundSystem = false;
    const result = messages.map(message => {
      if (message.role !== 'system' || foundSystem) return { ...message };
      foundSystem = true;
      const content = upgradeSystemPrompt(message.content);
      return { ...message, content: content.includes(OUTPUT_POLICY) ? content : `${content}\n\n${OUTPUT_POLICY}` };
    });
    if (!foundSystem) result.unshift({ role: 'system', content: DEFAULT_SYSTEM_PROMPT });
    return result;
  }

  function generationOptions(messages, thinkingBudget) {
    const prepared = prepareMessages(messages);
    const thinking = thinkingBudget > 0;
    // A short, neutral Chinese prefill steers this Qwen fine-tune away from its
    // English analysis scaffold. It is input context, never stored as history.
    if (thinking) prepared.push({ role: 'assistant', content: '', reasoning_content: REASONING_PREFIX });
    return {
      messages: prepared,
      thinking_budget_tokens: thinkingBudget,
      reasoning_format: 'deepseek',
      chat_template_kwargs: { enable_thinking: thinking },
      ...(thinking ? {
        continue_final_message: 'reasoning_content',
        add_generation_prompt: false,
        reasoning_budget_message: BUDGET_END_MESSAGE
      } : {})
    };
  }

  return { LEGACY_SYSTEM_PROMPT, DEFAULT_SYSTEM_PROMPT, OUTPUT_POLICY, BUDGET_END_MESSAGE, REASONING_PREFIX,
    upgradeSystemPrompt, prepareMessages, generationOptions };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = AnanChatPolicy;
