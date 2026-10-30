// Shared by the browser and regression tests: empty intermediate pages must not
// stop a search, and a repeated/backwards cursor must never loop indefinitely.
export async function* searchPages(request, { startPage = 1, maxRequests = 20, signal } = {}) {
  let page = startPage;
  for (let attempt = 0; attempt < maxRequests; attempt++) {
    signal?.throwIfAborted();
    const result = await request(page, signal);
    const next = result.nextPage;
    if (!Array.isArray(result.homes) || (next !== null && (!Number.isInteger(next) || next <= page))) throw Error('De bron gaf een ongeldige vervolgpagina terug. De zoekopdracht is nog niet volledig.');
    yield result;
    if (next === null) return;
    page = next;
  }
}
