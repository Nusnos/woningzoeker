import express from 'express';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { searchHomes } from './lib/source.js';
import { BlobStore } from './lib/store.js';
import { subscribe, confirm, unsubscribe, runDaily } from './lib/alerts.js';
import { authorized } from './lib/security.js';
import { mailConfig, verifySmtp } from './lib/mail.js';
import { AppError, logError } from './lib/errors.js';

export function createApp({ store = new BlobStore(), search = searchHomes, mail, verifyMail = verifySmtp } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use((req, res, next) => {
    res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'self'; img-src 'self' https://buurtje.nl data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()' });
    req.requestId = randomUUID();
    res.set('X-Request-Id', req.requestId);
    if (req.path.startsWith('/api/')) res.set('Cache-Control', 'no-store');
    next();
  });
  app.use(express.json({ limit: '8kb' }));
  app.use(express.urlencoded({ extended: false, limit: '2kb' }));
  app.get('/api/search', async (req, res) => {
    const result = await search(req.query, { startPage: req.query.page ? Number(req.query.page) : 1 });
    res.json(result);
  });
  app.post('/api/subscribe', async (req, res) => {
    if (!mail) mailConfig();
    res.json(await subscribe(store, req.body, req.ip, mail));
  });
  app.post('/api/confirm', async (req, res) => res.json(await confirm(store, req.body.token, search)));
  app.post('/api/unsubscribe', async (req, res) => res.json(await unsubscribe(store, req.body.token || req.query.token)));
  const dailyHandler = async (req, res) => {
    if (!authorized(req.headers.authorization)) throw new AppError('UNAUTHORIZED', 'Niet toegestaan.', 401);
    res.json(await runDaily(store, { search, send: mail, force: req.method === 'POST' && req.body?.force === true }));
  };
  app.post('/api/cron/daily', dailyHandler);
  app.get('/api/cron/daily', dailyHandler);
  app.get('/api/health', (_req, res) => res.json({ ok: true, source: 'Buurtje.nl', schedule: { cron: '0 13 * * *', timezone: 'Europe/Amsterdam', provider: 'GitHub Actions' } }));
  app.post('/api/diagnostics', async (req, res) => {
    if (!authorized(req.headers.authorization)) throw new AppError('UNAUTHORIZED', 'Niet toegestaan.', 401);
    const state = await store.read();
    await verifyMail();
    res.json({ ok: true, storage: 'readable', smtp: 'verified', activeSearches: Object.values(state.state.subscribers).filter(s => s.confirmedAt).length,
      lastDaily: state.state.health.lastDaily || null });
  });
  app.use(express.static(fileURLToPath(new URL('./public/', import.meta.url)), { etag: true }));
  app.get(['/confirm', '/unsubscribe', '/privacy'], (_req, res) => res.sendFile(fileURLToPath(new URL('./public/index.html', import.meta.url))));
  app.use((_req, _res, next) => next(new AppError('NOT_FOUND', 'Deze pagina bestaat niet.', 404)));
  app.use((error, req, res, _next) => {
    const requestId = logError(error, req.path.replace(/[^a-zA-Z/]/g, '').slice(0, 60), req.requestId);
    const status = error.status && error.status >= 400 && error.status < 600 ? error.status : 500;
    res.status(status).json({ error: error instanceof AppError ? error.message : 'Er ging iets mis. Probeer het later opnieuw.', code: error.code || 'UNEXPECTED', requestId });
  });
  return app;
}

export default createApp();
