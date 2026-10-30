import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseFilters, distanceKm, boundingBox, parseCards, parseDetail, keywordMatch, searchHomes, geocode, safeSourceUrl } from '../lib/source.js';

const card = readFileSync(new URL('./fixtures/card.html', import.meta.url), 'utf8');
const detail = readFileSync(new URL('./fixtures/detail.html', import.meta.url), 'utf8');
const center = { lat: 51.6931, lng: 5.3239, name: 'Testcentrum op werkelijk woningadres' };
const mockHttp = (override = {}) => async (url, options) => {
  if (String(url).includes('/free?')) return Response.json({ response: { docs: [{ centroide_ll: 'POINT(5.3239 51.6931)', weergavenaam: 'Den Bosch' }] } });
  if (options?.method === 'POST') return Response.json(override.payload || { success: true, data: { html: card, total: 1, total_pages: 1 } });
  return new Response(override.detail || detail);
};

test('filters reject invalid prices, ranges, types and radii', () => {
  for (const bad of [{ minPrice: 10, maxPrice: 1 }, { radius: -1 }, { radius: 51 }, { radius: 'NaN' }, { maxPrice: Infinity }, { type: 'other' }, { location: '' }, { keywords: 'x'.repeat(121) }]) assert.throws(() => parseFilters(bad), { code: 'INVALID_FILTER' });
  assert.equal(parseFilters({ type: 'huur' }).maxPrice, 2000);
});
test('great-circle radius excludes points just outside the requested circle', () => {
  assert.equal(distanceKm(center, center), 0);
  assert(distanceKm(center, { lat: center.lat + 0.05, lng: center.lng }) > 5);
  const box = boundingBox(center, 5); assert(box.ne_lat > center.lat); assert(box.sw_lng < center.lng);
});
test('actual captured listing parses address, price and direct link', () => {
  const [home] = parseCards(card);
  assert.equal(home.address, 'Lagelandstraat 156'); assert.equal(home.price, 269500);
  assert.equal(home.url, 'https://buurtje.nl/appartement/lagelandstraat-156-s-hertogenbosch/');
  assert.equal(parseDetail(detail).available, true);
});
test('unsafe source URLs are refused', () => {
  assert.equal(safeSourceUrl('https://evil.example/home'), null);
  assert.equal(safeSourceUrl('javascript:alert(1)'), null);
  assert.equal(safeSourceUrl('https://user@buurtje.nl/a'), null);
});
test('schema changes fail loudly instead of producing zero homes', async () => {
  assert.throws(() => parseCards('<div class="pc">changed</div>'), { code: 'SOURCE_SCHEMA' });
  await assert.rejects(searchHomes({}, { center, http: mockHttp({ payload: { success: true, data: { html: 'changed', total: 3, total_pages: 1 } } }) }), { code: 'SOURCE_SCHEMA' });
  await assert.rejects(searchHomes({}, { center, http: mockHttp({ payload: { success: false } }) }), { code: 'SOURCE_SCHEMA' });
});
test('all comma-separated keywords must match, accent-insensitively', () => {
  assert(keywordMatch('Ruime privé tuin en een garage', 'prive tuin,garage'));
  assert(!keywordMatch('Ruime tuin', 'tuin,garage'));
});
test('search verifies actual detail, applies inclusive price bounds and radius', async () => {
  const options = { center, http: mockHttp() };
  assert.equal((await searchHomes({ minPrice: 269500, maxPrice: 269500 }, options)).homes.length, 1);
  assert.equal((await searchHomes({ maxPrice: 269499 }, options)).homes.length, 0);
  assert.equal((await searchHomes({}, { ...options, center: { lat: 52.4, lng: 4.9 } })).homes.length, 0);
});
test('changed price and withdrawn listings are excluded', async () => {
  for (const changed of [detail.replace('269500', '269501'), detail.replace('https://schema.org/InStock', 'https://schema.org/SoldOut')]) {
    const result = await searchHomes({}, { center, http: mockHttp({ detail: changed }) });
    assert.equal(result.homes.length, 0);
  }
});
test('a detail failure propagates; incomplete searches cannot become alert baselines', async () => {
  await assert.rejects(searchHomes({}, { center, http: mockHttp({ detail: 'not a property page' }) }), { code: 'SOURCE_SCHEMA' });
  await assert.rejects(searchHomes({}, { center, complete: true, maxPages: 1, http: mockHttp({ payload: { success: true, data: { html: card, total: 72, total_pages: 2 } } }) }), { code: 'SEARCH_TOO_BROAD' });
});
test('pagination is explicit; malformed page input is refused', async () => {
  const r = await searchHomes({}, { center, maxPages: 1, http: mockHttp({ payload: { success: true, data: { html: card, total: 72, total_pages: 2 } } }) });
  assert.equal(r.nextPage, 2); assert.equal(r.complete, false);
  await assert.rejects(searchHomes({}, { center, startPage: -1 }), { code: 'INVALID_PAGE' });
});
test('PDOK location not found is distinct from no matching homes', async () => {
  await assert.rejects(geocode('unknown', async () => Response.json({ response: { docs: [] } })), { code: 'LOCATION_NOT_FOUND' });
});
