// Data status (status.html): how far each chart is scraped and how many of its songs are
// linked to Spotify, from data/status.json (written by scraper/build.mjs, lib/status.mjs).
const LOOKUPS_PER_DAY = 650; // Spotify requests per 24 hours (scraper/lib/quota.mjs)
const BINS = [20, 40, 60, 80]; // % linked: colour steps 1..5 (status.css)

const $ = (id) => document.getElementById(id);
const num = (n) => n.toLocaleString('en');
// Rounded down, so 100% means every song and 0% none at all.
const pct = (part, whole) => (whole ? Math.floor((part / whole) * 100) : 0);
const bin = (p) => BINS.filter((b) => p >= b).length + 1;
const time = (iso) => new Date(iso).toLocaleString('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit' });

function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children.filter((c) => c != null && c !== false));
  return node;
}

function tile(label, value, note) {
  return el('div', { className: 'status-tile' },
    el('span', { className: 'status-tile-label' }, label),
    el('strong', { className: 'status-tile-value' }, value),
    note && el('span', { className: 'status-tile-note' }, note));
}

function renderTiles({ totals, quota }) {
  const now = Date.now();
  const blocked = quota.blockedUntil && Date.parse(quota.blockedUntil) > now;
  const windowEnd = quota.windowStart && Date.parse(quota.windowStart) + 24 * 3600_000 + 5 * 60_000;
  const inWindow = windowEnd && windowEnd > now;
  $('tiles').append(
    tile('Songs', num(totals.songs), 'different songs, all charts'),
    tile('Linked to Spotify', `${pct(totals.linked, totals.songs)}%`, `${num(totals.linked)} songs`),
    tile('Via your imports', num(totals.imported), `of the ${num(totals.linked)} linked`),
    tile('Not looked up yet', num(totals.pending),
      totals.pending ? `at least ${num(Math.ceil(totals.pending / LOOKUPS_PER_DAY))} days at ${LOOKUPS_PER_DAY} a day` : 'all done'),
    tile('Spotify lookups', blocked ? 'Paused' : `${inWindow ? num(quota.requests ?? 0) : 0} / ${LOOKUPS_PER_DAY}`,
      blocked ? `until ${time(quota.blockedUntil)}` : inWindow ? `this 24 hours, until ${time(windowEnd)}` : 'none in the last 24 hours'),
  );
}

function renderLegend() {
  const steps = [0, ...BINS].map((from, i) => el('span', { className: 'status-key' },
    el('span', { className: `status-swatch s${i + 1}` }), `${from}–${(BINS[i] ?? 101) - 1}%`));
  $('legend').append(...steps,
    el('span', { className: 'status-key' }, el('span', { className: 'status-swatch missing' }), 'not scraped yet'),
    el('span', { className: 'status-key' }, el('span', { className: 'status-swatch partial s3' }), 'partly scraped'));
}

// Tooltip: on hover with a mouse, on tap on a touch screen.
const tip = $('tip');
function showTip(cell, x, y) {
  tip.replaceChildren(...cell.tipLines.map((line, i) => (i ? el('span', {}, line) : el('strong', {}, line))));
  tip.hidden = false;
  const { width, height } = tip.getBoundingClientRect();
  tip.style.left = `${Math.max(8, Math.min(x - width / 2, innerWidth - width - 8))}px`;
  tip.style.top = `${y - height - 12 < 8 ? y + 16 : y - height - 12}px`;
}
document.addEventListener('pointerover', (e) => {
  const cell = e.target.closest?.('.status-cell[data-year]');
  if (cell && e.pointerType === 'mouse') {
    const r = cell.getBoundingClientRect();
    showTip(cell, r.left + r.width / 2, r.top);
  }
});
document.addEventListener('pointerout', (e) => {
  if (e.pointerType === 'mouse' && e.target.closest?.('.status-cell')) tip.hidden = true;
});
document.addEventListener('click', (e) => {
  const cell = e.target.closest?.('.status-cell[data-year]');
  if (!cell) return void (tip.hidden = true);
  const r = cell.getBoundingClientRect();
  showTip(cell, r.left + r.width / 2, r.top);
});
addEventListener('scroll', () => (tip.hidden = true), { passive: true });

function yearLines(year, y) {
  return [
    year,
    `Scraped: ${num(y.weeks)} of ${num(y.expected)} weeks`,
    y.songs ? `Linked: ${num(y.linked)} of ${num(y.songs)} songs (${pct(y.linked, y.songs)}%)` : 'No songs yet',
    y.imported ? `Via imports: ${num(y.imported)}` : null,
    y.pending ? `Not looked up yet: ${num(y.pending)}` : null,
    y.missed ? `Not on Spotify: ${num(y.missed)}` : null,
  ].filter(Boolean);
}

function yearGrid(chart) {
  const years = chart.years ?? {};
  const known = Object.keys(years).filter((y) => years[y].expected).map(Number);
  if (!known.length) return null;
  const [first, last] = [Math.min(...known), Math.max(...known)];
  const grid = el('div', { className: 'status-grid', ariaHidden: 'true' });
  grid.append(el('span'), ...Array.from({ length: 10 }, (_, i) => el('span', { className: 'status-col' }, String(i))));
  for (let decade = Math.floor(first / 10) * 10; decade <= last; decade += 10) {
    grid.append(el('span', { className: 'status-row' }, `${decade}s`));
    for (let year = decade; year < decade + 10; year++) {
      const y = years[year];
      if (!y?.expected) {
        grid.append(el('span', { className: 'status-cell none' }));
        continue;
      }
      const cell = el('span', { className: 'status-cell' });
      cell.dataset.year = year;
      cell.tipLines = yearLines(String(year), y);
      if (!y.weeks) cell.classList.add('missing');
      else {
        const p = pct(y.linked, y.songs);
        cell.classList.add(`s${bin(p)}`);
        if (y.weeks < y.expected * 0.9) cell.classList.add('partial');
        cell.textContent = p;
      }
      grid.append(cell);
    }
  }
  return grid;
}

