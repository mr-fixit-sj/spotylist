// Chart stories (stories.html): six short chapters from data/stories.json (written by
// scraper/build.mjs, numbers from scraper/lib/stories.mjs). The text is written by hand; every
// number in it comes from the data, so it follows the charts as they grow.
const $ = (id) => document.getElementById(id);
const SVG = 'http://www.w3.org/2000/svg';
const COUNTRY = { 'nl-top40': 'nl', 'uk-singles': 'uk', 'us-hot100': 'us' }; // colour per chart, fixed
const num = (n) => n.toLocaleString('en');

function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children.filter((c) => c != null && c !== false));
  return node;
}
function svg(tag, attrs = {}, ...children) {
  const node = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  node.append(...children);
  return node;
}
/** A paragraph from text and elements: p('In ', strong('2009'), ', …'). */
const p = (...parts) => el('p', {}, ...parts);
const strong = (text) => el('strong', {}, String(text));
const em = (text) => el('em', {}, text);

// --- Line chart: one or more series over years, with direct labels, hover/tap values and a table.
const tip = $('tip');
function showTip(lines, x, y) {
  tip.replaceChildren(...lines.map((line, i) => (i ? el('span', {}, line) : el('strong', {}, line))));
  tip.hidden = false;
  const { width, height } = tip.getBoundingClientRect();
  tip.style.left = `${Math.max(8, Math.min(x - width / 2, innerWidth - width - 8))}px`;
  tip.style.top = `${y - height - 14 < 8 ? y + 18 : y - height - 14}px`;
}
addEventListener('scroll', () => (tip.hidden = true), { passive: true });

/**
 * series: [{ label, cls, points: [[year, value]] }]; format(value) for axis and tooltip;
 * marker: { x, label } draws a dashed vertical line (the year of a hit).
 */
