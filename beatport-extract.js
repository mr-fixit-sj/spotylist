// Reads a Beatport Top 100 from a page's __NEXT_DATA__ JSON: the largest list of objects that
// have a name and named artists. Returns [[artist, title], ...] in chart order.
// Must stay self-contained: it is embedded into the bookmarklet with Function.toString().
export function extractTracks(nextData) {
  const isTrack = (t) => t && typeof t === 'object' && typeof t.name === 'string'
    && Array.isArray(t.artists) && t.artists.length > 0
    && t.artists.every((a) => a && typeof a.name === 'string');
  let best = [];
  const walk = (node, depth) => {
    if (!node || typeof node !== 'object' || depth > 40) return;
    if (Array.isArray(node)) {
      const tracks = node.filter(isTrack);
      if (tracks.length >= 10 && tracks.length >= node.length * 0.9 && tracks.length > best.length) best = tracks;
      for (const item of node) walk(item, depth + 1);
    } else {
      for (const value of Object.values(node)) walk(value, depth + 1);
    }
  };
  walk(nextData, 0);
  return best.slice(0, 100).map((t) => [
    t.artists.map((a) => a.name).join(', '),
    t.mix_name ? `${t.name} (${t.mix_name})` : t.name,
  ]);
}