function yearTable(chart) {
  const rows = Object.entries(chart.years ?? {}).filter(([, y]) => y.expected).reverse();
  return el('table', { className: 'status-table' },
    el('thead', {}, el('tr', {}, ...['Year', 'Weeks', 'Songs', 'Linked', 'Imports', 'To look up'].map((h) => el('th', { scope: 'col' }, h)))),
    el('tbody', {}, ...rows.map(([year, y]) => el('tr', {},
      el('th', { scope: 'row' }, year),
      el('td', {}, `${num(y.weeks)} / ${num(y.expected)}`),
      el('td', {}, num(y.songs)),
      el('td', {}, y.songs ? `${num(y.linked)} (${pct(y.linked, y.songs)}%)` : '–'),
      el('td', {}, num(y.imported)),
      el('td', {}, num(y.pending))))));
}

function bar(part, whole) {
  const fill = el('span', { className: 'status-bar-fill' });
  fill.style.width = `${whole ? (part / whole) * 100 : 0}%`;
  return el('span', { className: 'status-bar', ariaHidden: 'true' }, fill);
}

function fact(label, text, part, whole) {
  return el('div', { className: 'status-fact' }, el('span', { className: 'status-fact-label' }, label), el('span', {}, text), bar(part, whole));
}

function renderWeekly(charts) {
  const bySite = new Map();
  for (const chart of charts.filter((c) => c.expected != null)) {
    const before = bySite.get(chart.site);
    bySite.set(chart.site, chart);
    const scrape = chart.remaining
      ? `${num(chart.stored)} of ${num(chart.expected)} weeks (${pct(chart.stored, chart.expected)}%) · about ${chart.days} day${chart.days === 1 ? '' : 's'} to go`
        + (before?.remaining ? `, after ${before.label}` : '')
      : `all ${num(chart.stored)} weeks`;
    const linked = chart.songs
      ? `${num(chart.linked)} of ${num(chart.songs)} songs (${pct(chart.linked, chart.songs)}%)`
        + (chart.imported ? ` · ${num(chart.imported)} via imports` : '')
        + (chart.pending ? ` · ${num(chart.pending)} to look up` : '')
      : 'no songs yet';
    const grid = yearGrid(chart);
    $('weekly-charts').append(el('article', { className: 'status-chart' },
      el('h3', {}, chart.label),
      el('div', { className: 'status-facts' },
        fact('Scraped', scrape, chart.stored, chart.expected),
        fact('Linked', linked, chart.linked, chart.songs)),
      grid,
      grid && el('details', { className: 'status-details' }, el('summary', {}, 'Show as table'), el('div', { className: 'status-table-wrap' }, yearTable(chart)))));
  }
}

function renderLists(charts) {
  const lists = charts.filter((c) => c.expected == null);
  const name = (c) => (c.id.startsWith('beatport-') ? `Beatport ${c.label}` : c.label);
  $('lists').append(el('table', { className: 'status-table' },
    el('thead', {}, el('tr', {}, ...['Chart', 'Weeks', 'Songs', 'Linked', 'Imports'].map((h) => el('th', { scope: 'col' }, h)))),
    el('tbody', {}, ...lists.map((c) => el('tr', {},
      el('th', { scope: 'row' }, name(c)),
      el('td', {}, c.kind === 'weekly' ? num(c.periods) : '–'),
      el('td', {}, num(c.songs)),
      el('td', { title: `${num(c.linked)} songs` }, c.songs ? `${pct(c.linked, c.songs)}%` : '–'),
      el('td', {}, num(c.imported)))))));
}

function renderImports(imports) {
  if (!imports.length) return void $('imports').append(el('p', { className: 'status-note' }, 'None yet (☰ → Import a playlist, in fix mode).'));
  $('imports').append(el('table', { className: 'status-table' },
    el('thead', {}, el('tr', {}, ...['Playlist', 'Tracks', 'Exported'].map((h) => el('th', { scope: 'col' }, h)))),
    el('tbody', {}, ...imports.map((i) => el('tr', {},
      el('th', { scope: 'row' }, i.name ?? i.file),
      el('td', {}, num(i.tracks)),
      el('td', {}, i.exported ?? '–')))),
    el('tfoot', {}, el('tr', {}, el('th', { scope: 'row' }, `${imports.length} playlists`), el('td', {}, num(imports.reduce((n, i) => n + i.tracks, 0))), el('td')))));
}

try {
  const res = await fetch('data/status.json', { cache: 'no-cache' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const status = await res.json();
  $('built').textContent = `Updated ${new Date(status.builtAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}`;
  renderTiles(status);
  renderLegend();
  renderWeekly(status.charts);
  renderLists(status.charts);
  renderImports(status.imports);
  $('about').textContent = 'Scraping takes about 300 pages a day per site, one page per week; charts from the same site take turns. '
    + `Spotify allows about ${LOOKUPS_PER_DAY} lookups a day, and a song takes at least one. Imports cost none. Updated with every publish.`;
} catch (err) {
  $('built').textContent = `Could not load the status (${err.message}).`;
}