function lineChart({ series, format, yMax, marker, height = 240, title, width = 640 }) {
  // Drawn at the width it is shown, so text stays at its real size on a phone.
  const W = Math.round(width), H = height, M = { l: 44, r: series.length > 1 ? 34 : 20, t: 14, b: 26 };
  const xs = series.flatMap((s) => s.points.map(([x]) => x));
  const [x0, x1] = [Math.min(...xs), Math.max(...xs)];
  // A round top with 4 round steps: 0, 15, 30, 45, 60 rather than 0, 15.3, 30.6, …
  const raw = yMax ?? (Math.max(...series.flatMap((s) => s.points.map(([, v]) => v))) || 1);
  const unit = 10 ** Math.floor(Math.log10(raw / 4));
  const stepY = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].map((f) => f * unit).find((s) => s * 4 >= raw);
  const top = stepY * 4;
  const X = (x) => M.l + ((x - x0) / Math.max(1, x1 - x0)) * (W - M.l - M.r);
  const Y = (v) => H - M.b - (v / top) * (H - M.t - M.b);
  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'story-chart', role: 'img', 'aria-label': title });
  // Recessive grid: 4 lines with values.
  for (let i = 0; i <= 4; i++) {
    const v = (top / 4) * i;
    root.append(svg('line', { x1: M.l, x2: W - M.r, y1: Y(v), y2: Y(v), class: 'grid' }), svg('text', { x: M.l - 6, y: Y(v) + 4, class: 'axis', 'text-anchor': 'end' }, format(v)));
  }
  const step = x1 - x0 > 40 ? 10 : x1 - x0 > 12 ? 5 : 2;
  for (let x = Math.ceil(x0 / step) * step; x <= x1; x += step) root.append(svg('text', { x: X(x), y: H - 6, class: 'axis', 'text-anchor': X(x) > W - 24 ? 'end' : 'middle' }, String(x)));
  if (marker) {
    root.append(svg('line', { x1: X(marker.x), x2: X(marker.x), y1: M.t, y2: H - M.b, class: 'marker' }), svg('text', { x: X(marker.x) + 4, y: M.t + 10, class: 'axis marker-label' }, marker.label));
  }
  for (const s of series) {
    const d = s.points.map(([x, v], i) => `${i ? 'L' : 'M'}${X(x).toFixed(1)},${Y(v).toFixed(1)}`).join('');
    root.append(svg('path', { d, class: `line ${s.cls}` }));
  }
  // Direct labels at the line ends, nudged apart.
  if (series.length > 1) {
    const ends = series.map((s) => ({ s, y: Y(s.points.at(-1)[1]) })).sort((a, b) => a.y - b.y);
    for (let i = 1; i < ends.length; i++) ends[i].y = Math.max(ends[i].y, ends[i - 1].y + 14);
    for (const { s, y } of ends) root.append(svg('text', { x: W - M.r + 6, y: y + 4, class: `end-label ${s.cls}` }, s.label));
  }
  // Hover / tap: a crosshair on the nearest year and all values in a tooltip.
  const cross = svg('line', { y1: M.t, y2: H - M.b, class: 'cross', visibility: 'hidden' });
  const dots = series.map((s) => svg('circle', { r: 4.5, class: `dot ${s.cls}`, visibility: 'hidden' }));
  root.append(cross, ...dots);
  const years = [...new Set(xs)].sort((a, b) => a - b);
  const hit = svg('rect', { x: M.l, y: M.t, width: W - M.l - M.r, height: H - M.t - M.b, class: 'hit' });
  root.append(hit);
  const move = (e) => {
    const box = root.getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * W;
    const year = years.reduce((a, b) => (Math.abs(X(b) - px) < Math.abs(X(a) - px) ? b : a));
    cross.setAttribute('x1', X(year));
    cross.setAttribute('x2', X(year));
    cross.setAttribute('visibility', 'visible');
    const lines = [String(year)];
    series.forEach((s, i) => {
      const point = s.points.find(([x]) => x === year);
      dots[i].setAttribute('visibility', point ? 'visible' : 'hidden');
      if (!point) return;
      dots[i].setAttribute('cx', X(year));
      dots[i].setAttribute('cy', Y(point[1]));
      lines.push(`${series.length > 1 ? `${s.label}: ` : ''}${format(point[1])}`);
    });
    showTip(lines, box.left + (X(year) / W) * box.width, box.top + (M.t / H) * box.height);
  };
  hit.addEventListener('pointermove', move);
  hit.addEventListener('pointerdown', move);
  hit.addEventListener('pointerleave', () => {
    tip.hidden = true;
    cross.setAttribute('visibility', 'hidden');
    for (const d of dots) d.setAttribute('visibility', 'hidden');
  });
  const table = el('table', { className: 'story-table' },
    el('thead', {}, el('tr', {}, el('th', { scope: 'col' }, 'Year'), ...series.map((s) => el('th', { scope: 'col' }, s.label)))),
    el('tbody', {}, ...[...years].reverse().map((y) => el('tr', {}, el('th', { scope: 'row' }, String(y)), ...series.map((s) => el('td', {}, (() => { const pt = s.points.find(([x]) => x === y); return pt ? format(pt[1]) : '–'; })()))))));
  return el('figure', { className: 'story-figure' }, root, el('details', {}, el('summary', {}, 'Show as table'), el('div', { className: 'story-table-wrap' }, table)));
}

const listen = (href, text) => el('a', { className: 'story-listen', href }, el('span', { className: 'story-listen-icon', ariaHidden: 'true' }, '▶'), text);
const how = (...parts) => el('details', { className: 'story-how' }, el('summary', {}, 'How we counted'), ...parts);
const chapter = (id, kicker, heading, ...body) => el('article', { className: 'story', id }, el('p', { className: 'story-kicker' }, kicker), el('h2', {}, heading), ...body);

