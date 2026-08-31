/* Shared by the side panel and service worker. No model or worker round-trip is
   needed to locate/read a tab. Callback and Promise Chrome APIs are both supported. */
var AnanPageAccess = (() => {
  const validId = value => Number.isInteger(value) && value >= 0;
  function call(chromeApi, owner, method, ...args) {
    return new Promise((resolve, reject) => {
      if (typeof owner?.[method] !== 'function') {
        reject(new Error('此页面没有浏览器扩展权限，请从浏览器工具栏打开 AnanChrome 侧边栏。'));
        return;
      }
      try {
        const pending = owner[method](...args, value => {
          const error = chromeApi.runtime?.lastError;
          if (error) reject(new Error(error.message)); else resolve(value);
        });
        // Modern APIs may return a Promise; older APIs invoke only the callback.
        if (pending?.then) pending.then(resolve, reject);
      } catch (error) { reject(error); }
    });
  }

  async function getCurrentWindow(api) {
    const win = await call(api, api.windows, 'getCurrent', {});
    if (!validId(win?.id)) throw new Error('无法确定侧边栏所在的浏览器窗口');
    return win;
  }

  async function getActivePage(api, { windowId } = {}) {
    // Known window IDs remain authoritative: never silently read another window.
    const queries = validId(windowId) ? [{ active: true, windowId }]
      : [{ active: true, currentWindow: true }, { active: true, lastFocusedWindow: true }];
    let failure;
    for (const query of queries) {
      try {
        const tabs = await call(api, api.tabs, 'query', query);
        const tab = tabs?.find(t => validId(t.id));
        if (tab) return { tabId: tab.id, windowId: tab.windowId, title: tab.title || '', url: tab.url || '' };
      } catch (error) { failure = error; }
    }
    throw new Error(failure ? `获取当前网页失败：${failure.message}` : '浏览器没有返回活动标签页，请确认侧边栏所在窗口中有打开的网页。');
  }

  async function extractPage(api, target) {
    if (!validId(target?.tabId)) throw new Error('网页标签信息无效，请再次要求读取当前页。');
    const tab = await call(api, api.tabs, 'get', target.tabId);
    if (!tab) throw new Error('需要读取的标签页已关闭；已记住的网页不受影响。');
    if (target.url && tab.url !== target.url) throw new Error('标签页地址已变化，请重新读取当前页；原网页记忆仍保留。');
    if (!/^https?:/.test(tab.url || '')) throw new Error('当前页面不是普通网页，浏览器内部页面等无法读取。');
    const results = await call(api, api.scripting, 'executeScript', {
      target: { tabId: tab.id }, func: extractContentFn
    });
    const data = results?.[0]?.result;
    if (!data?.text) throw new Error('页面没有提取到正文内容');
    if (data.url !== (target.url || tab.url)) throw new Error('读取期间网页发生跳转，请重新读取；原网页记忆仍保留。');
    return { ...data, tabId: tab.id };
  }

  function extractContentFn() {
    const MAX_CHARS = 12000;
  
    const title = (
      document.querySelector('h1') ||
      document.querySelector('title')
    )?.textContent?.trim() || document.title;
  
    /* 正文区域选择器（按优先级） */
    const selectors = [
      'article', 'main',
      '[role="main"]',
      '.post-content', '.article-content', '.entry-content',
      '.content', '.post', '.article',
      '#content', '#main-content', '#article'
    ];
  
    let root = null;
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && el.textContent.trim().length > 200) { root = el; break; }
    }
    if (!root) root = document.body;
  
    /* 提取文本段落 */
    const tags = 'p, h1, h2, h3, h4, h5, h6, li, td, th, blockquote, pre';
    const elements = root.querySelectorAll(tags);
    const parts = [];
  
    for (const el of elements) {
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') continue;
      const text = el.textContent.trim();
      if (text.length < 4) continue;
      parts.push(text);
    }
  
    let text = parts.join('\n\n');
    text = text.replace(/\n{3,}/g, '\n\n').trim();
  
    /* 兜底：结构化标签取不到足够内容时，直接取 body 纯文本 */
    if (text.length < 200) {
      text = root.innerText.trim();
    }
  
    if (text.length > MAX_CHARS) {
      text = text.slice(0, MAX_CHARS) + '\n\n[... 内容已截断 ...]';
    }
  
    return { title, text, url: location.href, charCount: text.length, truncated: text.includes('[... 内容已截断 ...]') };
  }

  return { getCurrentWindow, getActivePage, extractPage };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = AnanPageAccess;
