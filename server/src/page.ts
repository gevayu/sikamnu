import type { CallRecord } from './store.ts';

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const list = (items: string[]) => (items.length ? `<ul>${items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>` : '<p class="muted">אין</p>');

// ponytail: עמוד סטטי מהשרת. עריכה inline, מצא והחלף, "סכם מחדש" ו"תמלל מחדש" הם שבועות 5-7 ועוברים ל-web/.
export function callPage(c: CallRecord): string {
  const modeLabel = c.mode === 'live' ? 'תמליל חי (סטרימינג)' : 'תמלול בסיום (קובץ סגור)';
  const s = c.summary;
  return `<!doctype html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(c.title)}</title>
<style>
  body{font-family:system-ui,-apple-system,"Segoe UI",Arial,sans-serif;max-width:860px;margin:0 auto;padding:24px;color:#1a1a1a;background:#fafaf8;line-height:1.55}
  h1{font-size:1.5rem;margin:0 0 4px}
  .meta{color:#666;font-size:.9rem;margin-bottom:16px}
  audio{width:100%;margin:8px 0 20px}
  section{background:#fff;border:1px solid #e6e3dc;border-radius:8px;padding:16px 20px;margin-bottom:16px}
  h2{font-size:1.05rem;margin:0 0 10px}
  .seg{display:grid;grid-template-columns:52px 96px 1fr;gap:8px;padding:5px 0;border-bottom:1px solid #f0ede6;cursor:pointer}
  .seg:hover{background:#f6f4ee}
  .seg.me .who{color:#0b5}
  .t{color:#999;font-variant-numeric:tabular-nums;font-size:.85rem}
  .who{font-weight:600;color:#a55}
  .txt{unicode-bidi:plaintext}
  .muted{color:#999}
  ul{padding-inline-start:20px;margin:0}
  li{margin:3px 0}
  .ai{display:flex;gap:8px;align-items:baseline}
  .ai .link{color:#06c;font-size:.85rem;cursor:pointer}
  .marker{display:inline-block;background:#ffe9a8;padding:2px 8px;border-radius:4px;margin:2px;cursor:pointer;font-size:.85rem}
  footer{color:#999;font-size:.8rem;text-align:center;margin-top:24px}
</style>
</head>
<body>
<h1>${esc(c.title)}</h1>
<div class="meta">
  ${new Date(c.startedAt).toLocaleString('he-IL')} · ${mmss(c.durationSec)} · ${esc(c.platform)} ·
  ${c.participants.length ? esc(c.participants.join(', ')) + ' · ' : ''}
  ${c.language === 'he' ? 'עברית' : 'עברית ואנגלית'} · ${modeLabel} · ${esc(c.provider)} · $${c.estCostUsd}
</div>
${c.error ? `<section style="background:#fff4d6;border-color:#e8c766"><h2>התמלול נכשל</h2><p>האודיו נשמר ואפשר לתמלל אותו מחדש.</p><p class="muted" style="unicode-bidi:plaintext">${esc(c.error)}</p></section>` : ''}
${c.audioMime ? `<audio id="player" controls preload="metadata" src="/calls/${c.id}/audio"></audio>` : '<p class="muted">האודיו לא נשמר</p>'}

<section>
  <h2>סיכום</h2>
  ${s ? `<p><strong>${esc(s.tldr)}</strong></p>${list(s.bullets)}` : '<p class="muted">אין סיכום. בדוק ANTHROPIC_API_KEY בשרת.</p>'}
</section>
${s ? `
<section><h2>החלטות</h2>${list(s.decisions)}</section>
<section>
  <h2>Action Items</h2>
  ${s.action_items.length ? `<ul>${s.action_items.map((a) => `<li class="ai"><input type="checkbox" ${a.done ? 'checked' : ''}> <span>${esc(a.item)}${a.owner ? ` · <b>${esc(a.owner)}</b>` : ''}${a.due ? ` · ${esc(a.due)}` : ''}</span>${a.t != null ? `<span class="link" data-t="${a.t}">${mmss(a.t)}</span>` : ''}</li>`).join('')}</ul>` : '<p class="muted">אין</p>'}
</section>
<section><h2>שאלות פתוחות</h2>${list(s.open_questions)}</section>` : ''}
${c.markers.length ? `<section><h2>רגעים שסומנו</h2>${c.markers.map((m) => `<span class="marker" data-t="${m}">${mmss(m)}</span>`).join('')}</section>` : ''}

<section>
  <h2>תמליל</h2>
  ${c.segments.length ? c.segments.map((g) => `<div class="seg ${g.channel === 0 ? 'me' : ''}" data-t="${g.t0}"><span class="t">${mmss(g.t0)}</span><span class="who">${esc(g.speaker)}</span><span class="txt">${esc(g.text)}</span></div>`).join('') : '<p class="muted">התמליל ריק</p>'}
</section>
<footer>Si-kam-nu · מבית Bold Move · האודיו נמחק ב-${c.audioExpiresAt ? new Date(c.audioExpiresAt).toLocaleDateString('he-IL') : 'לא ידוע'}</footer>
<script>
  const p = document.getElementById('player');
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-t]');
    if (!el || !p) return;
    p.currentTime = Number(el.dataset.t);
    p.play();
  });
</script>
</body>
</html>`;
}
