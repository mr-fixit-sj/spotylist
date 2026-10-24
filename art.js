// Background art: abstract SVG motifs in the brand colours, one family per kind of chart and a
// fresh random variation on every page view. Drawn here, so there are no image files to load
// and no image rights to worry about. Colours come from the CSS variables --brand/--brand-2,
// so the art follows the light and dark theme.

const W = 1200;
const H = 800;
const r = (min, max) => min + Math.random() * (max - min);
const pick = (list) => list[Math.floor(Math.random() * list.length)];
const f = (n) => Math.round(n * 10) / 10;

let uid = 0;
const gradient = (id, angle = 0) =>
  `<linearGradient id="${id}" gradientTransform="rotate(${f(angle)} .5 .5)">
    <stop offset="0" style="stop-color:var(--brand)"/><stop offset="1" style="stop-color:var(--brand-2)"/></linearGradient>`;

/** Trance: long flowing waves. */
function waves(id, { ribbons = false } = {}) {
  const lines = [];
  const count = ribbons ? 3 : Math.round(r(6, 10));
  const freq = r(1.2, 2.4);
  const base = r(110, 300); // high up: behind the header, not the song rows
  for (let i = 0; i < count; i++) {
    const amp = r(40, 140);
    const phase = r(0, Math.PI * 2);
    const y0 = base + i * (ribbons ? 60 : 32);
    let d = '';
    for (let x = -20; x <= W + 20; x += 20) {
      const y = y0 + amp * Math.sin((x / W) * Math.PI * 2 * freq + phase + i * 0.35);
      d += `${d ? 'L' : 'M'}${x} ${f(y)}`;
    }
    lines.push(`<path d="${d}" fill="none" stroke="url(#${id})" stroke-width="${ribbons ? f(r(18, 40)) : f(r(1.5, 3.5))}" stroke-linecap="round" opacity="${f(r(0.35, 0.9))}"/>`);
  }
  return lines.join('');
}

/** Techno: rhythmic bars (an equalizer) or a pulsing dot grid. */
function pulse(id, { grid = false } = {}) {
  const out = [];
  if (grid) {
    const step = r(38, 56);
    for (let x = step / 2; x < W; x += step) {
      for (let y = step / 2; y < H; y += step) {
        const beat = Math.abs(Math.sin(x * 0.013 + y * 0.009 + r(0, 0.6)));
        out.push(`<circle cx="${f(x)}" cy="${f(y)}" r="${f(1.5 + beat * 7)}" fill="url(#${id})" opacity="${f(0.25 + beat * 0.6)}"/>`);
      }
    }
    return out.join('');
  }
  const n = Math.round(r(40, 64));
  const bw = W / n;
  for (let i = 0; i < n; i++) {
    const h = f(H * (0.12 + 0.6 * Math.abs(Math.sin(i * r(0.18, 0.32))) * r(0.5, 1)));
    out.push(`<rect x="${f(i * bw + bw * 0.2)}" y="${f(H - h)}" width="${f(bw * 0.6)}" height="${h}" rx="${f(bw * 0.3)}" fill="url(#${id})" opacity="${f(r(0.4, 0.9))}"/>`);
  }
  return out.join('');
}

/** Melodic house & techno: soft overlapping light (aurora) or wide rings. */
function aurora(id, { rings = false } = {}) {
  const out = [];
  if (rings) {
    const cx = r(0.2, 0.8) * W;
    const cy = r(0.2, 0.6) * H;
    for (let i = 1; i <= 9; i++) out.push(`<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(i * r(55, 80))}" fill="none" stroke="url(#${id})" stroke-width="${f(r(1, 5))}" opacity="${f(1 - i / 11)}"/>`);
    return out.join('');
  }
  out.push(`<filter id="${id}b"><feGaussianBlur stdDeviation="60"/></filter><g filter="url(#${id}b)">`);
  for (let i = 0; i < 6; i++) {
    out.push(`<ellipse cx="${f(r(0, W))}" cy="${f(r(0, H * 0.7))}" rx="${f(r(150, 380))}" ry="${f(r(60, 180))}" transform="rotate(${f(r(-30, 30))})" fill="url(#${id})" opacity="${f(r(0.4, 0.9))}"/>`);
  }
  out.push('</g>');
  return out.join('');
}

