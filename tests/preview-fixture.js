/* Only served by tests/preview-server.cjs; does not read real browser state. */
(() => {
  const pages = [
    { tabId: 1, title: '星屿发布计划 · 测试网页 A', url: 'https://example.com/star-island', text: '星屿项目是一款离线阅读工具。负责人为林澈，验收定在2031年9月17日。计划分为两点：第一点，完成离线阅读与数据导入；第二点，验收前做三轮故障恢复测试，每轮覆盖断电、断网和磁盘满三个场景。测试预算为3760元。' },
    { tabId: 2, title: '枫桥设计方案 · 测试网页 B', url: 'https://example.com/maple-bridge', text: '枫桥项目是一款设计工具，负责人为宋宁。计划2032年2月4日开始公测。第一阶段开展界面设计，第二阶段开展无障碍检查。预算为6800元，重点覆盖键盘操作和高对比度模式。全部内容为测试用合成数据。' },
    { tabId: 3, title: '海风笔记 · 测试网页 C', url: 'https://example.com/sea', text: '海风笔记是一款用于整理资料的笔记工具。负责人是吴桐。预算为9100元。计划在2033年六月开始公测，首先支持本地文本和图片，随后支持跨设备同步。全部内容为测试用合成数据。' },
    { tabId: 4, title: '山岚相册 · 测试网页 D', url: 'https://example.com/mountain', text: '山岚相册是一款用于管理照片的离线工具。负责人是陈雨。预算为5200元。计划在2034年五月开始公测，首先完成图片预览，然后完成标签管理与批量重命名。全部内容为测试用合成数据。' }
  ];
  let active = 0;
  let downloadStarted = false;
  const local = { serverUrl: location.origin + '/model' };
  const storage = area => ({
    get(keys, callback) {
      const task = fetch('/fixture/' + area).then(r => r.json()).then(data => {
        data = area === 'local' ? { ...data, ...local } : data;
        if (keys === null) return data;
        if (typeof keys === 'string') return { [keys]: data[keys] };
        return { ...keys, ...data };
      });
      if (callback) task.then(callback); else return task;
    },
    set: async (data, callback) => { await fetch('/fixture/' + area, { method: 'POST', body: JSON.stringify(data) }); callback?.(); },
    remove: async key => { await fetch('/fixture/' + area, { method: 'DELETE', body: JSON.stringify([key]) }); }
  });
  window.chrome = {
    windows: { getCurrent: async () => ({ id: 77, incognito: false }) },
    tabs: { query: (query, cb) => cb([{ ...pages[active], id: pages[active].tabId, windowId: 77 }]),
      get: (id, cb) => { const page = pages.find(p => p.tabId === id); cb(page && { ...page, id, windowId: 77 }); } },
    scripting: { executeScript: (options, cb) => {
      const page = pages.find(p => p.tabId === options.target.tabId);
      cb([{ result: { ...page, charCount: page.text.length } }]);
    } },
    storage: {
      onChanged: { addListener() {} },
      local: storage('local'), session: storage('session')
    },
    runtime: { openOptionsPage: async () => { location.href = '/options.html'; },
      sendNativeMessage(host, message, callback) {
        if (message.action === 'downloadModel') downloadStarted = true;
        callback({ ok: true, download: { status: downloadStarted ? 'downloading' : 'notDownloaded', bytes: downloadStarted ? 1230000000 : 0, total: 5630000000 } });
      }, sendMessage(message, callback) {
      if (message.action === 'getActivePage') { const { title, url, tabId } = pages[active]; callback({ title, url, tabId }); }
      else if (message.action === 'extractPage') {
        const page = pages.find(p => p.tabId === message.tabId);
        callback(!page || page.url !== message.expectedUrl ? { error: '测试页已变化' } : { ...page, charCount: page.text.length });
      } else callback?.({ ok: true, serverUrl: local.serverUrl });
    } }
  };
  document.addEventListener('DOMContentLoaded', () => {
    if (!document.getElementById('appShell')) return;
    const controls = document.createElement('div');
    controls.style.cssText = 'display:flex;gap:8px;padding:5px 14px;font-size:11px;flex:0 0 auto;';
    const button = document.createElement('button'); button.textContent = '测试：切换活动页';
    const label = document.createElement('span'); label.textContent = '活动页 A（合成资料）';
    button.addEventListener('click', () => { active = (active + 1) % pages.length; label.textContent = `活动页 ${'ABCD'[active]}（合成资料）`; });
    controls.append(button, label); document.getElementById('appShell').prepend(controls);
  });
})();
