import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { searchPages } from '../public/search-pages.js';
const base = new URL(process.argv[2]).origin;
const bypass = JSON.parse(await readFile('.vercel/automation-bypass.json', 'utf8')).secret;
const filters = { location: 'Den Bosch', radius: '1', minPrice: '400000', maxPrice: '750000', type: 'koop', portal: 'all', areaMode: 'place' };
const homes = new Map(), calls = [];
let final;
for await (const result of searchPages(async page => {
  calls.push(page);
  const r = await fetch(`${base}/api/search?${new URLSearchParams({ ...filters, page })}`, { headers: { 'x-vercel-protection-bypass': bypass }, signal: AbortSignal.timeout(240000) });
  assert.equal(r.status, 200); return r.json();
})) {
  final = result;
  for (const home of result.homes) {
    assert(home.price >= 400000 && home.price <= 750000 && home.distance <= 1 && home.distanceKind === 'boundary');
    homes.set(home.id, home);
  }
}
assert.equal(final.complete, true); assert.equal(final.nextPage, null); assert.equal(final.center.kind, 'place');
assert(calls.length > 1 && calls.includes(2)); assert(homes.size > 50);
const pointResponse = await fetch(`${base}/api/search?${new URLSearchParams({ ...filters, areaMode: 'point' })}`, { headers: { 'x-vercel-protection-bypass': bypass } });
assert.equal(pointResponse.status, 200); const point = await pointResponse.json();
assert(homes.size > point.homes.length);
const report = { at: new Date().toISOString(), deployment: base, filters, passed: true,
  verifiedHomes: homes.size, apiPages: calls, complete: true, pointCircleFirstPageCount: point.homes.length,
  examples: [...homes.values()].slice(0, 8).map(({ address, price, distance, distanceKind, url }) => ({ address, price, distance, distanceKind, url })) };
await writeFile('docs/area-search-verification.json', JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report, null, 2));
