const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const code = fs.readFileSync(path.join(__dirname, '..', 'options.js'), 'utf8');
function fixture(response, lastError = null) {
  const classes = new Set();
  const ctx = vm.createContext({ clearTimeout() {}, setTimeout: () => 1, downloadPoll: null,
    downloadButton: {}, downloadStatus: { classList: { add: x => classes.add(x), toggle: (x, active) => active ? classes.add(x) : classes.delete(x) } },
    downloadProgress: { removeAttribute() {} }, chrome: { runtime: { lastError,
      sendNativeMessage(host, message, callback) { assert.equal(host, 'com.anan.chrome.runtime'); callback(response); } } } });
  vm.runInContext(code.slice(code.indexOf('  function modelRequest('), code.indexOf('  downloadButton.addEventListener(')), ctx);
  return ctx;
}
test('download progress, verification, ready and retry states', async () => {
  for (const status of ['notDownloaded', 'downloading', 'verifying', 'ready', 'error', 'interrupted']) {
    const ctx = fixture({ ok: true, download: { status, bytes: 40, total: 100, error: '请稍后重试' } });
    await ctx.updateDownload();
    assert.equal(ctx.downloadButton.disabled, ['downloading', 'verifying', 'ready'].includes(status));
    assert.equal(ctx.downloadProgress.hidden, !['downloading', 'verifying'].includes(status));
    if (status === 'downloading') assert.equal(ctx.downloadProgress.value, 40);
  }
});
test('missing or older host gives installation instructions and allows retry', async () => {
  const missing = fixture(null, { message: 'Native host not found' }); await missing.updateDownload();
  assert.match(missing.downloadStatus.textContent, /Install-AnanChrome.cmd/); assert.equal(missing.downloadButton.disabled, false);
  const old = fixture({ ok: true, status: 'alreadyRunning' }); await old.updateDownload();
  assert.match(old.downloadStatus.textContent, /版本过旧/);
});
test('button backup link points to matching stable model, not an expiring signed URL', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'options.html'), 'utf8');
  const url = html.match(/id="modelDownloadLink" href="([^"]+)"/)[1];
  assert.match(url, /HauhauCS.*resolve\/main.*Q4_K_M\.gguf/); assert.ok(!url.includes('Expires='));
});