// --- 1. The Christmas gap
function christmasChapter(data, charts) {
  const { series, classics, top } = data.christmas;
  const last = (id) => series[id]?.at(-1);
  const at = (id, y) => series[id]?.find(([x]) => x === y)?.[1];
  const [uk, us, nl] = ['uk-singles', 'us-hot100', 'nl-top40'].map(last);
  if (!uk || !nl) return null;
  const ukPeak = series['uk-singles'].reduce((a, b) => (b[1] > a[1] ? b : a));
  const lines = ['uk-singles', 'us-hot100', 'nl-top40'].filter((id) => series[id]?.length).map((id) => ({
    label: charts[id].short, cls: COUNTRY[id], points: series[id].filter(([y]) => y >= 1983),
  }));
  return chapter('christmas', 'Story 1', 'Christmas doesn’t exist in the Dutch Top 40',
    p(`In December ${uk[0]}, Christmas classics (songs that come back every year) took `, strong(`${uk[1]}%`), ' of the UK Top 100. In the US Hot 100: ', strong(`${us?.[1] ?? '–'}%`), '. In the Dutch Top 40: ', strong(`${nl[1]}%`), '.'),
    lineChart({ series: lines, width: full(), format: (v) => `${Math.round(v)}%`, title: 'Share of December chart positions taken by Christmas classics, per year' }),
    p('It was not always like this. For decades Christmas classics were a small December blip everywhere: a re-release here, a TV advert there. In the UK their share was ',
      `${at('uk-singles', 2005) ?? '–'}% in 2005. Then streaming came. Every play counts, old or new, and each December millions of people put on the same playlists. In ${ukPeak[0]} the classics held ${ukPeak[1]}% of the UK chart.`),
    p('The Dutch Top 40 does not follow. Christmas classics chart in the Netherlands when they are new (', em('All I Want For Christmas Is You'),
      ' reached #5 in January 1995) and then hardly ever return. Most likely that is the Top 40’s own chart rules, which keep older songs out. The songs themselves are surely no less played here; the chart just does not count them.'),
    listen('./#christmas-classics', `Listen: all ${classics} Christmas classics`),
    how(p(`A Christmas classic is a song in at least 3 different Christmas seasons (mid-November to mid-January) in the NL, UK or US charts, with at least 80% of its chart weeks in the season. So it is found by when it charts, not by its title, and a song that is in the chart all year (like “Mr Brightside”) is not one. The share counts all chart positions in December weeks: a Top 100 has 100 per week, the Top 40 has 40.`)),
  );
}

// --- 2. Songs that named children
function namesChapter(data) {
  if (!data.names) return null;
  const { stats, examples } = data.names;
  const lead = examples.find((e) => e.name === 'mandy') ?? examples[0];
  const at = (e, y) => e.series.find(([x]) => x === y)?.[1];
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const panels = examples.map((e) => el('div', { className: 'story-panel' },
    el('p', { className: 'story-panel-title' }, strong(cap(e.name)), ` · “${e.title}”, ${e.artist} (${e.year}, #${e.peak})`),
    lineChart({ series: [{ label: cap(e.name), cls: 'brand', points: e.series }], width: half(), format: (v) => `${Math.round(v)}`, marker: { x: e.year, label: 'hit' }, height: 170, title: `Girls named ${cap(e.name)} per 100,000 births, around the year of the hit` })));
  return chapter('names', 'Story 2', 'Mandy, Jolene, Rhiannon: songs that named children',
    p(`Barry Manilow’s “Mandy” entered the US chart in ${lead.year} and went to #1. Of every 100,000 American girls born in ${lead.year - 1}, about `, strong(String(at(lead, lead.year - 1) ?? '–')), ` were called Mandy. Of those born in ${lead.year + 1}: `, strong(String(at(lead, lead.year + 1) ?? '–')), '.'),
    el('div', { className: 'story-panels' }, ...panels),
    el('p', { className: 'story-axis-note' }, 'Girls given the name, per 100,000 births in the US; the dashed line is the year of the hit.'),
    p(`It is not a one-off. Of ${stats.songs} US top-40 hits titled with a first name, `, strong(`${stats.grew}%`), ' were followed by faster growth of that name than it had before. For the same names in other years that was ', strong(`${stats.placeboGrew}%`), '.'),
    p(`The typical effect is modest, about ${stats.medianExcess}% extra growth in two years, and most songs moved nothing. But a few clearly did: parents heard a name on the radio and liked it. The data covers US births up to ${stats.last}.`),
    listen('./#name-songs', 'Listen: the songs after which their name grew'),
    how(
      p(`Hits: US Hot 100 top 40, title is one first name, ${stats.first + 4}–${stats.last - 2}, leaving out names that are also everyday words (Angel, Summer, Crystal). Names: the US Social Security Administration’s 1,000 most popular names per year and sex (${stats.first}–${stats.last}).`),
      p(`For each hit, the growth of the name in the two years after it is compared with the name’s own trend in the three years before, so a name already on its way up does not count as an effect. The same comparison for the same names in random years far from their hit gives the baseline. The chance that random years give a result like this: ${stats.p < 0.01 ? 'below 1%' : `${Math.round(stats.p * 100)}%`}. A popular name can also lead to a song; the trend correction makes that less likely, but does not rule it out.`),
    ),
  );
}

