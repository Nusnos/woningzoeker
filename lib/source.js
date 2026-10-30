import { load } from 'cheerio';
import { createHash } from 'node:crypto';
import { AppError } from './errors.js';

const SOURCE = 'https://buurtje.nl';
const USER_AGENT = 'Woningzoeker/1.0 (+https://github.com/Nusnos/woningzoeker)';
export const hash = value => createHash('sha256').update(value).digest('hex');
const normalize = value => value.normalize('NFKD').replace(/\p{Diacritic}/gu, '').toLowerCase();

export function parseFilters(raw = {}) {
  const location = String(raw.location ?? 'Den Bosch').trim();
  const type = String(raw.type ?? 'koop');
  const numeric = (name, fallback, max) => {
    const value = Number(raw[name] === '' || raw[name] === undefined ? fallback : raw[name]);
    if (!Number.isFinite(value) || value < 0 || value > max) throw new AppError('INVALID_FILTER', `Ongeldige waarde voor ${name}.`, 400);
    return value;
  };
  const radius = numeric('radius', 5, 50);
  const minPrice = numeric('minPrice', 0, 100000000);
  const maxPrice = numeric('maxPrice', type === 'huur' ? 2000 : 500000, 100000000);
  const keywords = String(raw.keywords ?? '').trim();
  const portal = String(raw.portal ?? 'all');
  if (!location || location.length > 120 || !['koop', 'huur'].includes(type) || !['all', 'funda'].includes(portal) || radius < 1 || maxPrice < 1 || minPrice > maxPrice || keywords.length > 120) {
    throw new AppError('INVALID_FILTER', 'Controleer de locatie, straal (1–50 km), prijzen en zoekwoorden.', 400);
  }
  return { location, radius, minPrice, maxPrice, type, keywords, portal };
}

export async function fetchUpstream(url, options = {}) {
  let response;
  try {
    response = await fetch(url, { ...options, headers: { 'User-Agent': USER_AGENT, ...options.headers }, signal: AbortSignal.timeout(15000), redirect: 'error' });
  } catch {
    throw new AppError('SOURCE_UNREACHABLE', 'De woningbron is tijdelijk niet bereikbaar. Probeer het later opnieuw.');
  }
  if (!response.ok) {
    const error = new AppError('SOURCE_HTTP', 'De woningbron weigert de aanvraag. Er worden geen vervangende resultaten getoond.');
    error.upstreamStatus = response.status;
    throw error;
  }
  return response;
}

