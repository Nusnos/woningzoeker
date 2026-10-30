import { createCipheriv, createDecipheriv, randomBytes, createHmac, timingSafeEqual } from 'node:crypto';
import { AppError } from './errors.js';

function secret() {
  const value = process.env.APP_SECRET;
  if (!value || Buffer.from(value, 'base64url').length !== 32) throw new AppError('CONFIG_MISSING', 'Meldingen zijn nog niet geconfigureerd.', 503);
  return Buffer.from(value, 'base64url');
}

export function encrypt(value) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', secret(), iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]);
}

export function decrypt(value) {
  const decipher = createDecipheriv('aes-256-gcm', secret(), value.subarray(0, 12));
  decipher.setAuthTag(value.subarray(12, 28));
  return JSON.parse(Buffer.concat([decipher.update(value.subarray(28)), decipher.final()]).toString());
}

export function makeToken(id, purpose, now = Date.now()) {
  const body = Buffer.from(JSON.stringify({ id, purpose, issued: now })).toString('base64url');
  return `${body}.${createHmac('sha256', secret()).update(body).digest('base64url')}`;
}

export function readToken(token, purpose, now = Date.now()) {
  if (typeof token !== 'string' || token.length > 1000) throw new AppError('INVALID_TOKEN', 'Deze link is ongeldig.', 400);
  const [body, sig, extra] = token.split('.');
  const expected = createHmac('sha256', secret()).update(body || '').digest();
  const actual = Buffer.from(sig || '', 'base64url');
  if (extra || actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new AppError('INVALID_TOKEN', 'Deze link is ongeldig.', 400);
  let data;
  try { data = JSON.parse(Buffer.from(body, 'base64url')); } catch { throw new AppError('INVALID_TOKEN', 'Deze link is ongeldig.', 400); }
  if (data.purpose !== purpose || typeof data.id !== 'string' || !Number.isFinite(data.issued) || data.issued > now || (purpose === 'confirm' && now - data.issued > 48 * 3600000)) {
    throw new AppError('INVALID_TOKEN', 'Deze link is ongeldig of verlopen. Vraag een nieuwe bevestiging aan.', 400);
  }
  return data.id;
}

export function authorized(header, value = process.env.CRON_SECRET) {
  if (!value || typeof header !== 'string') return false;
  const a = Buffer.from(header), b = Buffer.from(`Bearer ${value}`);
  return a.length === b.length && timingSafeEqual(a, b);
}
