import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { MemoryStore, mutate } from '../lib/store.js';
import { encrypt, decrypt, makeToken, readToken, authorized } from '../lib/security.js';
import { subscribe, confirm, unsubscribe, runDaily, localDay, scheduledTime } from '../lib/alerts.js';

beforeEach(() => { process.env.APP_SECRET = randomBytes(32).toString('base64url'); process.env.APP_URL = 'https://woningzoeker-one.vercel.app'; });
const input = () => ({ email: 'fixture@example.org', consent: true, filters: { location: 'Den Bosch', radius: 5, maxPrice: 500000 } });
const home = { id: 'actual-fixture-lagelandstraat', address: 'Lagelandstraat 156', locality: "5213 CZ 's-Hertogenbosch", price: 269500, type: 'koop', url: 'https://buurtje.nl/appartement/lagelandstraat-156-s-hertogenbosch/' };
const result = { homes: [home], complete: true, nextPage: null };
const date = new Date('2026-10-30T12:00:00Z');
async function active(store) {
  await subscribe(store, input(), 'fixture-ip', async () => {});
  const id = Object.keys(store.state.subscribers)[0];
  await confirm(store, makeToken(id, 'confirm'), async () => ({ homes: [], complete: true }));
  return id;
}
test('encrypted subscriber data round-trips and tampering fails authentication', () => {
  const plain = { email: 'fixture@example.org' }, cipher = encrypt(plain);
  assert(!cipher.includes(Buffer.from(plain.email))); assert.deepEqual(decrypt(cipher), plain);
  cipher[30] ^= 1; assert.throws(() => decrypt(cipher));
});
test('confirmation tokens reject tampering, wrong purpose and expiry', () => {
  const issued = Date.now(), token = makeToken('fixture-id', 'confirm', issued);
  assert.equal(readToken(token, 'confirm', issued), 'fixture-id');
  assert.throws(() => readToken(token, 'unsubscribe', issued), { code: 'INVALID_TOKEN' });
  assert.throws(() => readToken(token + 'x', 'confirm', issued), { code: 'INVALID_TOKEN' });
  assert.throws(() => readToken(token, 'confirm', issued + 49 * 3600000), { code: 'INVALID_TOKEN' });
  assert.equal(readToken(makeToken('fixture-id', 'unsubscribe', issued), 'unsubscribe', issued + 366 * 86400000), 'fixture-id');
});
test('cron authorization fails closed when the secret is absent', () => {
  assert(!authorized('Bearer undefined', '')); assert(!authorized('Bearer bad', 'correct'));
  assert(authorized('Bearer correct', 'correct'));
});
test('optimistic concurrency preserves simultaneous state updates', async () => {
  const store = new MemoryStore();
  await Promise.all(Array.from({ length: 8 }, (_, i) => mutate(store, state => { state.subscribers[i] = { id: i }; })));
  assert.equal(Object.keys(store.state.subscribers).length, 8);
});
test('subscribe requires consent and limits requests without sending repeats', async () => {
  const store = new MemoryStore(), sent = [];
  await assert.rejects(subscribe(store, { ...input(), consent: false }, 'fixture-ip', async () => {}), { code: 'INVALID_EMAIL' });
  for (let i = 0; i < 10; i++) await subscribe(store, input(), 'fixture-ip', async mail => sent.push(mail));
  assert.equal(sent.length, 1); assert(sent[0].text.includes('/confirm#')); assert(sent[0].text.includes('/unsubscribe#'));
  await assert.rejects(subscribe(store, input(), 'fixture-ip', async () => {}), { code: 'RATE_LIMIT' });
});
test('unconfirmed users never receive property alerts', async () => {
  const store = new MemoryStore(); let sent = 0;
  await subscribe(store, input(), 'fixture-ip', async () => {});
  const r = await runDaily(store, { now: date, search: async () => result, send: async () => sent++ });
  assert.equal(r.checked, 0); assert.equal(sent, 0);
});
test('confirmation baselines current homes; repeated confirmation is idempotent', async () => {
  const store = new MemoryStore(); await subscribe(store, input(), 'fixture-ip', async () => {});
  const id = Object.keys(store.state.subscribers)[0], token = makeToken(id, 'confirm');
  await confirm(store, token, async () => result);
  assert.deepEqual(store.state.subscribers[id].seen, [home.id]);
  await confirm(store, token, async () => { throw Error('should not search again'); });
  let count = 0; await runDaily(store, { now: date, search: async () => result, send: async () => count++ });
  assert.equal(count, 0);
});
test('source failure cannot confirm a subscription', async () => {
  const store = new MemoryStore(); await subscribe(store, input(), 'fixture-ip', async () => {});
  const id = Object.keys(store.state.subscribers)[0];
  await assert.rejects(confirm(store, makeToken(id, 'confirm'), async () => { throw Error('source blocked'); }));
  assert.equal(store.state.subscribers[id].confirmedAt, null);
});
test('partial inventory is refused for confirmations and property alerts', async () => {
  const store = new MemoryStore(); await subscribe(store, input(), 'fixture-ip', async () => {});
  const id = Object.keys(store.state.subscribers)[0];
  await assert.rejects(confirm(store, makeToken(id, 'confirm'), async () => ({ ...result, complete: false })), { code: 'SEARCH_INCOMPLETE' });
  assert.equal(store.state.subscribers[id].confirmedAt, null);
});
test('operator mail tests are visibly labelled and do not claim a newly posted listing', async () => {
  const store = new MemoryStore(); const id = await active(store); store.state.subscribers[id].testOnly = true;
  const messages = [];
  await runDaily(store, { now: date, search: async () => result, send: async mail => messages.push(mail) });
  assert(messages[0].subject.startsWith('[TEST]')); assert(messages[0].text.includes('geen claim dat de advertentie net is verschenen'));
});
test('a new match is mailed once, also on overlapping cron invocations and tomorrow', async () => {
  const store = new MemoryStore(); await active(store); const sent = [];
  const options = { now: date, search: async () => result, send: async mail => sent.push(mail) };
  await Promise.all([runDaily(store, options), runDaily(store, options)]);
  assert.equal(sent.length, 1); assert(sent[0].text.includes(home.url)); assert(sent[0].headers['List-Unsubscribe-Post']);
  await runDaily(store, { ...options, now: new Date('2026-10-31T12:00:00Z') });
  assert.equal(sent.length, 1);
});
test('search failure retains the baseline and leaves the day retryable', async () => {
  const store = new MemoryStore(); const id = await active(store);
  await assert.rejects(runDaily(store, { now: date, search: async () => { throw Error('blocked'); } }), { code: 'DAILY_INCOMPLETE' });
  assert.deepEqual(store.state.subscribers[id].seen, []); assert.equal(store.state.runs['2026-10-30'].done, false);
});
test('ambiguous SMTP failures do not mark homes as seen or resend automatically', async () => {
  const store = new MemoryStore(); const id = await active(store); let attempts = 0;
  const options = { now: date, search: async () => result, send: async () => { attempts++; throw Error('smtp connection lost'); } };
  await assert.rejects(runDaily(store, options), { code: 'DAILY_INCOMPLETE' });
  assert.deepEqual(store.state.subscribers[id].seen, []); assert.equal(store.state.subscribers[id].delivery.status, 'uncertain');
  await assert.rejects(runDaily(store, options)); assert.equal(attempts, 1);
});
test('unsubscribe removes personal data, is idempotent and stops delivery', async () => {
  const store = new MemoryStore(); const id = await active(store); const token = makeToken(id, 'unsubscribe');
  await unsubscribe(store, token); await unsubscribe(store, token);
  assert(!store.state.subscribers[id]); let sent = 0;
  await runDaily(store, { now: date, search: async () => result, send: async () => sent++ }); assert.equal(sent, 0);
});
test('Amsterdam scheduling follows summer, winter and both DST transitions', () => {
  for (const iso of ['2026-07-01T11:00:00Z', '2026-12-01T12:00:00Z', '2026-03-29T11:00:00Z', '2026-10-25T12:00:00Z']) assert(scheduledTime(new Date(iso)), iso);
  for (const iso of ['2026-07-01T10:59:00Z', '2026-12-01T11:59:00Z']) assert(!scheduledTime(new Date(iso)), iso);
  assert.equal(localDay(new Date('2026-07-01T22:30:00Z')), '2026-07-02');
});
