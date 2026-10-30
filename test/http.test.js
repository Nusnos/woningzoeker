import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../server.js';
import { MemoryStore } from '../lib/store.js';
let server, base;
before(async () => { process.env.CRON_SECRET = 'fixture-secret'; server = createApp({ store: new MemoryStore(), search: async () => ({ homes: [], complete: true }), mail: async () => {} }).listen(0, '127.0.0.1'); await once(server, 'listening'); base = `http://127.0.0.1:${server.address().port}`; });
after(() => server.close());
test('home and privacy render, APIs are uncached and have security headers', async () => {
  for (const path of ['/', '/privacy', '/confirm', '/unsubscribe']) {
    const r = await fetch(base + path); assert.equal(r.status, 200); assert((await r.text()).includes('lang="nl"'));
    assert.equal(r.headers.get('referrer-policy'), 'no-referrer'); assert(r.headers.get('content-security-policy').includes("frame-ancestors 'none'"));
  }
  const r = await fetch(base + '/api/search'); assert.equal(r.headers.get('cache-control'), 'no-store');
});
test('unauthorized cron and diagnostics are rejected', async () => {
  for (const path of ['/api/cron/daily', '/api/diagnostics']) assert.equal((await fetch(base + path, { method: 'POST' })).status, 401);
  assert.equal((await fetch(base + '/api/cron/daily?slot=summer')).status, 401);
});
test('confirmation GET cannot activate a subscription and POST requires a token', async () => {
  assert.equal((await fetch(base + '/api/confirm')).status, 404);
  assert.equal((await fetch(base + '/api/confirm', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 400);
});
test('malformed and oversized JSON do not crash the application', async () => {
  const broken = await fetch(base + '/api/subscribe', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' }); assert.equal(broken.status, 400);
  const large = await fetch(base + '/api/subscribe', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ junk: 'x'.repeat(9000) }) }); assert.equal(large.status, 413);
});