// --- 3. Back in the charts
// Causes, checked by hand: only these moments get one. Others are shown without a cause.
// Keyed by main artist (lowercase, as the build groups credits) and month.
const CAUSES = {
  'michael jackson@2009-07': 'died (25 June)',
  'whitney houston@2012-02': 'died (11 Feb)',
  'david bowie@2016-01': 'died (10 Jan)',
  'prince@2016-04': 'died (21 Apr)',
  'amy winehouse@2011-07': 'died (23 Jul)',
  'elvis presley@1977-08': 'died (16 Aug)',
  'dmx@2021-04': 'died (9 Apr)',
  'taylor swift@2021-11': 'Red re-recorded',
  'taylor swift@2023-07': 'Speak Now re-recorded',
  'taylor swift@2023-11': '1989 re-recorded',
};
function comebacksChapter(data, charts) {
  const { series, moments, longest } = data.comebacks;
  const mj = moments.find((m) => m.who === 'michael jackson' && m.month === '2009-07');
  const perYear = (id, from, to) => {
    const pts = (series[id] ?? []).filter(([y]) => y >= from && y <= to);
    return pts.length ? Math.round(pts.reduce((a, [, v]) => a + v, 0) / pts.length) : null;
  };
  const lines = ['uk-singles', 'us-hot100', 'nl-top40'].filter((id) => series[id]?.length).map((id) => ({
    label: charts[id].short, cls: COUNTRY[id], points: series[id].filter(([y]) => y >= 1987),
  }));
  const month = (m) => new Date(`${m}-15T00:00:00Z`).toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });
  const table = el('table', { className: 'story-table' },
    el('thead', {}, el('tr', {}, ...['Month', 'Chart', 'Artist', 'Older songs back', 'Why'].map((h) => el('th', { scope: 'col' }, h)))),
    el('tbody', {}, ...moments.slice(0, 10).map((m) => el('tr', {},
      el('th', { scope: 'row' }, month(m.month)), el('td', {}, charts[m.chart].short), el('td', {}, m.artist),
      el('td', {}, String(m.songs)), el('td', {}, CAUSES[`${m.who}@${m.month}`] ?? '–')))));
  const far = longest[0];
  const ukPeak = (series['uk-singles'] ?? []).reduce((a, b) => (!a || b[1] > a[1] ? b : a), null);
  return chapter('comebacks', 'Story 3', 'Back in the charts: when old songs return',
    mj
      ? p('In July 2009, in the weeks after Michael Jackson died, ', strong(String(mj.songs)), ' of his older songs came back into the UK Top 100 at once.')
      : p('Old songs come back to the charts more and more.'),
    p('Old songs return for a handful of reasons. An artist dies, and fans play the whole catalogue again: Whitney Houston, David Bowie, Prince. A song gets a second life on screen, like Kate Bush’s “Running Up That Hill” through ', em('Stranger Things'), ', 37 years later. Or an artist re-records: Taylor Swift’s “Taylor’s Version” albums put a dozen or more of her older titles back in the US Hot 100 within a month.'),
    el('div', { className: 'story-table-wrap' }, table),
    lineChart({ series: lines, width: full(), format: (v) => num(Math.round(v)), title: 'Songs back in the chart after 5 or more years away, per year' }),
    p(`How often old songs come back depends on the chart. In the US it went from about ${perYear('us-hot100', 1990, 1999) ?? '–'} a year in the 1990s to ${perYear('us-hot100', 2020, 2029) ?? '–'} in the 2020s: streaming counts every play, old or new. The UK chart always had many (${perYear('uk-singles', 1990, 1999) ?? '–'} a year in the 1990s, ${perYear('uk-singles', 2020, 2029) ?? '–'} in the 2020s), mostly re-releases, with a peak in ${ukPeak?.[0] ?? '–'}, around the time downloads began to count. The Dutch Top 40: ${perYear('nl-top40', 1990, 1999) ?? '–'} a year in the 1990s and ${perYear('nl-top40', 2020, 2029) ?? '–'} in the 2020s. As with the Christmas songs, old songs hardly get back in there.`),
    far ? p('The longest gap of all: ', em(`“${far.title}”`), ` by ${far.artist}, back in the ${charts[far.chart].short} chart in ${far.to} after ${far.to - far.from} years away.`) : null,
    listen('./#comebacks', 'Listen: the longest comebacks'),
    how(p('A comeback is a song that returns to the same chart after at least 5 years without a week in it (for the table: 2 years, and 3 or more songs by one artist in the same month). One song across weeks is its main artist and title. Causes in the table are added by hand, only where known; the data itself only shows that songs came back.')),
  );
}

