/* Separate transport parsing from rendering. Do not filter text by language. */
var AnanStream = (() => {
  const OPEN = '<think>';
  const CLOSE = '</think>';

  function withoutPartialTag(text, tag) {
    for (let n = Math.min(tag.length - 1, text.length); n > 0; n--) {
      if (text.endsWith(tag.slice(0, n))) return text.slice(0, -n);
    }
    return text;
  }

  function splitContent(text, { reasoningExpected, structured, finished, finishReason }) {
    if (!reasoningExpected && !structured) return { reasoning: '', answer: text };
    const leading = text.trimStart();
    if (leading.startsWith(OPEN)) {
      const start = text.indexOf(OPEN) + OPEN.length;
      const end = text.indexOf(CLOSE, start);
      return end < 0
        ? { reasoning: withoutPartialTag(text.slice(start), CLOSE), answer: '' }
        : { reasoning: text.slice(start, end), answer: text.slice(end + CLOSE.length) };
    }
    if (!finished && leading && (OPEN.startsWith(leading) || CLOSE.startsWith(leading))) {
      return { reasoning: '', answer: '' };
    }
    if (leading.startsWith(CLOSE)) {
      return { reasoning: '', answer: leading.slice(CLOSE.length) };
    }
    // Some raw-content servers omit the opening tag already supplied by the
    // chat template. Do not publish that unclassified prefix as an answer.
    if (reasoningExpected && !structured) {
      const end = text.indexOf(CLOSE);
      if (end >= 0) return { reasoning: text.slice(0, end), answer: text.slice(end + CLOSE.length) };
      if (!finished) return { reasoning: '', answer: '' };
      if (finishReason === 'length' || finishReason === 'cancelled') {
        return { reasoning: withoutPartialTag(text, CLOSE), answer: '' };
      }
    }
    return { reasoning: '', answer: text };
  }

  function createAccumulator({ reasoningExpected = false } = {}) {
    let reasoning = '';
    let content = '';
    let structured = false;
    return {
      push(delta = {}) {
        const thought = delta.reasoning_content ?? delta.thinking_content ?? delta.reasoning ?? delta.thinking;
        if (typeof thought === 'string') { structured = true; reasoning += thought; }
        if (typeof delta.content === 'string') content += delta.content;
      },
      snapshot({ finished = false, finishReason = null } = {}) {
        const split = splitContent(content, { reasoningExpected, structured, finished, finishReason });
        let visibleReasoning = reasoning;
        if (split.reasoning) {
          if (!reasoning || split.reasoning.startsWith(reasoning)) visibleReasoning = split.reasoning;
          else if (!reasoning.startsWith(split.reasoning)) visibleReasoning += '\n' + split.reasoning;
        }
        return { reasoning: visibleReasoning, answer: split.answer };
      }
    };
  }

  function createSSEParser(onEvent) {
    let buffer = '';
    let data = [];
    let ended = false;
    function dispatch() {
      const payload = data.join('\n');
      data = [];
      if (!payload.trim() || ended) return;
      if (payload.trim() === '[DONE]') { ended = true; return; }
      onEvent(JSON.parse(payload));
    }
    function line(value) {
      value = value.replace(/\r$/, '');
      if (!value) dispatch();
      else if (value.startsWith('data:')) data.push(value.slice(5).replace(/^ /, ''));
    }
    return {
      feed(text) {
        buffer += text;
        let end;
        while ((end = buffer.indexOf('\n')) >= 0) {
          line(buffer.slice(0, end));
          buffer = buffer.slice(end + 1);
        }
      },
      finish() {
        if (buffer) line(buffer);
        buffer = '';
        dispatch();
      }
    };
  }

  return { createAccumulator, createSSEParser };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = AnanStream;
