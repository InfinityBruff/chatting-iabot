import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
const html = new URL('../dist/index.html', import.meta.url);
const port = Number(process.env.PORT || 8765);
createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  if (!['GET', 'HEAD'].includes(req.method)) {
    res.writeHead(405, { Allow: 'GET, HEAD' }); res.end(); return;
  }
  if (!['/', '/index.html'].includes(path)) {
    res.writeHead(404); res.end('Not found'); return;
  }
  try {
    const body = await readFile(html);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch {
    res.writeHead(500); res.end('Could not load application');
  }
}).listen(port, '127.0.0.1', () => console.log(`Chatting IABOT: http://127.0.0.1:${port}`));
