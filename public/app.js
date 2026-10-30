const $ = id => document.getElementById(id);
const form = $('search-form');
let activeFilters, shown = new Map(), nextPage = null, busy = false, pendingFilters;
const money = value => new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(value);

async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { 'Content-Type': 'application/json', ...options.headers }, signal: AbortSignal.timeout(240000) });
  let data;
  try { data = await response.json(); } catch { throw Error('De server is tijdelijk niet bereikbaar. Probeer het opnieuw.'); }
  if (!response.ok) throw Error(`${data.error || 'Er ging iets mis.'}${data.requestId ? ` Referentie: ${data.requestId}` : ''}`);
  return data;
}
function element(tag, className, text) {
  const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node;
}
function render() {
  const homes = [...shown.values()];
  const order = $('sort').value;
  if (order === 'low') homes.sort((a,b) => a.price - b.price);
  if (order === 'high') homes.sort((a,b) => b.price - a.price);
  if (order === 'distance') homes.sort((a,b) => a.distance - b.distance);
  $('homes').replaceChildren(...homes.map(home => {
    const card = element('article', 'home-card');
    const photo = element('a', 'home-photo'); photo.href = home.fundaUrl || home.url; photo.target = '_blank'; photo.rel = 'noopener noreferrer'; photo.setAttribute('aria-label', `Bekijk ${home.address} bij ${home.fundaUrl ? 'Funda' : 'Buurtje.nl'}`);
    if (home.image) { const image = element('img'); image.src = home.image; image.alt = `Woning aan ${home.address}`; image.loading = 'lazy'; image.addEventListener('error', () => image.remove(), { once: true }); photo.append(image); }
    photo.append(element('span', 'home-badge', home.type === 'huur' ? 'Te huur' : 'Te koop'));
    const content = element('div', 'home-content'); const heading = element('h3'); const link = element('a', '', home.address); link.href = home.fundaUrl || home.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; heading.append(link);
    const price = element('p', 'home-price', money(home.price)); price.append(element('span', 'price-suffix', home.type === 'huur' ? 'per maand' : 'vraagprijs'));
    const meta = element('div', 'home-meta');
    if (home.area) meta.append(element('span', '', `${home.area} m²`));
    if (home.rooms) meta.append(element('span', '', `${home.rooms} kamers`));
    meta.append(element('span', '', `${home.distance.toLocaleString('nl-NL')} km`));
    const bottom = element('div', 'home-bottom'); bottom.append(element('span', '', '✓ Gecontroleerd · Buurtje.nl'));
    const links = element('div', 'home-links');
    if (home.fundaUrl) { const funda = element('a', 'funda-link', 'Bekijk op Funda ↗'); funda.href = home.fundaUrl; funda.target = '_blank'; funda.rel = 'noopener noreferrer'; links.append(funda); }
    const arrow = element('a', '', home.fundaUrl ? 'Buurtje.nl ↗' : 'Bekijk ↗'); arrow.href = home.url; arrow.target = '_blank'; arrow.rel = 'noopener noreferrer'; links.append(arrow); bottom.append(links);
    content.append(heading, element('p', 'home-locality', home.locality), price, meta, bottom); card.append(photo, content); return card;
  }));
  $('empty').hidden = homes.length > 0 || busy;
  $('more').hidden = !nextPage || busy;
  $('result-count').textContent = `${homes.length} gecontroleerde ${homes.length === 1 ? 'woning' : 'woningen'}${nextPage ? ' · er is meer aanbod om te controleren' : ' · zoekopdracht volledig doorzocht'}`;
}
async function search(append = false) {
  if (busy) return;
  if (!append && !form.reportValidity()) return;
  const proposed = append ? activeFilters : Object.fromEntries(new FormData(form));
  if (+proposed.minPrice > +proposed.maxPrice) { $('error').textContent = 'De minimumprijs mag niet hoger zijn dan de maximumprijs.'; $('error').hidden = false; return; }
  busy = true; $('search-button').disabled = true; $('loading').hidden = false; $('error').hidden = true; $('more').hidden = true; $('empty').hidden = true;
  if (!append) { shown.clear(); $('homes').replaceChildren(); $('source-info').hidden = true; $('result-count').textContent = 'Actueel aanbod ophalen en controleren…'; }
  try {
    const query = new URLSearchParams(proposed); if (append) query.set('page', nextPage);
    const result = await api(`/api/search?${query}`);
    activeFilters = result.filters; nextPage = result.nextPage;
    for (const home of result.homes) shown.set(home.id, home);
    $('result-label').textContent = `${activeFilters.type === 'huur' ? 'HUREN' : 'KOPEN'} · ${activeFilters.location.toUpperCase()} · ${activeFilters.radius} KM${activeFilters.portal === 'funda' ? ' · MET FUNDA-LINK' : ''}`;
    $('result-title').textContent = `Jouw volgende plek`;
    $('source-info').textContent = `${result.notice} Laatst gecontroleerd: ${new Date(result.checkedAt).toLocaleString('nl-NL', { timeZone: 'Europe/Amsterdam', dateStyle: 'short', timeStyle: 'short' })}. Zoekpunt: ${result.center.name}. Afstanden zijn hemelsbreed. Gebruik ‘Meer woningen controleren’ om verder te zoeken.`;
    $('source-info').hidden = false;
  } catch (error) {
    $('error').textContent = error.name === 'TimeoutError' ? 'De controle duurt te lang. Verklein de zoekstraal en probeer opnieuw.' : error.message;
    $('error').hidden = false;
    if (!append) { activeFilters = null; nextPage = null; $('result-count').textContent = 'De zoekopdracht is niet voltooid.'; }
  } finally { busy = false; $('search-button').disabled = false; $('loading').hidden = true; if (activeFilters) render(); }
}