/** Mainstage: stage light beams, or a burst from above. */
function beams(id, { burst = false } = {}) {
  const out = [];
  const sources = burst ? [[r(0.35, 0.65) * W, -40]] : [[r(0.1, 0.3) * W, H + 40], [r(0.7, 0.9) * W, H + 40]];
  for (const [sx, sy] of sources) {
    const n = burst ? 18 : 7;
    for (let i = 0; i < n; i++) {
      const angle = burst ? (i / (n - 1)) * Math.PI : -Math.PI / 2 + r(-0.9, 0.9);
      const len = r(700, 1100);
      const spread = burst ? 0.03 : r(0.03, 0.07);
      const x1 = sx + Math.cos(angle - spread) * len * (burst ? 1 : 1);
      const y1 = sy + Math.sin(angle - spread) * len * (burst ? 1 : 1);
      const x2 = sx + Math.cos(angle + spread) * len;
      const y2 = sy + Math.sin(angle + spread) * len;
      out.push(`<path d="M${f(sx)} ${f(sy)}L${f(x1)} ${f(y1)}L${f(x2)} ${f(y2)}Z" fill="url(#${id})" opacity="${f(r(0.25, 0.7))}"/>`);
    }
  }
  return out.join('');
}

/** Deep house: ripples on water, or slow soft blobs. */
function ripples(id, { blobs = false } = {}) {
  const out = [];
  if (blobs) {
    for (let i = 0; i < 7; i++) {
      const cx = r(0, W);
      const cy = r(0, H);
      const rad = r(60, 200);
      let d = '';
      for (let a = 0; a <= 12; a++) {
        const t = (a / 12) * Math.PI * 2;
        const rr = rad * r(0.8, 1.2);
        d += `${d ? 'L' : 'M'}${f(cx + Math.cos(t) * rr)} ${f(cy + Math.sin(t) * rr)}`;
      }
      out.push(`<path d="${d}Z" fill="url(#${id})" opacity="${f(r(0.3, 0.7))}" stroke-linejoin="round"/>`);
    }
    return out.join('');
  }
  for (let c = 0; c < Math.round(r(2, 4)); c++) {
    const cx = r(0, W);
    const cy = r(0, H);
    for (let i = 1; i <= 8; i++) out.push(`<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(i * r(26, 38))}" fill="none" stroke="url(#${id})" stroke-width="${f(r(1, 2.5))}" opacity="${f(1 - i / 9)}"/>`);
  }
  return out.join('');
}

/** Classic charts (Top 40, Hot 100, UK, year and decade lists): record grooves. */
function grooves(id, { two = false } = {}) {
  const out = [];
  const records = two ? [[r(0.05, 0.3) * W, r(0.2, 0.8) * H], [r(0.7, 0.95) * W, r(0.2, 0.8) * H]] : [[r(0.6, 0.95) * W, r(0.1, 0.5) * H]];
  for (const [cx, cy] of records) {
    const outer = r(260, 420);
    for (let rad = outer; rad > outer * 0.3; rad -= r(5, 9)) {
      out.push(`<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(rad)}" fill="none" stroke="url(#${id})" stroke-width="${f(r(0.6, 1.6))}" opacity="${f(r(0.3, 0.8))}"/>`);
    }
    out.push(`<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(outer * 0.22)}" fill="url(#${id})" opacity=".7"/>`);
  }
  return out.join('');
}

// Per kind of chart two variants; each call picks one and randomises it.
const MOTIFS = {
  trance: [(id) => waves(id), (id) => waves(id, { ribbons: true })],
  techno: [(id) => pulse(id), (id) => pulse(id, { grid: true })],
  melodic: [(id) => aurora(id), (id) => aurora(id, { rings: true })],
  mainstage: [(id) => beams(id), (id) => beams(id, { burst: true })],
  deep: [(id) => ripples(id), (id) => ripples(id, { blobs: true })],
  classic: [(id) => grooves(id), (id) => grooves(id, { two: true })],
};

/** The kind of art for a chart id; the home page gets a random kind. */
export function artKind(chartId) {
  if (!chartId) return pick(Object.keys(MOTIFS));
  if (chartId.startsWith('beatport-trance')) return 'trance';
  if (chartId.startsWith('beatport-techno')) return 'techno';
  if (chartId === 'beatport-melodic-house-techno') return 'melodic';
  if (chartId === 'beatport-mainstage') return 'mainstage';
  if (chartId === 'beatport-deep-house') return 'deep';
  return 'classic';
}

/** An SVG string for a kind of art, covering its box (like background-size: cover). */
export function artSvg(kind) {
  const id = `art${++uid}`;
  const body = pick(MOTIFS[kind] ?? MOTIFS.classic)(id);
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false"><defs>${gradient(id, r(0, 90))}</defs>${body}</svg>`;
}
