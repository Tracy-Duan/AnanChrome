// Development-only UI harness. Browser APIs use synthetic pages and an in-memory
// session store; generation is proxied to the existing local model. Never packaged.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const session = {};
const local = {};
const port = Number(process.env.ANAN_PREVIEW_PORT || 8094);
const files = new Set(['sidepanel.html', 'sidepanel.js', 'options.html', 'options.js', 'chat-library.js', 'conversation.js', 'page-access.js', 'chat-policy.js', 'chat-stream.js', 'styles/sidepanel.css', 'icons/icon128.png', 'icons/icon48.png', 'icons/icon32.png']);
http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    if (['/fixture/session', '/fixture/local'].includes(url.pathname)) {
      const store = url.pathname.endsWith('/local') ? local : session;
      if (req.method === 'POST') Object.assign(store, JSON.parse(body.toString()));
      if (req.method === 'DELETE') for (const key of JSON.parse(body.toString())) delete store[key];
      res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(store)); return;
    }
    if (url.pathname.startsWith('/model/')) {
      const upstream = await fetch('http://127.0.0.1:8080' + url.pathname.slice(6), {
        method: req.method, headers: { 'Content-Type': 'application/json' }, body: req.method === 'POST' ? body : undefined,
        signal: AbortSignal.timeout(90000)
      });
      res.writeHead(upstream.status, { 'Content-Type': upstream.headers.get('Content-Type') });
      for await (const chunk of upstream.body) res.write(chunk);
      res.end(); return;
    }
    const filename = url.pathname === '/' ? 'sidepanel.html' : decodeURIComponent(url.pathname.slice(1));
    if (filename === 'fixture.js') {
      res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
      res.end(fs.readFileSync(path.join(__dirname, 'preview-fixture.js'))); return;
    }
    if (!files.has(filename)) { res.writeHead(404); res.end('Not found'); return; }
    let content = fs.readFileSync(path.join(root, filename));
    const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };
    res.setHeader('Content-Type', (mime[path.extname(filename)] || 'text/plain') + '; charset=utf-8');
    if (filename.endsWith('.html')) content = content.toString().replace('<head>', '<head><script src="fixture.js"></script>');
    res.end(content);
  } catch (error) { res.writeHead(500); res.end(error.message); }
}).listen(port, '127.0.0.1', () => console.log(`Synthetic sidebar UI: http://127.0.0.1:${port}/`));