function openSave() {
  pendingFilters = Object.fromEntries(new FormData(form));
  if (!form.reportValidity() || +pendingFilters.minPrice > +pendingFilters.maxPrice) return;
  $('alert-summary').textContent = `${pendingFilters.type === 'huur' ? 'Huurwoningen' : 'Koopwoningen'} · ${pendingFilters.location} + ${pendingFilters.radius} km · ${money(+pendingFilters.minPrice)} t/m ${money(+pendingFilters.maxPrice)}${pendingFilters.type === 'huur' ? ' per maand' : ''}${pendingFilters.keywords ? ` · ${pendingFilters.keywords}` : ''}${pendingFilters.portal === 'funda' ? ' · Alleen met Funda-link (via Buurtje.nl)' : ''}`;
  $('alert-status').textContent = ''; $('alert-submit').disabled = false; $('save-dialog').showModal();
}
form.addEventListener('submit', event => { event.preventDefault(); search(); });
$('more').addEventListener('click', () => search(true)); $('sort').addEventListener('change', render);
$('reset').addEventListener('click', () => { form.reset(); $('price-unit').textContent = 'koopsom'; search(); });
form.addEventListener('change', event => { if (event.target.name === 'type') { $('minPrice').value = 0; $('maxPrice').value = event.target.value === 'huur' ? 2000 : 500000; $('price-unit').textContent = event.target.value === 'huur' ? 'per maand' : 'koopsom'; } });
for (const id of ['save-sidebar', 'save-top']) $(id).addEventListener('click', openSave);
$('close-dialog').addEventListener('click', () => $('save-dialog').close());
$('alert-form').addEventListener('submit', async event => {
  event.preventDefault(); $('alert-submit').disabled = true; $('alert-status').textContent = 'Bevestigingslink versturen…';
  try { const result = await api('/api/subscribe', { method: 'POST', body: JSON.stringify({ email: $('email').value, consent: $('consent').checked, filters: pendingFilters }) }); $('alert-status').textContent = result.message; }
  catch(error) { $('alert-status').textContent = error.message; $('alert-submit').disabled = false; }
});

if (location.pathname === '/privacy') { $('search-page').hidden = true; $('privacy-page').hidden = false; document.title = 'Privacy & meldingen · Woningzoeker'; }
else if (['/confirm', '/unsubscribe'].includes(location.pathname)) {
  $('search-page').hidden = true; $('action-page').hidden = false;
  const confirming = location.pathname === '/confirm'; const token = location.hash.slice(1);
  history.replaceState(null, '', location.pathname);
  $('action-title').textContent = confirming ? 'Is dit jouw volgende stap?' : 'Meldingen stopzetten.';
  $('action-description').textContent = confirming ? 'Bevestig je e-mailadres. We controleren eerst het huidige aanbod, zodat je daarna alleen nieuwe matches ontvangt. Dit kan even duren.' : 'Klik hieronder om je zoekopdracht en e-mailadres te verwijderen. Je ontvangt daarna geen meldingen meer voor deze zoekopdracht.';
  $('action-button').textContent = confirming ? 'Bevestig mijn e-mailadres ↗' : 'Afmelden en verwijderen';
  $('action-button').addEventListener('click', async () => {
    $('action-button').disabled = true; $('action-status').textContent = confirming ? 'Huidige aanbod controleren en bevestigen…' : 'Je zoekopdracht verwijderen…';
    try { const result = await api(`/api/${confirming ? 'confirm' : 'unsubscribe'}`, { method: 'POST', body: JSON.stringify({ token }) }); $('action-status').textContent = result.message; $('action-button').hidden = true; }
    catch(error) { $('action-status').textContent = error.message; $('action-button').disabled = false; }
  });
} else { search(); }
