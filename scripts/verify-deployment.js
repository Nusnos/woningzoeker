import { readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const base = new URL(process.argv[2]).origin;
const { secret } = JSON.parse(await readFile('.vercel/automation-bypass.json', 'utf8'));
const results = [];
async function request(path, options = {}) {
  const response = await fetch(base + path, { ...options, headers: { 'x-vercel-protection-bypass': secret, 'content-type': 'application/json', ...options.headers }, signal: AbortSignal.timeout(240000) });
  const text = await response.text();
  let data; try { data = JSON.parse(text); } catch { throw Error(`${path.split('?')[0]}: HTTP ${response.status}, response is not JSON`); }
  assert(response.ok, `${path.split('?')[0]}: HTTP ${response.status}, ${data.code || 'unknown'}`);
  return data;
}
const filters = new URLSearchParams({ location: 'Den Bosch', radius: '5', minPrice: '0', maxPrice: '500000', type: 'koop' });
const first = await request('/api/search?' + filters);
assert(first.homes.length >= 3);
assert(first.homes.every(h => h.price <= 500000 && h.price > 0 && h.distance <= 5 && h.checkedAt));
results.push({ test: 'live sale search from Vercel', passed: true, count: first.homes.length, example: first.homes.slice(0, 3).map(({ address, price, url }) => ({ address, price, url })) });
filters.set('minPrice', '400000'); filters.set('keywords', 'tuin');
const keywords = await request('/api/search?' + filters);
assert(keywords.homes.length > 0); assert(keywords.homes.every(h => h.price >= 400000 && h.price <= 500000));
results.push({ test: 'min/max price and keyword search', passed: true, count: keywords.homes.length });
filters.set('minPrice', '0'); filters.set('maxPrice', '2000'); filters.set('type', 'huur'); filters.set('keywords', '');
const rent = await request('/api/search?' + filters);
assert(rent.homes.length > 0 && rent.homes.every(h => h.type === 'huur' && h.price <= 2000));
results.push({ test: 'live rental search', passed: true, count: rent.homes.length });
const alternate = await request('/api/search?' + new URLSearchParams({ location: 'Utrecht', radius: '1', minPrice: '300000', maxPrice: '500000', type: 'koop' }));
assert(alternate.homes.length > 0 && alternate.center.name.includes('Utrecht'));
assert(alternate.homes.every(h => h.distance <= 1 && h.price >= 300000 && h.price <= 500000));
results.push({ test: 'different location and 1 km radius', passed: true, count: alternate.homes.length });
const empty = await request('/api/search?' + new URLSearchParams({ location: 'Den Bosch', radius: '1', minPrice: '1', maxPrice: '1', type: 'koop' }));
assert.equal(empty.homes.length, 0); assert.equal(empty.complete, true);
results.push({ test: 'empty real search produces no fabricated fallback', passed: true });
const diagnostics = await request('/api/diagnostics', { method: 'POST', headers: { authorization: `Bearer ${process.env.CRON_SECRET}` }, body: '{}' });
assert.equal(diagnostics.smtp, 'verified'); assert.equal(diagnostics.storage, 'readable');
results.push({ test: 'production private storage and SMTP authentication', passed: true });
// Check the Vercel GET trigger without sending another message: the completed
// operator test already marked today done and removed its subscription.
const cron = await request('/api/cron/daily?slot=verification', { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } });
assert(cron.skipped === 'done' || cron.skipped === 'before_13_amsterdam' || cron.sent === 0);
results.push({ test: 'authenticated Vercel fallback cron', passed: true });
const report = { at: new Date().toISOString(), deployment: base, results };
await writeFile('docs/deployment-verification.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