export async function geocode(location, http = fetchUpstream) {
  const query = /^(den bosch|'?s[- ]hertogenbosch)$/i.test(location) ? "'s-Hertogenbosch" : location;
  const url = new URL('https://api.pdok.nl/bzk/locatieserver/search/v3_1/free');
  url.search = new URLSearchParams({ q: query, fq: 'type:(woonplaats OR postcode OR adres)', rows: '1' });
  const data = await (await http(url)).json();
  const doc = data.response?.docs?.[0];
  const match = doc?.centroide_ll?.match(/POINT\(([-\d.]+) ([-\d.]+)\)/);
  if (!match || !doc.weergavenaam) throw new AppError('LOCATION_NOT_FOUND', 'Deze Nederlandse locatie is niet gevonden. Gebruik een plaatsnaam of postcode.', 400);
  return { name: doc.weergavenaam, lat: Number(match[2]), lng: Number(match[1]) };
}

export function distanceKm(a, b) {
  const rad = n => n * Math.PI / 180;
  const x = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 6371.0088 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

export function boundingBox(center, radius) {
  const latitude = radius / 110.574;
  const longitude = radius / (111.320 * Math.cos(center.lat * Math.PI / 180));
  return { sw_lat: center.lat - latitude, ne_lat: center.lat + latitude, sw_lng: center.lng - longitude, ne_lng: center.lng + longitude };
}

export function safeSourceUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value, SOURCE);
    return url.origin === SOURCE && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

export function safeFundaUrl(value) {
  if (typeof value !== 'string' || !value) return null;
  try {
    const url = new URL(value);
    if (!['https://www.funda.nl', 'https://funda.nl'].includes(url.origin) || url.username || url.password ||
      !/^\/detail\/(koop|huur)\/[^/]+\/[^/]+\/\d+\/?$/.test(url.pathname)) return null;
    // Only carry real property detail links, without third-party query parameters.
    return `https://www.funda.nl${url.pathname.replace(/\/?$/, '/')}`;
  } catch { return null; }
}

export function parseCards(html) {
  const $ = load(html);
  const cards = $('.pc');
  const homes = [];
  cards.each((_, element) => {
    const card = $(element);
    const url = safeSourceUrl(card.find('a.pc-body').attr('href'));
    const address = card.find('.pc-adres').text().trim();
    const locality = card.find('.pc-plaats').text().trim();
    const price = Number(card.find('.pc-prijs').text().replace(/[^\d]/g, ''));
    const geo = card.find('[data-lat][data-lng]');
    const lat = Number(geo.attr('data-lat')), lng = Number(geo.attr('data-lng'));
    if (!url || !address || !locality || !price || !geo.length || lat < 50 || lat > 54 || lng < 3 || lng > 8) {
      throw new AppError('SOURCE_SCHEMA', 'De indeling van de woningbron is gewijzigd. De zoekopdracht is gestopt.');
    }
    const meta = card.find('.pc-meta').text().trim();
    homes.push({ id: hash(url), address, locality, price, url, lat, lng,
      image: safeSourceUrl(card.find('.pc-img').attr('src')),
      area: Number(meta.match(/(\d+)\s*m²/)?.[1]) || null,
      rooms: Number(meta.match(/(\d+)\s*kamer/)?.[1]) || null,
      agent: card.find('.pc-makelaar').text().trim(),
      discoveredAt: card.find('[data-dt]').attr('data-dt') || null,
      source: 'Buurtje.nl' });
  });
  return homes;
}

export function parseDetail(html) {
  const $ = load(html);
  let listing;
  $('script[type="application/ld+json"]').each((_, el) => {
    let d;
    try { d = JSON.parse($(el).text()); } catch { return; }
    if (d.address?.streetAddress && d.offers) listing = d;
  });
  if (!listing) throw new AppError('SOURCE_SCHEMA', 'Een woningpagina kon niet worden gecontroleerd.');
  const fundaUrls = [...new Set($('.ws-bronnen-list a.ws-bron-item[href]').map((_, el) => safeFundaUrl($(el).attr('href'))).get().filter(Boolean))];
  return { address: listing.address.streetAddress, price: Number(listing.offers.price),
    available: listing.offers.availability === 'https://schema.org/InStock',
    text: [listing.name, listing.description, $('.ws-beschrijving').text()].join(' '),
    publishedAt: listing.datePosted || null, fundaUrls };
}

export function keywordMatch(text, keywords) {
  // Commas separate phrases. Every phrase must occur; no unsupported semantic guessing.
  return keywords.split(',').map(x => normalize(x.trim())).filter(Boolean).every(word => normalize(text).includes(word));
}

export async function verifyHome(home, http = fetchUpstream) {
  const detail = parseDetail(await (await http(home.url)).text());
  return detail.available && detail.price === home.price && normalize(detail.address) === normalize(home.address) ? detail : null;
}

export async function searchHomes(raw, options = {}) {
  const filters = parseFilters(raw);
  const http = options.http || fetchUpstream;
  const center = options.center || await geocode(filters.location, http);
  const startPage = options.startPage || 1;
  if (!Number.isInteger(startPage) || startPage < 1 || startPage > 1000) throw new AppError('INVALID_PAGE', 'Ongeldige pagina.', 400);
  const maxPages = options.maxPages || 2;
  const homes = new Map();
  let page = startPage, pages = 1, total = 0, scanned = 0;
  for (; page <= pages && page < startPage + maxPages; page++) {
    const body = new URLSearchParams({ action: 'buurtje_filter_woningen', gwb: 'NL00', soort: filters.type,
      page: String(page), prijs_min: String(filters.minPrice), prijs_max: String(filters.maxPrice),
      'beschikbaar[]': 'beschikbaar', sorteer: 'nieuw', ...Object.fromEntries(Object.entries(boundingBox(center, filters.radius)).map(([k, v]) => [k, String(v)])) });
    const response = await http(`${SOURCE}/ajax/admin-ajax.php`, { method: 'POST', body });
    let data;
    try { data = await response.json(); } catch { throw new AppError('SOURCE_SCHEMA', 'De woningbron geeft geen geldig antwoord.'); }
    const payload = data.data;
    if (data.success !== true || typeof payload?.html !== 'string' || !Number.isInteger(payload.total) || !Number.isInteger(payload.total_pages) || payload.total_pages < 0) {
      throw new AppError('SOURCE_SCHEMA', 'De woningbron geeft een onherkenbaar antwoord.');
    }
    pages = payload.total_pages;
    total = payload.total;
    const cards = parseCards(payload.html);
    if (total > 0 && !cards.length && page <= pages) throw new AppError('SOURCE_SCHEMA', 'De bron meldt aanbod, maar levert geen leesbare woningen.');
    scanned += cards.length;
    // Four concurrent detail requests at most; every displayed result is verified.
    const candidates = cards.filter(home => home.price >= filters.minPrice && home.price <= filters.maxPrice && distanceKm(center, home) <= filters.radius);
    for (let offset = 0; offset < candidates.length; offset += 4) {
      const verified = await Promise.all(candidates.slice(offset, offset + 4).map(async home => {
        const detail = await verifyHome(home, http);
        if (!detail || !keywordMatch(detail.text, filters.keywords)) return null;
        const fundaUrl = detail.fundaUrls.find(url => new URL(url).pathname.startsWith(`/detail/${filters.type}/`)) || null;
        if (filters.portal === 'funda' && !fundaUrl) return null;
        return { ...home, distance: Math.round(distanceKm(center, home) * 10) / 10,
          publishedAt: detail.publishedAt, checkedAt: new Date().toISOString(), type: filters.type, fundaUrl };
      }));
      for (const home of verified.filter(Boolean)) homes.set(home.id, home);
    }
    if (!options.complete && homes.size >= 12) { page++; break; }
  }
  const nextPage = page <= pages ? page : null;
  if (options.complete && nextPage) throw new AppError('SEARCH_TOO_BROAD', 'Deze zoekopdracht heeft te veel aanbod voor een volledige controle. Verklein de straal of het prijsbereik.', 422);
  return { homes: [...homes.values()], center, filters, scanned, sourceTotal: total,
    nextPage, complete: !nextPage, checkedAt: new Date().toISOString(),
    source: 'Buurtje.nl', notice: `${filters.portal === 'funda' ? 'Alleen woningen met een Funda-link in de bron. ' : ''}Aanbod via Buurtje.nl; geen garantie op volledige marktdekking. Adres, prijs en beschikbaarheid zijn daar per resultaat gecontroleerd. Funda-links zijn overgenomen uit de bron; de Funda-pagina zelf is niet automatisch gecontroleerd. Dit is geen volledige Funda-feed.` };
}
