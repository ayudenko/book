import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { clientIp } from './backend/client-ip.mjs';
import { createApp, errorResponse, MAX_BODY } from './backend/app.mjs';

const files = { '/formatting.js': ['formatting.js', 'text/javascript'], '/favicon.svg': ['favicon.svg', 'image/svg+xml'], '/': ['index.html', 'text/html'], '/index.html': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/model.js': ['model.js', 'text/javascript'], '/sync.js': ['sync.js', 'text/javascript'], '/styles.css': ['styles.css', 'text/css'] };
const headers = {
  'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-cache', 'Referrer-Policy': 'same-origin',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
};
export function makeServer(options = {}) {
  const api = createApp(options);
  const server = createServer(async (req, res) => {
    try {
      const path = new URL(req.url, options.origin || 'http://localhost:4000').pathname;
      if (path.startsWith('/api/')) {
        const chunks = []; let size = 0;
        const limit = path.startsWith('/api/auth/') ? 8192 : MAX_BODY;
        for await (const chunk of req) {
          size += chunk.length;
          if (size > limit) {
            const response = errorResponse(413,'body_too_large','Размер запроса превышает допустимый.');
            res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(await response.text()); return;
          }
          chunks.push(chunk);
        }
        const request = new Request(`${options.origin || 'http://localhost:4000'}${req.url}`, {
          method: req.method, headers: req.headers,
          ...(!['GET','HEAD'].includes(req.method) ? {body: Buffer.concat(chunks)} : {})
        });
        const response = await api.handle(request, {ip: clientIp(req, options.trustFlyProxy)});
        res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(Buffer.from(await response.arrayBuffer())); return;
      }
      const file = files[path];
      if (!file || !['GET','HEAD'].includes(req.method)) {res.writeHead(404, headers);res.end('Not found');return;}
      const data = await readFile(new URL(`./dist/${file[0]}`, import.meta.url));
      res.writeHead(200, {...headers, 'Content-Type': `${file[1]}; charset=utf-8`}); res.end(req.method === 'HEAD' ? undefined : data);
    } catch { if (!res.headersSent) res.writeHead(500, headers); res.end('Unable to handle request'); }
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 15_000;
  server.on('close', api.close);
  return server;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.umask(0o077);
  const port = Number(process.env.PORT || 4000);
  const server = makeServer({databasePath: process.env.DATABASE_PATH || './data/quiet-chapter.sqlite', origin: process.env.APP_ORIGIN || `http://localhost:${port}`, production: process.env.NODE_ENV === 'production', trustFlyProxy: process.env.TRUST_FLY_PROXY === 'true' && !!process.env.FLY_APP_NAME});
  server.on('error', error => {console.error(`Не удалось запустить сервер: ${error.code}`); process.exitCode = 1;});
  server.listen(port, process.env.HOST || '127.0.0.1', () => console.log(`Тихая глава → ${process.env.APP_ORIGIN || `http://localhost:${port}`}`));
  for (const signal of ['SIGINT','SIGTERM']) process.on(signal, () => server.close());
}
