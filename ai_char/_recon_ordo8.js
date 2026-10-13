// Только чтение (без клика «В бой»): куда ведёт сцена главаря банды сейчас.
const { chromium } = require('playwright');
const m = require('./module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = [];
const FIGHT = /В бой|Напасть|Атаковать|Спрыгнуть/i;
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  const open = async (u, w = 900) => { await page.goto(new URL(u, 'http://lbast.ru/').href, { waitUntil: 'domcontentloaded', timeout: 60000 }); await sleep(w); };
  const txt = async () => (await m.getBodyText(page).catch(() => '')).replace(/\s+/g, ' ');
  const links = () => page.evaluate(() => Array.from(document.querySelectorAll('a')).map((a) => ({ t: (a.innerText || '').trim(), h: a.getAttribute('href') || '' })).filter((x) => x.t && x.h));
  const SKIP = /^(Амулет|Aмулет|Конь|Чат|Форум|ЖГ|Карта|Кланы|Бои|Выход|Галерея|Размер текста|Кто здесь\?|AI__|Q\d+|D\d+|В игру|Обновить)/i;
  const report = async (label) => {
    const ls = (await links()).filter((l) => !SKIP.test(l.t));
    out.push(`\n--- ${label} ---\n${(await txt()).slice(0, 500)}\nССЫЛКИ: ${ls.map((l) => l.t + ' -> ' + l.h.replace(/r=\d+&?/, '')).join(' | ')}`);
    return ls;
  };
  await open('location.php?mod=konj&lway=q2001_2', 2200);
  for (let i = 0; i < 6; i++) { await open('location.php', 800); if (!/В пути/.test(await txt())) break; await sleep(1200); }
  let ls = await report('пещера бандитов');
  // Вернуться
  let h = ls.find((l) => /^Вернуться$/.test(l.t));
  if (h) { await open(h.h, 900); ls = await report('после Вернуться'); }
  // дальше - только НЕ боевые ссылки, по одной, в глубину 3
  for (let d = 0; d < 3; d++) {
    const next = ls.find((l) => !FIGHT.test(l.t) && !/^Вернуться$/.test(l.t) && /^(Идти|Прокрасться|Залезть|Слезть|Осмотреть|Спустит|Продолжить)/i.test(l.t));
    if (!next) break;
    await open(next.h, 900);
    ls = await report(`шаг: ${next.t}`);
  }
  require('fs').writeFileSync(process.argv[2], out.join('\n'), 'utf8');
  await ctx.close();
})().catch((e) => { require('fs').writeFileSync(process.argv[2], `ОШИБКА: ${e.stack}\n${out.join('\n')}`, 'utf8'); process.exit(1); });
