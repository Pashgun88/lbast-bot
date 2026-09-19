// Сбор летописей и игровых событий в долгую память автоответчика (Паша, 19.09.2026: «по поводу
// летописей и игровых событий, закинь всю инфу тоже в раг»). Страницы открыты без входа.
// Запуск: node lore_crawl.js  ->  ai_char/lore/lore.jsonl  ({src, title, text} кусками ~700 символов)
// Источники: библиотека (Летописи. История, Летописи. События, Дэнжены), Помощь/F.A.Q., новости.
const fs = require('fs');
const path = require('path');

const BASE = 'http://lbast.ru';
const OUT_DIR = path.join(__dirname, 'lore');
const OUT = path.join(OUT_DIR, 'lore.jsonl');
const SECTIONS = { history_chronicles: 'Летописи. История', history_events: 'Летописи. События', events_and_dangeons: 'Дэнжены и события' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url) {
  for (let a = 1; a <= 3; a++) {
    try {
      const r = await fetch(url);
      if (r.ok) return await r.text();
    } catch (e) { /* повтор */ }
    await sleep(2000 * a);
  }
  return '';
}

const decode = (s) => s.replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&laquo;/g, '«').replace(/&raquo;/g, '»')
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
function htmlText(html) {
  return decode(html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|tr|li|h\d)>/gi, '\n').replace(/<[^>]+>/g, ' '))
    .split('\n').map((l) => l.replace(/[ \t]+/g, ' ').trim()).filter(Boolean).join('\n');
}
const anchors = (html) => [...html.matchAll(/<a [^>]*href="([^"]*)"[^>]*>([^<]*)</gi)].map((m) => ({ h: decode(m[1]), t: decode(m[2]).trim() }));

// Текст статьи: от заголовка до «Вернуться».
function articleBody(html, title) {
  const t = htmlText(html);
  const i = t.indexOf(title);
  let body = i >= 0 ? t.slice(i + title.length) : t;
  const j = body.lastIndexOf('\nВернуться');
  if (j >= 0) body = body.slice(0, j);
  return body.trim();
}

function chunks(text, size = 700) {
  const paras = text.split('\n');
  const out = [];
  let cur = '';
  for (const p of paras) {
    if (cur && cur.length + p.length > size) { out.push(cur); cur = ''; }
    cur = cur ? `${cur}\n${p}` : p;
    while (cur.length > size * 1.6) { out.push(cur.slice(0, size)); cur = cur.slice(size); }
  }
  if (cur.trim()) out.push(cur);
  return out;
}

async function crawlSection(dir, label, rows) {
  const seen = new Set();
  for (let p = 1; p < 60; p++) { // страницы с 1 (p=0 = p=1)
    const html = await get(`${BASE}/library/index.php?dir=${dir}&p=${p}&srt=1`);
    const items = anchors(html).filter((a) => a.h.includes(`dir=${dir};`) && a.t);
    const fresh = items.filter((a) => !seen.has(a.h.split('&')[0]));
    if (!fresh.length) break;
    for (const a of fresh) {
      seen.add(a.h.split('&')[0]);
      const art = await get(new URL(a.h, `${BASE}/library/index.php`).href);
      const body = articleBody(art, a.t);
      chunks(body).forEach((c, k) => rows.push({ src: label, title: a.t, part: k, text: c }));
      await sleep(300);
    }
  }
  console.log(`${label}: статей ${seen.size}`);
}

async function crawlHelp(rows) {
  const idx = await get(`${BASE}/library/help/index.php`);
  const items = anchors(idx).filter((a) => /mod=\d+/.test(a.h) && a.t);
  for (const a of items) {
    const html = await get(new URL(a.h, `${BASE}/library/help/index.php`).href);
    const body = articleBody(html, a.t);
    chunks(body).forEach((c, k) => rows.push({ src: 'Помощь', title: a.t, part: k, text: c }));
    await sleep(300);
  }
  console.log(`Помощь: разделов ${items.length}`);
}

async function crawlNews(rows) {
  const html = await get(`${BASE}/news.php`);
  const t = htmlText(html).replace(/^[\s\S]*?\nВернуться\n/, '');
  // Новость начинается с заголовка, за которым строка «Добавлено: ДД.ММ.ГГГГ».
  const lines = t.split('\n');
  let n = 0;
  for (let i = 1; i < lines.length; i++) {
    if (!/^Добавлено:/.test(lines[i])) continue;
    let end = i + 1;
    while (end < lines.length && !(lines[end + 1] && /^Добавлено:/.test(lines[end + 1]))) end++;
    const title = `${lines[i - 1]} (${lines[i].replace(/^Добавлено:\s*/, '')})`;
    chunks(lines.slice(i + 1, end).join('\n')).forEach((c, k) => rows.push({ src: 'Новости', title, part: k, text: c }));
    n++;
  }
  console.log(`Новости: ${n}`);
}

(async () => {
  const rows = [];
  for (const [dir, label] of Object.entries(SECTIONS)) await crawlSection(dir, label, rows);
  await crawlHelp(rows);
  await crawlNews(rows);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  console.log(`Записано кусков: ${rows.length} -> ${OUT}`);
})();
