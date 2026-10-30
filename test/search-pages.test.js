import { test } from 'node:test';
import assert from 'node:assert/strict';
import { searchPages } from '../public/search-pages.js';

test('browser follows all source cursors, including empty intermediate pages', async () => {
  const calls = [], ids = new Set();
  const request = async page => {
    calls.push(page);
    return { homes: page === 2 ? [] : [{ id: String(page) }], nextPage: page === 3 ? null : page + 1 };
  };
  for await (const result of searchPages(request)) for (const h of result.homes) ids.add(h.id);
  assert.deepEqual(calls, [1, 2, 3]); assert.deepEqual([...ids], ['1', '3']);
});
test('a bounded batch leaves its actual continuation available', async () => {
  const pages = [];
  for await (const result of searchPages(async page => ({ homes: [], nextPage: page + 1 }), { maxRequests: 2 })) pages.push(result.nextPage);
  assert.deepEqual(pages, [2, 3]);
});
test('repeated cursors fail instead of looping or claiming completion', async () => {
  await assert.rejects(async () => { for await (const _ of searchPages(async page => ({ homes: [], nextPage: page }))) {} });
});
test('a replaced search is aborted before it can load additional pages', async () => {
  const controller = new AbortController(); let calls = 0;
  await assert.rejects(async () => {
    for await (const _ of searchPages(async () => { calls++; return { homes: [], nextPage: 2 }; }, { signal: controller.signal })) controller.abort();
  }, { name: 'AbortError' });
  assert.equal(calls, 1);
});
