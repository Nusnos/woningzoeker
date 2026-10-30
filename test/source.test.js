import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseFilters, distanceKm, distanceFromArea, boundingBox, parseCards, parseDetail, keywordMatch, searchHomes, geocode, safeSourceUrl, safeFundaUrl } from '../lib/source.js';
import { wktToGeoJSON } from '@terraformer/wkt';

const card = readFileSync(new URL('./fixtures/card.html', import.meta.url), 'utf8');
const detail = readFileSync(new URL('./fixtures/detail.html', import.meta.url), 'utf8');
const fundaSources = readFileSync(new URL('./fixtures/funda-sources.html', import.meta.url), 'utf8');
const geography = JSON.parse(readFileSync(new URL('./fixtures/den-bosch-geography.json', import.meta.url), 'utf8'));
const center = { lat: 51.6931, lng: 5.3239, name: 'Testcentrum op werkelijk woningadres' };
const mockHttp = (override = {}) => async (url, options) => {
  if (String(url).includes('/free?')) return Response.json({ response: { docs: [{ centroide_ll: 'POINT(5.3239 51.6931)', weergavenaam: 'Den Bosch' }] } });
  if (options?.method === 'POST') return Response.json(override.payload || { success: true, data: { html: card, total: 1, total_pages: 1 } });
  return new Response(override.detail || detail);
};

test('filters reject invalid prices, ranges, types and radii', () => {
  for (const bad of [{ minPrice: 10, maxPrice: 1 }, { radius: -1 }, { radius: 51 }, { radius: 'NaN' }, { maxPrice: Infinity }, { type: 'other' }, { portal: 'unknown' }, { location: '' }, { keywords: 'x'.repeat(121) }]) assert.throws(() => parseFilters(bad), { code: 'INVALID_FILTER' });
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
test('only real HTTPS Funda property paths are accepted and tracking is removed', () => {
  const url = 'https://www.funda.nl/detail/koop/den-bosch/appartement-lagelandstraat-156/44653422/';
  assert.equal(safeFundaUrl(url + '?utm_source=example#section'), url);
  assert.equal(safeFundaUrl(url.replace('www.funda.nl', 'funda.nl')), url);
  for (const bad of [undefined, url.replace('https:', 'http:'), url.replace('www.funda.nl', 'www.funda.nl.example.org'), url.replace('www.funda.nl', 'someone@www.funda.nl'), 'https://www.funda.nl/makelaar/1234/', 'https://www.funda.nl/zoeken/koop/', 'javascript:alert(1)']) assert.equal(safeFundaUrl(bad), null);
});
test('Funda references come from the actual source list, not from related homes', () => {
  const parsed = parseDetail(detail + fundaSources);
  assert.deepEqual(parsed.fundaUrls, ['https://www.funda.nl/detail/koop/den-bosch/appartement-lagelandstraat-156/44653422/']);
  assert.deepEqual(parseDetail(detail + '<a href="https://www.funda.nl/detail/koop/den-bosch/huis-other/12345/">Related</a>').fundaUrls, []);
});
test('Funda filter excludes homes without a Funda reference and keeps stable home IDs', async () => {
  const all = await searchHomes({}, { center, http: mockHttp() });
  assert.equal(all.homes.length, 1); assert.equal(all.homes[0].fundaUrl, null);
  assert.equal((await searchHomes({ portal: 'funda' }, { center, http: mockHttp() })).homes.length, 0);
  const funda = await searchHomes({ portal: 'funda' }, { center, http: mockHttp({ detail: detail + fundaSources }) });
  assert.equal(funda.homes.length, 1); assert.equal(funda.homes[0].id, all.homes[0].id);
  assert(funda.homes[0].fundaUrl.endsWith('/44653422/'));
  assert(funda.notice.includes('geen volledige Funda-feed'));
});
test('a koop reference cannot qualify a rental for the Funda filter', async () => {
  const result = await searchHomes({ type: 'huur', maxPrice: 500000, portal: 'funda' }, { center, http: mockHttp({ detail: detail + fundaSources }) });
  assert.equal(result.homes.length, 0);
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
test('page 2 and subsequent pages are actually requested, instead of being declared complete without fetching', async () => {
  const requested = [];
  const http = async (_url, options) => {
    if (!options?.body) return new Response(detail);
    requested.push(Number(options.body.get('page')));
    return Response.json({ success: true, data: { html: card, total: 3, total_pages: 3 } });
  };
  const result = await searchHomes({}, { center, http, startPage: 2, maxPages: 2, complete: true });
  assert.deepEqual(requested, [2, 3]); assert.equal(result.scanned, 2); assert.equal(result.nextPage, null);
});
test('Den Bosch place mode includes the historic city, even though it is outside the 1 km centroid circle', async () => {
  const http = async () => Response.json({ response: { docs: [geography] } });
  const place = await geocode('Den Bosch', http, 'place');
  const historicCity = { lat: 51.688, lng: 5.303 };
  assert(distanceKm(place, historicCity) > 1);
  assert.equal(distanceFromArea(place, historicCity), 0);
  const box = boundingBox(place, 1);
  assert(box.sw_lat < historicCity.lat && box.ne_lat > historicCity.lat);
  assert.equal((await geocode('Den Bosch', http, 'point')).geometry, undefined);
});
test('place buffer excludes points beyond 1 km and includes each part of a multipolygon', () => {
  const place = { ...center, geometry: wktToGeoJSON('MULTIPOLYGON(((5 51,5.01 51,5.01 51.01,5 51.01,5 51)),((5.1 51,5.11 51,5.11 51.01,5.1 51.01,5.1 51)))') };
  assert.equal(distanceFromArea(place, { lng: 5.105, lat: 51.005 }), 0);
  assert(distanceFromArea(place, { lng: 5.015, lat: 51.005 }) < 1);
  assert(distanceFromArea(place, { lng: 5.04, lat: 51.005 }) > 1);
});
test('missing place geometry fails explicitly; addresses retain point search', async () => {
  const http = async () => Response.json({ response: { docs: [{ ...geography, geometrie_ll: undefined }] } });
  await assert.rejects(geocode('Den Bosch', http, 'place'), { code: 'LOCATION_GEOMETRY' });
  const addressHttp = async () => Response.json({ response: { docs: [{ ...geography, type: 'adres' }] } });
  assert.equal((await geocode('address', addressHttp, 'place')).kind, 'point');
});