// --- 4. Love is leaving the charts
function loveChapter(data) {
  const { series, words, ones } = data.love ?? {};
  const built = new Date(data.builtAt).getUTCFullYear();
  const done = (pts) => pts?.filter(([y]) => y < built) ?? []; // whole years only
  const [all, length] = [done(series), done(words)];
  if (all.length < 10) return null;
  const peak = all.reduce((a, b) => (b[1] > a[1] ? b : a));
  const last = all.at(-1);
  const longest = length.reduce((a, b) => (b[1] > a[1] ? b : a));
  const oneIn = (pct) => Math.round(100 / pct);
  const share = (from, to) => {
    const v = all.filter(([y]) => y >= from && y <= to).map(([, x]) => x);
    return Math.round(v.reduce((a, b) => a + b, 0) / v.length);
  };
  return chapter('love', 'Story 4', 'Love is leaving the charts',
    p(`In ${peak[0]}, one in `, strong(String(oneIn(peak[1]))), ` new hits had love in the title. In ${last[0]}: one in `, strong(String(oneIn(last[1]))), '.'),
    lineChart({ series: [{ label: 'Love', cls: 'brand', points: all }], width: full(), format: (v) => `${Math.round(v)}%`, title: 'Share of new hits with love in the title, per year' }),
    p(`For thirty years love was the safest word in pop: from the 1960s to around 1990, ${share(1960, 1989)}% of new hits used it. Then it faded, and the titles shrank with it: ${longest[1].toFixed(1)} words on average in ${longest[0]}, ${length.at(-1)[1].toFixed(1)} in ${length.at(-1)[0]}.`),
    p('The charts can’t tell why. Two likely reasons: hip-hop and dance, which seldom put love in a title, took a much larger share of the charts; and the big ballad, the natural home of “love”, lost ground. A title also has a new job now. It has to be easy to find and to say to a phone, and short titles are.'),
    listen('./#love-number-ones', `Listen: all ${ones} #1s with love in the title`),
    how(p('Every song counts once, in the year it first entered the NL, UK or US chart. Love in any form: love, lover, loved, lovin’, loving, and liefde, amor, amour. Years with at least 300 new songs; the current year is left out until it is over.')),
  );
}

