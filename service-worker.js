/* ══════════════════════════════════════════════
   后台服务 (MV3 Service Worker)
   ══════════════════════════════════════════════ */

importScripts('chat-policy.js', 'page-access.js');

/* ── 点击工具栏图标直接打开侧边栏 ── */
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((e) => console.warn('setPanelBehavior 失败:', e));

/* ── 默认设置（仅首次安装写入，升级时保留用户配置） ── */
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

const NATIVE_HOST_NAME = 'com.anan.chrome.runtime';

function nativeRuntimeFailure(message) {
  const detail = String(message || 'Unknown native messaging error');
  let status = 'runtimeCommunicationError';
  let error = '扩展与本地运行时通信失败，请查看连接提示中的具体原因。';
  if (/forbidden|not allowed|access.*denied/i.test(detail)) {
    status = 'runtimeAccessDenied';
    error = `当前扩展未获运行时授权（扩展 ID：${chrome.runtime.id}）。请用这个 ID 重新配置一次运行时，无需重新下载模型。`;
  } else if (/not found|not registered|no such native/i.test(detail)) {
    status = 'runtimeNotInstalled';
    error = '首次使用请先双击整合包中的 Install-AnanChrome.cmd，再到设置下载模型。项目开发用户也可运行 Setup-AnanChrome.cmd。';
  } else if (/failed to start|could not start/i.test(detail)) {
    status = 'runtimeStartFailed';
    error = '本地运行时启动失败，请检查程序是否被移动或被系统拦截；项目用户可运行 Setup-AnanChrome.cmd 修复注册。';
  } else if (/exited|closed/i.test(detail)) {
    status = 'runtimeExited';
    error = '本地运行时提前退出，请查看 AnanChrome 的 Logs 日志；这不代表模型权重缺失。';
  } else if (/permission|nativeMessaging/i.test(detail)) {
    status = 'runtimePermissionMissing';
    error = '扩展缺少原生通信权限，请在扩展管理页重新加载当前版本并检查权限。';
  }
  return { ok: false, status, error, detail, extensionId: chrome.runtime.id };
}

function ensureLocalServer(sendResponse) {
  try {
  chrome.runtime.sendNativeMessage(
    NATIVE_HOST_NAME,
    { action: 'ensureServer' },
    (response) => {
      if (chrome.runtime.lastError) {
        const failure = nativeRuntimeFailure(chrome.runtime.lastError.message);
        console.warn('AnanChrome native runtime:', failure);
        sendResponse(failure);
        return;
      }
      sendResponse(response || {
        ok: false,
        status: 'runtimeNoResponse',
        error: 'AnanChrome 本地运行时没有返回结果。'
      });
    }
  );
  } catch (error) {
    sendResponse(nativeRuntimeFailure(error.message));
  }
}

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    chrome.storage.local.set(DEFAULTS);
  }

  /* 右键菜单：快速打开侧边栏 */
  chrome.contextMenus.create({
    id: 'open-sidebar',
    title: '打开 AI 侧边栏',
    contexts: ['all']
  });
});

/* ── 右键菜单点击 ── */
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'open-sidebar' && tab) {
    chrome.sidePanel.open({ windowId: tab.windowId });
  }
});


/* ── 来自 sidepanel / options 的消息 ── */
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'ensureLocalServer') {
    ensureLocalServer(sendResponse);
    return true;
  }

  if (msg.action === 'getActivePage' || msg.action === 'extractPage') {
    (async () => {
      try {
        const page = Number.isInteger(msg.tabId) && msg.tabId >= 0
          ? { tabId: msg.tabId, url: msg.expectedUrl }
          : await AnanPageAccess.getActivePage(chrome, { windowId: msg.windowId });
        sendResponse(msg.action === 'getActivePage' ? page : await AnanPageAccess.extractPage(chrome, page));
      } catch (e) {
        sendResponse({ error: e.message || '提取页面内容失败（此页面可能禁止脚本注入）' });
      }
    })();
    return true; // async
  }

  if (msg.action === 'openOptions') {
    chrome.runtime.openOptionsPage();
    sendResponse({ ok: true });
    return true;
  }
});
