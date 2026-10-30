import { writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { searchHomes, distanceKm } from '../lib/source.js';

const started = Date.now();
const result = await searchHomes({ location: 'Den Bosch', radius: 5, minPrice: 0, maxPrice: 500000, type: 'koop', keywords: '' });
assert(result.homes.length >= 3, 'At least three real matching homes required');
for (const home of result.homes) {
  assert(home.address && home.url.startsWith('https://buurtje.nl/'));
  assert(home.price > 0 && home.price <= 500000);
  assert(distanceKm(result.center, home) <= 5);
  assert(home.checkedAt);
}
const report = { checkedAt: new Date().toISOString(), durationMs: Date.now() - started,
  passed: true, query: result.filters, center: result.center, verified: result.homes.length,
  homes: result.homes.map(({ address, locality, price, url }) => ({ address, locality, price, url })) };
await writeFile('docs/live-search.json', JSON.stringify(report, null, 2) + '\n');
console.log(`PASS live search: ${report.verified} verified homes, ${report.durationMs}ms`);
