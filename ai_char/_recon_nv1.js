// Только чтение: что предлагает каждая точка хаба Хорсхуфа - понять, где стоит сцена.
const { chromium } = require('playwright');
const m = require('./module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = [];
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  const open = async (u, w = 900) => { await page.goto(new URL(u, 'http://lbast.ru/').href, { waitUntil: 'domcontentloaded', timeout: 60000 }); await sleep(w); };
  const txt = async () => (await m.getBodyText(page).catch(() => '')).replace(/\s+/g, ' ');
  const links = () => page.evaluate(() => Array.from(document.querySelectorAll('a')).map((a) => ({ t: (a.innerText || '').trim(), h: a.getAttribute('href') || '' })).filter((x) => x.t && x.h));
  const SKIP = /^(Амулет|Aмулет|Конь|Чат|Форум|ЖГ|Карта|Кланы|Бои|Выход|Галерея|Размер текста|Кто здесь\?|AI__|Q\d+|D\d+|В игру|Обновить)/i;
  const hub = async () => {
    // возврат в сцену: таверна Хорсхуфа возвращает на тот экран, где сцену оставили
    await open('location.php?mod=konj&lway=19', 2200);
    for (let i = 0; i < 8; i++) { await open('location.php', 800); if (!/В пути/.test(await txt())) break; await sleep(1200); }
    const step = async (name) => { for (let i = 0; i < 3; i++) { const ls = await links(); const h = ls.find((l) => l.t === name); if (h) { await open(h.h, 800); return true; } await sleep(800); await open('location.php', 600); } return false; };
    for (const s of ['Идти на юг', 'Идти на запад', 'Идти на запад', 'Идти на запад', 'Идти на юг к Хорсхуфу', 'Идти на юг', 'Таверна "Закусочная и ночлег"']) await step(s);
    return (await links()).filter((l) => !SKIP.test(l.t));
  };
  let ls = await hub();
  out.push(`ХАБ: ${(await txt()).slice(0, 300)}\nТОЧКИ: ${ls.map((l) => l.t).join(' | ')}`);
  const points = ls.filter((l) => /^Идти к/.test(l.t)).map((l) => l.t);
  for (const p of points) {
    ls = await hub();
    const h = ls.find((l) => l.t === p);
    if (!h) { out.push(`\n!! ${p}: не нашёл в хабе`); continue; }
    await open(h.h, 1000);
    const inner = (await links()).filter((l) => !SKIP.test(l.t));
    out.push(`\n--- ${p} ---\n${(await txt()).slice(0, 700)}\nВАРИАНТЫ: ${inner.map((l) => l.t).join(' | ')}`);
  }
  require('fs').writeFileSync(process.argv[2], out.join('\n'), 'utf8');
  await ctx.close();
})().catch((e) => { require('fs').writeFileSync(process.argv[2], `ОШИБКА: ${e.stack}\n${out.join('\n')}`, 'utf8'); process.exit(1); });
