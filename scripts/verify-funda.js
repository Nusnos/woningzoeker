import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { searchHomes, safeFundaUrl } from '../lib/source.js';
const base = process.argv[2] ? new URL(process.argv[2]).origin : null;
const bypass = base ? JSON.parse(await readFile('.vercel/automation-bypass.json', 'utf8')).secret : null;
const filters = { location: 'Den Bosch', radius: 5, minPrice: 0, maxPrice: 500000, type: 'koop', keywords: '', portal: 'funda' };
const search = async query => {
  if (!base) return searchHomes(query);
  const response = await fetch(`${base}/api/search?${new URLSearchParams(query)}`, { headers: { 'x-vercel-protection-bypass': bypass }, signal: AbortSignal.timeout(240000) });
  assert.equal(response.status, 200);
  return response.json();
};
const funda = await search(filters);
assert(funda.homes.length >= 3, 'At least three actual homes with Funda references required');
for (const home of funda.homes) {
  assert.equal(safeFundaUrl(home.fundaUrl), home.fundaUrl);
  assert(home.fundaUrl.includes('/detail/koop/'));
  assert(home.address && home.price > 0 && home.price <= 500000 && home.distance <= 5);
  assert(home.url.startsWith('https://buurtje.nl/'));
}
assert.equal(funda.filters.portal, 'funda');
assert(funda.notice.includes('geen volledige Funda-feed'));
const all = await search({ ...filters, portal: 'all' });
assert(all.homes.length >= 3);
assert(all.homes.some(h => h.fundaUrl === null), 'All-source mode should retain homes without Funda links');
const combined = await search({ ...filters, minPrice: 350000, keywords: 'tuin' });
assert(combined.homes.length > 0);
assert(combined.homes.every(h => h.fundaUrl && h.price >= 350000 && h.price <= 500000));
const report = { at: new Date().toISOString(), deployment: base || 'local', query: filters,
  passed: true, withFundaLinks: funda.homes.length, allHomesOnFirstPage: all.homes.length,
  priceAndKeywordMatches: combined.homes.length,
  examples: funda.homes.slice(0, 5).map(({ address, price, url, fundaUrl }) => ({ address, price, url, fundaUrl })),
  scope: 'References supplied by Buurtje.nl. Funda pages are not automatically verified, and this is not a complete independent Funda feed.' };
await writeFile('docs/funda-verification.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
