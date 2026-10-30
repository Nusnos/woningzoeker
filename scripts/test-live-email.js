// Authorized operator smoke test: sends only to the explicitly supplied address.
// Requires production envs and a deployment that passed verify-deployment.js.
import { readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { BlobStore, mutate } from '../lib/store.js';
import { makeToken } from '../lib/security.js';

const base = new URL(process.argv[2]).origin;
const email = process.argv[3];
if (!email || !email.includes('@')) throw Error('Provide the authorized test recipient');
const { secret } = JSON.parse(await readFile('.vercel/automation-bypass.json', 'utf8'));
const store = new BlobStore();
const results = [];
async function request(path, body) {
  const response = await fetch(base + path, { method: 'POST', headers: { 'x-vercel-protection-bypass': secret, 'content-type': 'application/json', authorization: `Bearer ${process.env.CRON_SECRET}` }, body: JSON.stringify(body), signal: AbortSignal.timeout(270000) });
  const data = await response.json();
  assert(response.ok, `${path}: HTTP ${response.status}, ${data.code || 'unknown'}`); return data;
}
const before = new Set(Object.keys((await store.read()).state.subscribers));
await request('/api/subscribe', { email, consent: true, filters: { location: '5213 CZ', radius: 1, minPrice: 269500, maxPrice: 269500, type: 'koop', keywords: '' } });
const sub = Object.values((await store.read()).state.subscribers).find(s => s.email === email.toLowerCase() && !before.has(s.id));
assert(sub && !sub.confirmedAt, 'Test requires a newly created, unconfirmed subscription');
results.push({ test: 'confirmation email submitted to SMTP', passed: true });
try {
  await request('/api/confirm', { token: makeToken(sub.id, 'confirm') });
  const confirmed = (await store.read()).state.subscribers[sub.id];
  assert(confirmed.confirmedAt && confirmed.seen.length > 0);
  results.push({ test: 'confirmation with a complete real-inventory baseline', passed: true, baselineCount: confirmed.seen.length });
  await mutate(store, state => {
    // Remove just one real home from this temporary test baseline to exercise
    // the new-match path, visibly labelled TEST in the delivered message.
    state.subscribers[sub.id].testOnly = true;
    state.subscribers[sub.id].seen = confirmed.seen.slice(1);
  });
  // Send through the deployed SMTP credentials, using the ordinary cron path.
  // The endpoint uses today's real date; clear today's no-subscriber smoke run
  // only if it has never delivered anything, then test using normal invocation.
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Amsterdam', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  await mutate(store, state => {
    if (Object.values(state.subscribers).some(s => s.confirmedAt && s.id !== sub.id)) throw Error('Real subscriptions are active; do not run the test cron against them');
    if (state.runs[day]?.sent) throw Error('Daily run already delivered messages; do not replay it');
    delete state.runs[day];
  });
  const daily = await request('/api/cron/daily', { force: true });
  assert.equal(daily.sent, 1);
  results.push({ test: 'one TEST-labelled real-home alert accepted by SMTP', passed: true });
  const again = await request('/api/cron/daily', { force: true });
  assert.equal(again.skipped, 'done');
  results.push({ test: 'duplicate daily invocation does not resend', passed: true });
} finally {
  await request('/api/unsubscribe', { token: makeToken(sub.id, 'unsubscribe') });
  assert(!(await store.read()).state.subscribers[sub.id]);
  results.push({ test: 'unsubscribe removes test email and search', passed: true });
}
const report = { at: new Date().toISOString(), deployment: base, results,
  deliveryLimit: 'SMTP acceptance verified; recipient inbox placement is not independently verified.' };
await writeFile('docs/live-email-verification.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
