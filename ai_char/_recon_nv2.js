// Только чтение (кроме возвратных «Далее»/«Уйти»): что открыто в каждой точке хаба Хорсхуфа.
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
  const HUB_RE = /Вы стоите посреди города Хорсхуф/;
  const toHub = async () => {
    for (let i = 0; i < 8; i++) {
      const t = await txt();
      if (HUB_RE.test(t)) return true;
      const ls = (await links()).filter((l) => !SKIP.test(l.t));
      const back = ls.find((l) => /^(Далее|Уйти|Вернуться в город|Постараемся)/.test(l.t));
      if (!back) return false;
      await open(back.h, 900);
    }
    return HUB_RE.test(await txt());
  };
  const points = ['Идти к лекарю', 'Идти к свинарнику', 'Идти к кровельной лавке', 'Идти к продуктовой лавке', 'Идти к дому цирюльника', 'Идти к дому куртизанки'];
  // Вход в сцену: если мы не в ней, едем в Хорсхуф и жмём таверну - игра возвращает на тот экран,
  // где сцену оставили.
  await open('location.php', 800);
  if (!HUB_RE.test(await txt()) && !(await toHub())) {
    await open('location.php?mod=konj&lway=19', 2200);
    for (let i = 0; i < 8; i++) { await open('location.php', 800); if (!/В пути/.test(await txt())) break; await sleep(1200); }
    const step = async (name) => { for (let i = 0; i < 3; i++) { const ls = await links(); const h = ls.find((l) => l.t === name); if (h) { await open(h.h, 800); return true; } await sleep(800); await open('location.php', 600); } return false; };
    for (const s2 of ['Идти на юг', 'Идти на запад', 'Идти на запад', 'Идти на запад', 'Идти на юг к Хорсхуфу', 'Идти на юг', 'Таверна "Закусочная и ночлег"']) await step(s2);
    await toHub();
  }
  if (!HUB_RE.test(await txt())) out.push(`НЕ В ХАБЕ: ${(await txt()).slice(0, 400)}`);
  out.push(`ХАБ ТОЧКИ: ${((await links()).filter((l) => !SKIP.test(l.t))).map((l) => l.t).join(' | ')}`);
  for (const p of points) {
    if (!(await toHub())) { out.push(`\n!! вернуться в хаб не смог перед ${p}: ${(await txt()).slice(0, 200)}`); break; }
    const ls = (await links()).filter((l) => !SKIP.test(l.t));
    const h = ls.find((l) => l.t === p);
    if (!h) { out.push(`\n--- ${p}: такой точки в хабе нет`); continue; }
    await open(h.h, 1000);
    const inner = (await links()).filter((l) => !SKIP.test(l.t));
    out.push(`\n--- ${p} ---\n${(await txt()).slice(0, 600)}\nВАРИАНТЫ: ${inner.map((l) => l.t).join(' | ')}`);
  }
  require('fs').writeFileSync(process.argv[2], out.join('\n'), 'utf8');
  await ctx.close();
})().catch((e) => { require('fs').writeFileSync(process.argv[2], `ОШИБКА: ${e.stack}\n${out.join('\n')}`, 'utf8'); process.exit(1); });
