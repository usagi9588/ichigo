import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { AppError, Store } from './store.ts';
import type { JobInput } from './store.ts';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export type Reply = { status: number; headers: Record<string,string>; body: string | Buffer };
export function makeApp(options: { directory?: string; port?: number } = {}) {
  const port = options.port ?? 4174;
  const store = new Store(options.directory ?? process.env.ICHIGO_DATA_DIR ?? join(root,'.data'));
  const base = `http://127.0.0.1:${port}`;
  const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  const origins = new Set([base, `http://localhost:${port}`]);
  function dispatch(method: string, path: string, headers: Record<string, string | undefined> = {}, input: unknown = {}): Reply {
    const common = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'x-frame-options': 'DENY' };
    function json(value: unknown, status = 200): Reply { return {status, headers: { ...common, 'content-type': 'application/json; charset=utf-8' }, body: JSON.stringify(value)}; }
    try {
      if (!hosts.has(headers.host ?? `127.0.0.1:${port}`)) throw new AppError('Host not allowed', 403);
      if (headers.origin && !origins.has(headers.origin)) throw new AppError('Request origin not allowed', 403);
      if (!['GET','HEAD'].includes(method)) {
        if (!headers['content-type']?.startsWith('application/json')) throw new AppError('Write requests must use application/json', 415);
        if (headers['sec-fetch-site'] === 'cross-site') throw new AppError('Cross-site writes are not allowed', 403);
        if (!headers.origin && headers['x-ichigo-client'] !== 'cli') throw new AppError('Missing local client identifier', 403);
      }
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw new AppError('Request body must be a JSON object');
      const body = input as JobInput;
      const pathname = new URL(path, base).pathname;
      const enriched = (job: {id: number}) => ({ ...job, detailUrl: `${base}/#job/${job.id}` });
      if (pathname === '/api/health' && method === 'GET') return json({ service: 'ichigo', version: '0.1.0', baseUrl: base, projectId: createHash('sha256').update(root).digest('hex').slice(0,16), pid: process.pid });
      if (pathname === '/api/jobs' && method === 'GET') return json({ jobs: store.list().map(enriched) });
      if (pathname === '/api/jobs' && method === 'POST') {
        const result = store.create(body); return json({ ...result, job: enriched(result.job) }, result.created ? 201 : 200);
      }
      if (pathname === '/api/import' && method === 'POST') return json(store.importLegacy(body));
      const match = pathname.match(/^\/api\/jobs\/([1-9]\d*)(?:\/(start|result|pages|screenshot))?$/);
      if (match) {
        const id = Number(match[1]); if (!Number.isSafeInteger(id)) throw new AppError('Invalid job ID');
        const action = match[2];
        if (!action && method === 'GET') return json({ job: enriched(store.get(id)) });
        if (!action && method === 'PATCH') return json({ job: enriched(store.patch(id, body)) });
        if (action === 'start' && method === 'POST') {
          const result = store.start(id); return json({ ...result, job: enriched(result.job) });
        }
        if (action === 'result' && method === 'POST') return json({ job: enriched(store.finish(id, body)) });
        if (action === 'pages' && method === 'POST') return json({ session: store.pages(id, body) });
        if (action === 'screenshot' && method === 'POST') return json({ job: enriched(store.screenshot(id, body)) });
        throw new AppError('Method not allowed', 405);
      }
      if (method !== 'GET' && method !== 'HEAD') throw new AppError('API endpoint not found', 404);
      const assets: Record<string,[string,string]> = {
        '/': ['index.html','text/html; charset=utf-8'], '/index.html': ['index.html','text/html; charset=utf-8'],
        '/app.js': ['app.js','text/javascript; charset=utf-8'], '/style.css': ['style.css','text/css; charset=utf-8']
      };
      if (assets[pathname]) {
        const [file,type] = assets[pathname];
        return { status: 200, headers: {...common, 'content-type': type}, body: readFileSync(join(root,file)) };
      }
      if (/^\/screenshots\/[1-9]\d*-[0-9a-f-]{36}\.(png|pdf)$/.test(pathname)) {
        try { return {status: 200, headers: {...common,'content-type':pathname.endsWith('.pdf') ? 'application/pdf' : 'image/png'}, body: readFileSync(join(store.directory, pathname.slice(1))) }; }
        catch { throw new AppError('Screenshot file not found',404); }
      }
      throw new AppError('Page not found',404);
    } catch (error) {
      if (error instanceof AppError) return json({error: error.message}, error.status);
      console.error(error);
      return json({error: 'Service error. Please try again; existing data was preserved'},500);
    }
  }
  return { store, dispatch, base };
}
export function startServer() {
  const port = Number(process.env.ICHIGO_PORT ?? 4174);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('ICHIGO_PORT must be between 1024 and 65535');
  const app = makeApp({port});
  const server = createServer(async (req,res) => {
    const headers = Object.fromEntries(Object.entries(req.headers).map(([k,v]) => [k, Array.isArray(v) ? v.join(',') : v]));
    try {
      let size = 0; const chunks: Buffer[] = [];
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 17 * 1024 * 1024) throw new AppError('Request body too large',413);
        chunks.push(Buffer.from(chunk));
      }
      let body: unknown = {};
      if (chunks.length) {
        try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
        catch { throw new AppError('Invalid JSON'); }
      }
      const result = app.dispatch(req.method ?? 'GET',req.url ?? '/',headers,body);
      res.writeHead(result.status,result.headers); res.end(req.method === 'HEAD' ? undefined : result.body);
    } catch (e) {
      res.writeHead(e instanceof AppError ? e.status : 500, {'content-type':'application/json; charset=utf-8'});
      res.end(JSON.stringify({error: e instanceof AppError ? e.message : 'Request failed'}));
    }
  });
  server.requestTimeout = 30000;
  server.listen(port,'127.0.0.1',() => console.log(`🍓 Ichigo ${app.base}`));
  server.on('error', e => { console.error(e); app.store.close(); process.exitCode=1; });
  for (const signal of ['SIGINT','SIGTERM'] as const) process.once(signal,() => server.close(() => {app.store.close(); process.exit(0);}));
  return server;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) startServer();