// --- 5. From America in a week
function crossingsChapter(data, charts) {
  const { series, decades } = data.crossings ?? {};
  const nl = series?.['nl-top40'];
  if (!nl?.length) return null;
  const avg = (pts, from, to) => {
    const v = (pts ?? []).filter(([y]) => y >= from && y <= to).map(([, w]) => w);
    return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null;
  };
  const weeks = (n) => `${n} week${n === 1 ? '' : 's'}`;
  const [then, now] = [avg(nl, 1970, 1979), avg(nl, 2020, 2029)];
  const lines = ['nl-top40', 'uk-singles'].filter((id) => series[id]?.length).map((id) => ({ label: charts[id].short, cls: COUNTRY[id], points: series[id] }));
  const table = el('table', { className: 'story-table' },
    el('thead', {}, el('tr', {}, ...['Decade', 'Weeks later (median)', 'Within 2 weeks', 'Songs'].map((h) => el('th', { scope: 'col' }, h)))),
    el('tbody', {}, ...decades['nl-top40'].map(([d, median, fast, n]) => el('tr', {},
      el('th', { scope: 'row' }, d), el('td', {}, String(median)), el('td', {}, `${fast}%`), el('td', {}, num(n))))));
  const [early, late] = [decades['nl-top40'].find(([d]) => d === '1970s'), decades['nl-top40'].at(-1)];
  // The slowest decade, when it was slower than the 1970s.
  const slowest = decades['nl-top40'].filter(([, median]) => median > (early?.[1] ?? Infinity)).sort((a, b) => b[1] - a[1])[0];
  return chapter('crossings', 'Story 5', 'From America in a week',
    p('In the 1970s, a hit from the US Hot 100 took about ', strong(then == null ? '–' : weeks(then)), ' to reach the Dutch Top 40. In the 2020s: ', strong(now == null ? '–' : weeks(now)), '.'),
    lineChart({ series: lines, width: full(), format: (v) => `${Math.round(v)} wk`, title: 'Weeks between a song’s first week in the US Hot 100 and in the Dutch and UK charts (median per year)' }),
    p(`For decades a single came out country by country. Record companies released it in the US first and in Europe weeks or months later, and in every country it needed its own radio play and TV shows. The UK chart was not much quicker than the Dutch one: about ${weeks(avg(series['uk-singles'], 1970, 1979) ?? 0)} behind the US in the 1970s.`),
    slowest ? p(`It even got slower for a while: in the ${slowest[0]}, the median was ${weeks(slowest[1])}.`) : null,
    p('Then streaming put every new song in every country at the same moment, and in July 2015 the music industry moved to one global release day: Friday. The gap closed within a few years. Now most songs that cross the ocean do so in a week or two, or the same week.'),
    early && late ? p(`In the 1970s, ${early[2]}% of the US hits that reached the Dutch Top 40 got there within two weeks. In the ${late[0]}: ${late[2]}%.`) : null,
    el('div', { className: 'story-table-wrap' }, table),
    how(p('For each song in the Dutch Top 40 or the UK chart that was in the US Hot 100 first (at most two years before), the weeks between its first week in the US and its first week here. Per year the median: half of the songs crossed faster, half slower. Years with at least 20 such songs. Songs that charted here first, and songs that never charted in the US, are not counted. The table is for the Dutch Top 40.')),
  );
}

