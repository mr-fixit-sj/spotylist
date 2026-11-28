// A song's chart history (the ⌁ button on a chart row): per chart its peak, weeks and runs, a small
// position curve on one shared time axis, and links to its first and peak week. Data from
// data/songs/<last character of the song id>.json (scraper/lib/history.mjs), loaded on first use.
const CHARTS = {
  nl: { id: 'nl-top40', name: 'Dutch Top 40', size: 40 },
  uk: { id: 'uk-singles', name: 'UK Top 100', size: 100 },
  us: { id: 'us-hot100', name: 'US Hot 100', size: 100 },
};
const shards = new Map();
const loadShard = (shard) => {
  if (!shards.has(shard)) shards.set(shard, fetch(`data/songs/${shard}.json`).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))));
  return shards.get(shard);
};

// "YYYY-WW" -> a date in that week (as scraper/lib/dates.mjs periodDate), in ms.
const weekTime = (period) => Date.UTC(Number(period.slice(0, 4)), 0, 1) + (Number(period.slice(5)) - 1) * 604_800_000;
const month = (period) => new Date(weekTime(period)).toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });
const span = (a, b) => (month(a) === month(b) ? month(a) : `${month(a)} – ${month(b)}`);
function later(ms) {
  const weeks = Math.round(ms / 604_800_000);
  if (weeks < 1) return 'the same week';
  if (weeks < 9) return `${weeks} week${weeks === 1 ? '' : 's'} later`;
  const months = Math.round(weeks / 4.35);
  if (months < 24) return `${months} months later`;
  return `${Math.round(months / 12)} years later`;
}

function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children.filter((c) => c != null && c !== false));
  return node;
}

let dialog = null;
function getDialog() {
  if (dialog) return dialog;
  dialog = el('dialog', { className: 'history', ariaLabel: 'Chart history' });
  // A click on the dimmed backdrop (outside the box) closes it, like Esc.
  dialog.addEventListener('click', (e) => e.target === dialog && dialog.close());
  document.body.append(dialog);
  return dialog;
}

/** The position curve of one chart: x on the shared time axis [t0, t1], #1 at the top. */
function curve(h, size, t0, t1, cls) {
  const W = 600, H = 80, pad = 5;
  const X = (t) => (t1 > t0 ? ((t - t0) / (t1 - t0)) * W : W / 2);
  const Y = (pos) => pad + ((Math.min(pos, size) - 1) / Math.max(1, size - 1)) * (H - 2 * pad);
  const d = h.r.map(([start, positions]) => positions.map((pos, i) => `${i ? 'L' : 'M'}${X(weekTime(start) + i * 604_800_000).toFixed(1)},${Y(pos).toFixed(1)}`).join('')).join('');
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('class', 'history-curve');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = `<line x1="0" x2="${W}" y1="${Y(1)}" y2="${Y(1)}" class="top-line"/><line x1="0" x2="${W}" y1="${H - pad}" y2="${H - pad}" class="base-line"/>`
    + `<path d="${d}" class="${cls}" vector-effect="non-scaling-stroke"/>`;
  return svg;
}

/**
 * Opens the history of a chart row's song. track: the row ([artist, title, spotifyId, imageId,
 * spotifyName, spotifyArtists, pending, flags, songId]); spotify: its Spotify link; go(hash, pos)
 * is told when a week link is followed, so the list can scroll to the song.
 */
export async function openHistory(track, { spotify, go }) {
  const [artist, title, spotifyId, imageId, spName, spArtists, , , id] = track;
  const box = getDialog();
  const close = el('button', { type: 'button', className: 'history-close', ariaLabel: 'Close', textContent: '×' });
  close.addEventListener('click', () => box.close());
  const cover = imageId ? el('img', { className: 'cover', src: `https://i.scdn.co/image/${imageId}`, alt: '' }) : el('span', { className: 'cover' });
  const head = el('div', { className: 'history-head' }, cover,
    el('div', { className: 'history-names' }, el('strong', {}, spName ?? title), el('span', {}, spArtists ?? artist)), close);
  const body = el('div', { className: 'history-body' }, el('p', { className: 'history-note' }, 'Loading…'));
  box.replaceChildren(head, body);
  if (!box.open) box.showModal();
  let song;
  try {
    song = (await loadShard(id.at(-1)))[id];
  } catch (err) {
    body.replaceChildren(el('p', { className: 'history-note' }, `Could not load the history (${err.message}).`));
    return;
  }
  if (!song) {
    body.replaceChildren(el('p', { className: 'history-note' }, 'No chart history for this song.'));
    return;
  }
  const charts = Object.entries(song.c).filter(([code]) => CHARTS[code]).sort(([, a], [, b]) => weekTime(a.f) - weekTime(b.f));
  const t0 = Math.min(...charts.map(([, h]) => weekTime(h.f)));
  const t1 = Math.max(...charts.map(([, h]) => weekTime(h.l)));
  const parts = [];
  if (charts.length > 1) {
    const [first, ...rest] = charts;
    parts.push(el('p', { className: 'history-note' },
      `First in the ${CHARTS[first[0]].name} (${month(first[1].f)}), then ${rest.map(([code, h]) => `the ${CHARTS[code].name} ${later(weekTime(h.f) - weekTime(first[1].f))}`).join(' and ')}.`));
  }
  for (const [code, h] of charts) {
    const c = CHARTS[code];
    const link = (period, pos, text) => {
      const a = el('a', { href: `#${c.id}/${period}`, textContent: text });
      a.addEventListener('click', () => {
        go(a.getAttribute('href'), pos);
        box.close();
      });
      return a;
    };
    const runs = h.r.length > 1 ? ` · ${h.r.length} runs` : '';
    parts.push(el('section', { className: 'history-chart' },
      el('p', { className: 'history-chart-head' }, el('span', { className: `history-key ${code}` }), el('strong', {}, c.name),
        ` · peak #${h.p}${h.pw > 1 ? ` (${h.pw} weeks)` : ''} · ${h.w} week${h.w === 1 ? '' : 's'}${runs}`),
      curve(h, c.size, t0, t1, code),
      el('p', { className: 'history-links' }, span(h.f, h.l), ' · ', link(h.f, h.r[0][1][0], 'First week'), ' · ', link(h.pf, h.p, 'Peak week'))));
  }
  parts.push(el('p', { className: 'history-axis' }, el('span', {}, month(charts[0][1].f)), el('span', {}, 'Higher is better: #1 at the top'), el('span', {}, month(charts.reduce((a, [, h]) => (weekTime(h.l) > weekTime(a) ? h.l : a), charts[0][1].l)))));
  const play = el('a', { className: 'history-play', href: spotify, textContent: spotifyId ? 'Open in Spotify' : 'Search Spotify' });
  if (!spotify.startsWith('spotify:')) play.target = 'spotylist-player';
  parts.push(play);
  body.replaceChildren(...parts);
}
