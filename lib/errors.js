import { randomUUID } from 'node:crypto';

export class AppError extends Error {
  constructor(code, message, status = 502) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

// Deliberately omit URLs, query strings, mail addresses, tokens and error messages.
export function logError(error, operation, requestId = randomUUID()) {
  console.error(JSON.stringify({ level: 'error', at: new Date().toISOString(), requestId,
    operation, code: error.code || 'UNEXPECTED', type: error.constructor.name,
    upstreamStatus: error.upstreamStatus || undefined }));
  return requestId;
}