// --- 6. Fewer songs, longer stays
function turnoverChapter(data, charts) {
  const { series, weeks, longest } = data.turnover ?? {};
  const nl = series?.['nl-top40'];
  if (!nl?.length || !weeks['nl-top40']?.length) return null;
  const at = (pts, y) => pts?.find(([x]) => x === y)?.[1];
  const avg = (pts, from, to) => {
    const v = (pts ?? []).filter(([y]) => y >= from && y <= to).map(([, w]) => w);
    return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null;
  };
  const most = nl.reduce((a, b) => (b[1] > a[1] ? b : a));
  const last = nl.at(-1);
  const w = weeks['nl-top40'];
  const [stayNow, stayThen] = [avg(w, w.at(-1)[0] - 4, w.at(-1)[0]), avg(w, 1970, 1999)];
  const ids = ['nl-top40', 'uk-singles', 'us-hot100'].filter((id) => series[id]?.length);
  const panels = ids.map((id) => el('div', { className: 'story-panel' },
    el('p', { className: 'story-panel-title' }, strong(charts[id].name.replace(/^the /, '')), ` · ${series[id][0][0]}–${series[id].at(-1)[0]}`),
    lineChart({ series: [{ label: charts[id].short, cls: COUNTRY[id], points: series[id] }], width: half(), format: (v) => num(Math.round(v)), height: 170, title: `New songs per year in ${charts[id].name}` })));
  const [uk, us] = [series['uk-singles'], series['us-hot100']];
  const ukMost = uk?.reduce((a, b) => (b[1] > a[1] ? b : a));
  const usLow = us?.filter(([y]) => y >= 1990 && y <= 2010).reduce((a, b) => (b[1] < a[1] ? b : a), [0, Infinity]);
  const record = longest?.[0];
  return chapter('turnover', 'Story 6', 'Fewer songs, longer stays',
    p(`In ${most[0]}, `, strong(num(most[1])), ` different songs entered the Dutch Top 40. In ${last[0]}: `, strong(num(last[1])), `. Fewer songs get in, and those that do stay ${stayNow >= 1.9 * stayThen ? 'twice as long' : stayNow >= 1.6 * stayThen ? 'nearly twice as long' : 'longer'}: half of them now stay ${stayNow} weeks or more, against ${stayThen} weeks in the 1970s to 1990s.`),
    el('div', { className: 'story-panels' }, ...panels),
    el('p', { className: 'story-axis-note' }, 'New songs per year, each chart on its own scale; only years the chart was at its full size every week.'),
    p('A chart that counts streams counts what people keep playing, and people play a favourite for months. In the singles era a hit dropped out once everyone who wanted it had bought it.'),
    ukMost ? p(`The UK went the same way, from ${num(ukMost[1])} new songs in ${ukMost[0]}, when singles came in and went out within weeks, to ${num(uk.at(-1)[1])} in ${uk.at(-1)[0]}.`) : null,
    usLow && us ? p(`The US Hot 100 is the exception. After a low of ${num(usLow[1])} new songs in ${usLow[0]}, it now has ${num(us.at(-1)[1])} a year, but most leave quickly: half are gone within ${avg(weeks['us-hot100'], weeks['us-hot100'].at(-1)[0] - 4, weeks['us-hot100'].at(-1)[0])} weeks. When a big album comes out, all its tracks enter the Hot 100 together, for a week or two.`) : null,
    record ? p('The longest stay of all: ', em(`“${record.title}”`), ` by ${record.artist}, ${num(record.weeks)} weeks in the ${charts[record.chart].short} chart.`) : null,
    listen('./#long-runners', 'Listen: the long runners'),
    how(p('New songs: songs in a chart for the first time, per year. Weeks: the median number of weeks those songs spent in that chart, all runs together, for years at least two years back (later songs may still be running). Only years in which every week of the chart had its full size: the UK chart had 12 places in 1952, 50 in the 1960s, 75 from 1978 and 100 from 1983, so its line starts there.')),
  );
}

// The width charts are drawn at: the text column, or half of it for the small multiples.
const full = () => Math.min(720, $('chapters').clientWidth || 640);
const half = () => (full() >= 560 ? (full() - 20) / 2 : full());

try {
  const res = await fetch('data/stories.json', { cache: 'no-cache' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const render = () => $('chapters').replaceChildren(...[christmasChapter(data, data.charts), namesChapter(data), comebacksChapter(data, data.charts), loveChapter(data), crossingsChapter(data, data.charts), turnoverChapter(data, data.charts)].filter(Boolean));
  render();
  $('status').remove();
  // Turning a phone or resizing the window: draw the charts again at the new width.
  let drawnAt = full();
  addEventListener('resize', () => {
    if (Math.abs(full() - drawnAt) < 40) return;
    drawnAt = full();
    render();
  });
  if (location.hash) document.querySelector(location.hash)?.scrollIntoView();
} catch (err) {
  $('status').textContent = `Could not load the stories (${err.message}).`;
}
