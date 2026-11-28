// Builds the "Send to SpotyList" bookmarklet. Clicked on a Beatport Top 100 page, it reads the
// list in the owner's own browser (beatport.com blocks automated access), copies it, and opens
// a new issue in the data repository; the "Issue commands" workflow takes it from there.
import { extractTracks } from './beatport-extract.js';

const REPO = 'mr-fixit-sj/git-repos-spotylist';

// Runs on www.beatport.com. Everything it needs is passed in; it must not use outer variables.
function sendToSpotyList(extract, repo) {
  const genres = ['trance-main-floor', 'trance-raw-deep-hypnotic', 'techno-peak-time-driving', 'techno-raw-deep-hypnotic',
    'melodic-house-techno', 'mainstage', 'deep-house'];
  const m = location.pathname.match(/\/genre\/([^/]+)\/\d+\/top-100\/?$/);
  if (location.hostname !== 'www.beatport.com' || !m || !genres.includes(m[1])) {
    alert('SpotyList: open one of the Beatport Top 100 pages listed on the SpotyList Beatport page first.');
    return;
  }
  // Open the tab now, while the click still counts as a user action (popup blockers).
  const tab = window.open('about:blank', '_blank');
  const fromHtml = (html) => {
    const s = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    return s ? extract(JSON.parse(s[1])) : [];
  };
  // Re-read the page itself: after navigating inside Beatport, the live __NEXT_DATA__ can
  // still describe the first page that was loaded.
  fetch(location.href, { credentials: 'same-origin' })
    .then((r) => r.text())
    .then(fromHtml)
    .catch(() => [])
    .then((tracks) => {
      if (tracks.length < 10) {
        const live = document.getElementById('__NEXT_DATA__');
        tracks = live ? extract(JSON.parse(live.textContent)) : [];
      }
      if (tracks.length < 10) throw new Error('no track list found on this page');
      const payload = JSON.stringify({ chart: `beatport-${m[1]}`, url: location.href.split('?')[0], tracks });
      const issue = `https://github.com/${repo}/issues/new?title=${encodeURIComponent(`Beatport snapshot: ${m[1]}`)}`
        + `&body=${encodeURIComponent('Paste the copied list here (Ctrl/Cmd+V), then click Submit new issue.')}`;
      const go = () => { if (tab) tab.location = issue; else window.open(issue, '_blank'); };
      return navigator.clipboard.writeText(payload).then(go, () => {
        // Clipboard refused (some browsers after an async step): let the user copy by hand.
        prompt('SpotyList: copy this list (Ctrl/Cmd+C), then paste it into the issue.', payload);
        go();
      });
    })
    .catch((err) => {
      if (tab) tab.close();
      alert(`SpotyList: ${err.message}`);
    });
}

export const bookmarkletCode = `(${sendToSpotyList.toString()})(${extractTracks.toString()}, ${JSON.stringify(REPO)})`;

const link = document.getElementById('bookmarklet');
if (link) {
  link.href = `javascript:${encodeURIComponent(bookmarkletCode)}`;
  link.addEventListener('click', (e) => {
    e.preventDefault();
    alert('Drag this button to your bookmarks bar, then use it on a Beatport Top 100 page.');
  });
}
