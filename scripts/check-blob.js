import { put, get, del, BlobPreconditionFailedError } from '@vercel/blob';
import { randomUUID, randomBytes } from 'node:crypto';
const path = `woningzoeker-v2/probe/${randomUUID()}.bin`;
try {
  const first = await put(path, 'storage-test-only', { access: 'private', addRandomSuffix: false });
  const payload = randomBytes(4096);
  const second = await put(path, payload, { access: 'private', contentType: 'application/octet-stream', addRandomSuffix: false, allowOverwrite: true, ifMatch: first.etag });
  const read = await get(path, { access: 'private', useCache: false, headers: { 'Accept-Encoding': 'identity' } });
  if (!Buffer.from(await new Response(read.stream).arrayBuffer()).equals(payload) || read.blob.etag !== second.etag) throw Error('Stale read or weak ETag');
  let conflict = false;
  try { await put(path, 'stale', { access: 'private', addRandomSuffix: false, allowOverwrite: true, ifMatch: first.etag }); }
  catch (e) { if (e instanceof BlobPreconditionFailedError) conflict = true; else throw e; }
  if (!conflict) throw Error('Conditional write did not reject stale version');
  console.log('PASS private storage, fresh reads, conditional update and conflict rejection');
} catch (e) { console.error(e.constructor.name, e.message.replace(/vercel_blob_rw_\S+/g, '[redacted]')); process.exitCode = 1; }
finally { await del(path).catch(() => {}); }
