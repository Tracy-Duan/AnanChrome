const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'service-worker.js'), 'utf8');
function context() {
  const ignore = { addListener() {} };
  const chrome = {
    sidePanel: { setPanelBehavior: () => Promise.resolve() },
    runtime: { id: 'padicgoaheglbafnjjbjaooakfdcjfmi', onInstalled: ignore, onMessage: ignore },
    contextMenus: { onClicked: ignore }
  };
  const ctx = vm.createContext({ chrome, console: { warn() {} } });
  ctx.importScripts = (...files) => files.forEach(file => vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), ctx));
  vm.runInContext(source, ctx);
  return ctx;
}

for (const [detail, expected] of [
  ['Specified native messaging host not found.', 'runtimeNotInstalled'],
  ['Access to the specified native messaging host is forbidden.', 'runtimeAccessDenied'],
  ['Failed to start native messaging host.', 'runtimeStartFailed'],
  ['Native host has exited.', 'runtimeExited'],
  ['Missing nativeMessaging permission', 'runtimePermissionMissing'],
  ['Error when communicating with the native messaging host.', 'runtimeCommunicationError']
]) {
  test(expected, () => {
    const ctx = context();
    const result = ctx.nativeRuntimeFailure(detail);
    assert.equal(result.ok, false);
    assert.equal(result.status, expected);
    assert.equal(result.detail, detail);
    assert.equal(result.extensionId, ctx.chrome.runtime.id);
  });
}

test('callback failure retains the true error', () => {
  const ctx = context();
  ctx.chrome.runtime.sendNativeMessage = (host, message, callback) => {
    assert.equal(host, 'com.anan.chrome.runtime');
    ctx.chrome.runtime.lastError = { message: 'Native host has exited.' };
    callback();
  };
  ctx.ensureLocalServer(result => assert.equal(result.status, 'runtimeExited'));
});

test('synchronous transport failure is returned, not thrown', () => {
  const ctx = context();
  ctx.chrome.runtime.sendNativeMessage = () => { throw new Error('Missing nativeMessaging permission'); };
  ctx.ensureLocalServer(result => assert.equal(result.status, 'runtimePermissionMissing'));
});

test('successful runtime response is preserved', () => {
  const ctx = context();
  const response = { ok: true, status: 'ready' };
  ctx.chrome.runtime.sendNativeMessage = (host, message, callback) => callback(response);
  ctx.ensureLocalServer(result => assert.equal(result, response));
});
