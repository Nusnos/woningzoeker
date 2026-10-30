import { get, put, BlobPreconditionFailedError } from '@vercel/blob';
import { encrypt, decrypt } from './security.js';
import { AppError } from './errors.js';

export const initialState = () => ({ subscribers: {}, rate: {}, runs: {}, health: {} });

export class BlobStore {
  constructor() {
    this.path = `woningzoeker-v2/${process.env.VERCEL_ENV || 'development'}/state.bin`;
    this.access = 'private';
  }
  async read() {
    if (!process.env.BLOB_READ_WRITE_TOKEN) throw new AppError('CONFIG_MISSING', 'De opslag voor meldingen is nog niet geconfigureerd.', 503);
    // Brotli/gzip turns the response ETag into a weak validator (W/...), which
    // Blob correctly rejects for If-Match. Read the original representation.
    const result = await get(this.path, { access: this.access, useCache: false,
      headers: { 'Accept-Encoding': 'identity' }, abortSignal: AbortSignal.timeout(15000) });
    if (!result) return { state: initialState(), version: null };
    const bytes = Buffer.from(await new Response(result.stream).arrayBuffer());
    if (!result.blob.etag || result.blob.etag.startsWith('W/')) throw new AppError('STORAGE_VERSION', 'De opslag gaf geen bruikbare schrijfversie terug.', 503);
    return { state: decrypt(bytes), version: result.blob.etag };
  }
  async write(state, version) {
    try {
      await put(this.path, encrypt(state), { access: this.access, addRandomSuffix: false,
        contentType: 'application/octet-stream', cacheControlMaxAge: 60,
        ...(version ? { allowOverwrite: true, ifMatch: version } : { allowOverwrite: false }) });
      return true;
    } catch (error) {
      if (error instanceof BlobPreconditionFailedError) return false;
      throw error;
    }
  }
}

// Mutators must be synchronous and have no external side effects: CAS may retry them.
export async function mutate(store, change) {
  for (let attempt = 0; attempt < 10; attempt++) {
    const { state, version } = await store.read();
    const result = change(state);
    if (await store.write(state, version)) return result;
  }
  throw new AppError('STORAGE_BUSY', 'De opslag is druk. Probeer het opnieuw.', 503);
}

export class MemoryStore {
  constructor() { this.state = initialState(); this.version = 0; }
  async read() { return { state: structuredClone(this.state), version: this.version }; }
  async write(state, version) {
    if (version !== this.version) return false;
    this.state = structuredClone(state); this.version++; return true;
  }
}
