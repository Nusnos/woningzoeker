import { randomUUID } from 'node:crypto';
import { parseFilters, hash, searchHomes } from './source.js';
import { makeToken, readToken } from './security.js';
import { mutate } from './store.js';
import { sendMail } from './mail.js';
import { AppError, logError } from './errors.js';

export function baseUrl() {
  const url = new URL(process.env.APP_URL || 'http://localhost:3000');
  if (process.env.VERCEL && url.protocol !== 'https:') throw new AppError('CONFIG_MISSING', 'Het websiteadres is niet ingesteld.', 503);
  return url.origin;
}

export function localDay(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Amsterdam', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

export function scheduledTime(date = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Amsterdam', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date).map(x => [x.type, x.value]));
  // Permit delayed scheduler invocations after 13:00, never start early.
  return Number(parts.hour) >= 13;
}

const mailLink = (id, purpose) => `${baseUrl()}/${purpose === 'confirm' ? 'confirm' : 'unsubscribe'}#${makeToken(id, purpose)}`;
const emailPattern = /^[^\s@<>]{1,64}@[^\s@<>.]+(?:\.[^\s@<>.]+)+$/;

export async function subscribe(store, input, ip, send = sendMail, now = Date.now()) {
  const email = String(input.email || '').trim().toLowerCase();
  if (!emailPattern.test(email) || email.length > 254 || input.consent !== true) throw new AppError('INVALID_EMAIL', 'Vul een geldig e-mailadres in en geef toestemming voor meldingen.', 400);
  const filters = parseFilters(input.filters);
  const key = hash(`${email}\n${JSON.stringify(filters)}`);
  const candidateId = randomUUID();
  const entry = await mutate(store, state => {
    for (const [id, sub] of Object.entries(state.subscribers)) {
      if (!sub.confirmedAt && now - sub.createdAt > 48 * 3600000) delete state.subscribers[id];
    }
    for (const [k, bucket] of Object.entries(state.rate)) if (bucket.until <= now) delete state.rate[k];
    const rateKey = hash(`${process.env.APP_SECRET}:${ip}`);
    const bucket = state.rate[rateKey] || { count: 0, until: now + 3600000 };
    if (bucket.count >= 10) throw new AppError('RATE_LIMIT', 'Te veel aanvragen. Probeer het over een uur opnieuw.', 429);
    bucket.count++; state.rate[rateKey] = bucket;
    const existing = Object.values(state.subscribers).find(s => s.key === key);
    if (existing?.confirmedAt || (existing && now - existing.confirmRequestedAt < 3600000)) return null;
    if (Object.keys(state.subscribers).length >= 500) throw new AppError('CAPACITY', 'Er is tijdelijk geen ruimte voor nieuwe meldingen.', 503);
    const sub = existing || { id: candidateId, key, email, filters, createdAt: now, seen: [], confirmedAt: null, consentVersion: '2026-10-30' };
    sub.confirmRequestedAt = now;
    state.subscribers[sub.id] = sub;
    return structuredClone(sub);
  });
  if (entry) {
    try {
      await send({ to: email, subject: 'Bevestig je zoekopdracht · Woningzoeker',
        text: `Je wilt ${filters.type === 'koop' ? 'koopwoningen' : 'huurwoningen'} volgen rond ${filters.location} (${filters.radius} km), van €${filters.minPrice} tot €${filters.maxPrice}.\nZoekwoorden: ${filters.keywords || 'geen'}.\n\nBevestig binnen 48 uur:\n${mailLink(entry.id, 'confirm')}\n\nJe ontvangt alleen nieuwe matches na bevestiging, dagelijks vanaf 13.00 uur Nederlandse tijd. Iedere melding bevat een afmeldlink.\nNiet aangevraagd? Negeer deze e-mail; zonder bevestiging ontvang je geen woningmeldingen.\nJe kunt deze aanvraag verwijderen via:\n${mailLink(entry.id, 'unsubscribe')}` });
    } catch (error) {
      await mutate(store, state => { if (state.subscribers[entry.id]) state.subscribers[entry.id].confirmRequestedAt = 0; });
      throw error;
    }
  }
  return { message: 'Controleer je inbox. Als deze zoekopdracht nog niet bevestigd is, ontvang je een bevestigingslink. Kijk ook bij ongewenste e-mail.' };
}

export async function confirm(store, token, search = searchHomes) {
  const id = readToken(token, 'confirm');
  const { state } = await store.read();
  const sub = state.subscribers[id];
  if (!sub) throw new AppError('INVALID_TOKEN', 'Deze zoekopdracht is verlopen of afgemeld.', 400);
  if (sub.confirmedAt) return { message: 'Je zoekopdracht is al bevestigd.' };
  // A complete baseline prevents the existing inventory from being mailed as new.
  const result = await search(sub.filters, { complete: true, maxPages: 20 });
  if (!result.complete) throw new AppError('SEARCH_INCOMPLETE', 'De volledige zoekopdracht kon niet worden gecontroleerd. Probeer een kleiner zoekgebied.', 503);
  await mutate(store, current => {
    const s = current.subscribers[id];
    if (!s) throw new AppError('INVALID_TOKEN', 'Deze zoekopdracht is afgemeld.', 400);
    if (!s.confirmedAt) { s.seen = result.homes.map(h => h.id); s.confirmedAt = Date.now(); s.lastCheck = new Date().toISOString(); }
  });
  return { message: 'Je e-mailadres is bevestigd. Je ontvangt dagelijks vanaf 13.00 uur een e-mail wanneer er nieuwe passende woningen zijn.' };
}

export async function unsubscribe(store, token) {
  const id = readToken(token, 'unsubscribe');
  await mutate(store, state => { delete state.subscribers[id]; });
  return { message: 'Je bent afgemeld. Je e-mailadres en deze zoekopdracht zijn verwijderd.' };
}

export async function runDaily(store, { search = searchHomes, send = sendMail, now = new Date(), force = false } = {}) {
  if (!force && !scheduledTime(now)) return { skipped: 'before_13_amsterdam' };
  const day = localDay(now), owner = randomUUID(), timestamp = now.getTime();
  const lock = await mutate(store, state => {
    if (state.runs[day]?.done) return 'done';
    if (state.runs[day]?.leaseUntil > timestamp) return 'busy';
    state.runs[day] = { owner, leaseUntil: timestamp + 290000, startedAt: now.toISOString(), done: false };
    for (const key of Object.keys(state.runs)) if (key < localDay(new Date(timestamp - 30 * 86400000))) delete state.runs[key];
    return 'acquired';
  });
  if (lock !== 'acquired') return { skipped: lock };
  let checked = 0, sent = 0, failed = 0;
  const deadline = Date.now() + 230000;
  try {
    const { state } = await store.read();
    const subscribers = Object.values(state.subscribers).filter(s => s.confirmedAt);
    const searchCache = new Map();
    for (const sub of subscribers) {
      if (Date.now() > deadline) throw new AppError('CRON_CAPACITY', 'De dagelijkse controle heeft de verwerkingstijd overschreden.');
      try {
        const cacheKey = JSON.stringify(sub.filters);
        if (!searchCache.has(cacheKey)) searchCache.set(cacheKey, await search(sub.filters, { complete: true, maxPages: 20 }));
        const result = searchCache.get(cacheKey);
        if (!result.complete) throw new AppError('SEARCH_INCOMPLETE', 'Een onvolledige zoekopdracht kan niet voor meldingen worden gebruikt.');
        const newHomes = result.homes.filter(h => !sub.seen.includes(h.id));
        const deliveryId = hash(`${sub.id}:${newHomes.map(h => h.id).sort().join(',')}`);
        const claim = await mutate(store, current => {
          const s = current.subscribers[sub.id];
          if (!s?.confirmedAt || current.runs[day]?.owner !== owner) return false;
          if (s.delivery?.status === 'sending' || s.delivery?.status === 'uncertain') throw new AppError('MAIL_UNCERTAIN', 'Een eerdere verzending vereist controle in de foutregistratie.');
          s.lastCheck = new Date().toISOString();
          if (!newHomes.length) return false;
          s.delivery = { id: deliveryId, day, status: 'sending', startedAt: Date.now() };
          return true;
        });
        checked++;
        if (!claim) continue;
        const unsubscribeToken = makeToken(sub.id, 'unsubscribe');
        const unsubscribeUrl = `${baseUrl()}/unsubscribe#${unsubscribeToken}`;
        // Recheck after claiming; an unsubscribe always wins before SMTP submission.
        if (!(await store.read()).state.subscribers[sub.id]) continue;
        try {
          await send({ to: sub.email, subject: `${sub.testOnly ? '[TEST] ' : ''}${newHomes.length} nieuwe ${sub.filters.type === 'koop' ? 'koopwoningen' : 'huurwoningen'} rond ${sub.filters.location}`,
            messageId: `<${deliveryId}@${new URL(baseUrl()).hostname}>`,
            headers: { 'List-Unsubscribe': `<${baseUrl()}/api/unsubscribe?token=${unsubscribeToken}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
            text: `${sub.testOnly ? 'Dit is de afgesproken mailtest met een echt gecontroleerde woning. Voor deze test simuleren we de detectie; dit is geen claim dat de advertentie net is verschenen.\n\n' : ''}Nieuwe woningen voor je bevestigde zoekopdracht:\n\n${newHomes.map(h => `${h.address}\n${h.locality}\n€${h.price.toLocaleString('nl-NL')}${h.type === 'huur' ? ' per maand' : ' k.k.'}\n${h.url}`).join('\n\n')}\n\nBron: Buurtje.nl. Beschikbaarheid en prijs zijn gecontroleerd; het aanbod kan daarna veranderen.\n\nAfmelden en je gegevens verwijderen:\n${unsubscribeUrl}` });
        } catch (error) {
          await mutate(store, current => { const s = current.subscribers[sub.id]; if (s?.delivery?.id === deliveryId) s.delivery.status = 'uncertain'; });
          throw error;
        }
        await mutate(store, current => {
          const s = current.subscribers[sub.id];
          if (s?.delivery?.id === deliveryId) {
            s.delivery.status = 'sent'; s.delivery.sentAt = Date.now();
            s.seen = [...new Set([...s.seen, ...newHomes.map(h => h.id)])];
          }
        });
        sent++;
      } catch (error) { failed++; logError(error, 'daily_subscriber'); }
    }
    await mutate(store, current => {
      if (current.runs[day]?.owner === owner) current.runs[day] = { ...current.runs[day], done: failed === 0, leaseUntil: 0, checked, sent, failed, finishedAt: new Date().toISOString() };
      current.health.lastDaily = { day, checked, sent, failed, at: new Date().toISOString() };
    });
    if (failed) throw new AppError('DAILY_INCOMPLETE', `${failed} zoekopdrachten konden niet worden verwerkt. Controleer de foutregistratie.`, 503);
    return { day, checked, sent, failed };
  } catch (error) {
    await mutate(store, current => { if (current.runs[day]?.owner === owner) current.runs[day].leaseUntil = 0; });
    throw error;
  }
}
