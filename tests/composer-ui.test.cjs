const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'sidepanel.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '..', 'sidepanel.html'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '..', 'styles/sidepanel.css'), 'utf8');

test('composer removes persistent instructions without suppressing offline errors', () => {
  const start = source.indexOf('  function updateHint('), end = source.indexOf('  async function handleSend(', start);
  const ctx = vm.createContext({ inputHint: { textContent: 'old' }, intentHint: { textContent: 'old' },
    serverStatus: { classList: { contains: () => false }, dataset: {} } });
  vm.runInContext(source.slice(start, end), ctx); ctx.updateHint();
  assert.equal(ctx.inputHint.textContent, ''); assert.equal(ctx.intentHint.textContent, '');
  ctx.serverStatus.classList.contains = () => true;
  ctx.serverStatus.dataset.message = '模型连接错误'; ctx.updateHint();
  assert.equal(ctx.inputHint.textContent, '模型连接错误');
  assert.ok(!source.includes('留空按 Enter = 总结当前网页'));
  assert.ok(!source.includes('已记住，可直接追问 · 第四页会替换最早的一页'));
  assert.ok(!html.includes('id="contextHint"'));
});

test('memory is a capsule stack supporting hover and visible keyboard focus', () => {
  assert.match(html, /role="group" aria-label="已记住的网页"/);
  assert.match(source, /setProperty\('--source-count', conversation.pages.length\)/);
  assert.match(source, /setProperty\('--source-index', index\)/);
  assert.match(css, /\.source-card \{[^}]*border-radius: 999px/);
  assert.match(css, /:hover, :has\(:focus-visible\)/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /\.input-meta:not\(:has\(span:not\(:empty\)\)\) \{ display: none;/);
});

test('capsule stack stays compact and left aligned, including when expanded', () => {
  assert.match(css, /\.context-sources \{[^}]*width: min\(260px, 100%\);[^}]*margin-left: 0;[^}]*margin-right: auto;/);
  assert.match(css, /\.context-sources:is\(:hover, :has\(:focus-visible\)\) \.source-card \{[^}]*left: 0; width: 100%;/);
});
