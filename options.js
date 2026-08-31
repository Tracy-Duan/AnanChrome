/* options.js — 设置页逻辑 */
(() => {
  const DEFAULTS = {
    serverUrl: 'http://127.0.0.1:8080',
    tavilyApiKey: '',
    model: 'local-model',
    temperature: 0.7,
    maxTokens: 2048,
    topP: 0.9,
    thinkingMode: false,
    systemPrompt: AnanChatPolicy.DEFAULT_SYSTEM_PROMPT
  };

  const fields = ['serverUrl', 'tavilyApiKey', 'model', 'temperature', 'maxTokens', 'topP', 'systemPrompt'];
  const els = {};
  fields.forEach(f => { els[f] = document.getElementById(f); });
  const thinkEl = document.getElementById('thinkingMode');

  const toast = document.getElementById('toast');
  const downloadButton = document.getElementById('downloadModelBtn');
  const downloadStatus = document.getElementById('modelDownloadStatus');
  const downloadProgress = document.getElementById('modelDownloadProgress');
  let downloadPoll = null;

  function modelRequest(action) {
    return new Promise(resolve => {
      try {
        chrome.runtime.sendNativeMessage('com.anan.chrome.runtime', { action }, response => {
          const error = chrome.runtime.lastError;
          if (error) resolve({ ok: false, error: '请先双击整合包中的 Install-AnanChrome.cmd 安装或更新运行时，再回来下载模型。' });
          else resolve(response || { ok: false, error: '运行时未响应，请重新安装整合包内的运行时。' });
        });
      } catch { resolve({ ok: false, error: '请先安装整合包内的 Windows 运行时。' }); }
    });
  }

  async function updateDownload(action = 'modelDownloadStatus') {
    clearTimeout(downloadPoll);
    downloadButton.disabled = true;
    const response = await modelRequest(action);
    const state = response.download;
    if (!response.ok || !state) {
      downloadProgress.hidden = true;
      downloadButton.textContent = '下载模型';
      downloadStatus.classList.add('error');
      downloadStatus.textContent = response.error || '当前运行时版本过旧，请运行整合包中的 Install-AnanChrome.cmd 更新。';
      downloadButton.disabled = false; return;
    }
    const busy = ['queued', 'downloading', 'verifying'].includes(state.status);
    downloadStatus.classList.toggle('error', ['error', 'interrupted'].includes(state.status));
    downloadButton.disabled = busy || state.status === 'ready';
    downloadButton.textContent = state.status === 'ready' ? '模型已下载' : busy ? '下载中…' : state.bytes > 0 ? '继续下载' : '下载模型';
    downloadProgress.hidden = !busy;
    if (state.total > 0) downloadProgress.value = Math.min(100, state.bytes / state.total * 100);
    else downloadProgress.removeAttribute('value');
    const gb = bytes => (bytes / 1e9).toFixed(2);
    downloadStatus.textContent = ({
      notDownloaded: '模型尚未下载。点击上方按钮开始。',
      queued: '正在准备下载…',
      downloading: `已下载 ${gb(state.bytes)} GB${state.total ? ` / ${gb(state.total)} GB` : ''}，可关闭页面，后台会继续。`,
      verifying: '正在校验模型完整性，请稍候…',
      ready: '模型已下载并配置。返回侧边栏即可连接；已有服务正在运行时，下次启动服务才会使用新模型。'
    })[state.status] || state.error || '下载状态未知，请重试。';
    if (busy) downloadPoll = setTimeout(() => updateDownload(), 2000);
  }

  downloadButton.addEventListener('click', () => updateDownload('downloadModel'));
  window.addEventListener('pagehide', () => clearTimeout(downloadPoll));

  /* ── 加载当前设置 ── */
  function loadSettings() {
    chrome.storage.local.get(DEFAULTS, (data) => {
      const upgraded = AnanChatPolicy.upgradeSystemPrompt(data.systemPrompt);
      if (upgraded !== data.systemPrompt) chrome.storage.local.set({ systemPrompt: upgraded });
      data.systemPrompt = upgraded;
      fields.forEach(f => {
        els[f].value = data[f] ?? DEFAULTS[f];
      });
      if (thinkEl) thinkEl.checked = !!data.thinkingMode;
    });
  }

  /* ── 保存 ── */
  function saveSettings() {
    const data = {};
    fields.forEach(f => {
      let val = els[f].value;
      if (f === 'temperature' || f === 'maxTokens' || f === 'topP') {
        val = parseFloat(val);
        if (isNaN(val)) val = DEFAULTS[f];
      }
      data[f] = val;
    });
    if (thinkEl) data.thinkingMode = thinkEl.checked;
    chrome.storage.local.set(data, () => {
      showToast('已保存');
    });
  }

  /* ── 恢复默认 ── */
  function resetSettings() {
    fields.forEach(f => { els[f].value = DEFAULTS[f]; });
    if (thinkEl) thinkEl.checked = DEFAULTS.thinkingMode;
    chrome.storage.local.set(DEFAULTS, () => {
      showToast('已恢复默认');
    });
  }

  function showToast(text) {
    toast.textContent = text;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 1800);
  }

  document.getElementById('saveBtn').addEventListener('click', saveSettings);
  document.getElementById('resetBtn').addEventListener('click', resetSettings);

  loadSettings();
  updateDownload();
})();
