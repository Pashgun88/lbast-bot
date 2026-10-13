// Только чтение: заходим в каждую точку хаба заново (через таверну) и смотрим первый экран.
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
  const step = async (name) => { for (let i = 0; i < 3; i++) { const ls = await links(); const h = ls.find((l) => l.t === name); if (h) { await open(h.h, 800); return true; } await sleep(800); await open('location.php', 600); } return false; };
  const enterScene = async () => {
    await open('location.php', 800);
    if (HUB_RE.test(await txt())) return true;
    await open('location.php?mod=konj&lway=19', 2200);
    for (let i = 0; i < 8; i++) { await open('location.php', 800); if (!/В пути/.test(await txt())) break; await sleep(1200); }
    for (const s of ['Идти на юг', 'Идти на запад', 'Идти на запад', 'Идти на запад', 'Идти на юг к Хорсхуфу', 'Идти на юг', 'Таверна "Закусочная и ночлег"']) await step(s);
    return HUB_RE.test(await txt());
  };
  const probe = async (point, deeper) => {
    if (!(await enterScene())) { out.push(`\n!! в сцену не вошёл перед ${point}: ${(await txt()).slice(0, 200)}`); return; }
    if (!(await step(point))) { out.push(`\n--- ${point}: точки в хабе нет`); return; }
    out.push(`\n--- ${point} ---\n${(await txt()).slice(0, 700)}\nВАРИАНТЫ: ${((await links()).filter((l) => !SKIP.test(l.t))).map((l) => l.t).join(' | ')}`);
    for (const d of deeper || []) {
      if (!(await step(d))) { out.push(`   (глубже «${d}» нет)`); break; }
      out.push(`   >>> ${d}: ${(await txt()).slice(0, 700)}\n       ВАРИАНТЫ: ${((await links()).filter((l) => !SKIP.test(l.t))).map((l) => l.t).join(' | ')}`);
    }
  };
  await probe('Идти к лекарю', ['Зайти внутрь']);
  await probe('Идти к свинарнику', []);
  await probe('Идти к кровельной лавке', ['Зайти внутрь']);
  await probe('Идти к продуктовой лавке', []);
  require('fs').writeFileSync(process.argv[2], out.join('\n'), 'utf8');
  await ctx.close();
})().catch((e) => { require('fs').writeFileSync(process.argv[2], `ОШИБКА: ${e.stack}\n${out.join('\n')}`, 'utf8'); process.exit(1); });
