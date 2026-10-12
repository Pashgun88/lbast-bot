const { chromium } = require('playwright');
const m = require('./module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SKIP = /Чат|Форум|ЖГ|^Карта|Кланы|^Бои|Амулет|Aмулет|Конь|Выход|Размер|Кто здесь|Галерея|статы|AI__|^Q\d|^D\d|Обновить|Памятник|Мемориальная|Стела/;
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  const nav = async () => (await page.$$eval('a', (as) => as.map((a) => ({ t: (a.textContent || '').trim().replace(/\s+/g, ' '), h: a.getAttribute('href') || '' })))).filter((a) => a.t);
  const dump = async (label) => {
    const t = (await m.getBodyText(page).catch(() => '')).replace(/\s+/g, ' ');
    const l = (await nav()).filter((a) => !SKIP.test(a.t));
    console.log(`\n[${label}]\n${t.slice(0, 650)}\n   >> ` + l.map((a) => a.t + ' -> ' + a.h).join(' | '));
    return l;
  };
  const click = async (re) => {
    const a = (await nav()).find((x) => re.test(x.t));
    if (!a) return false;
    await page.goto(new URL(a.h, 'http://lbast.ru/').href, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await sleep(1000); return true;
  };
  await page.goto('http://lbast.ru/location.php?mod=fastway&lway=7', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(2300);
  await click(/^Идти на юг$/);          // Мертвый лес
  await click(/^Идти на восток$/);      // Замок
  await dump('Замок у форта');
  await click(/^Идти на север$/); await dump('Замок -> север');
  for (const d of [/^Идти на восток$/, /^Идти на север$/, /^Идти на запад$/]) {
    const before = page.url();
    if (await click(d)) { await dump('дальше ' + d.source); await page.goto(before, { waitUntil: 'domcontentloaded', timeout: 45000 }); await sleep(800); }
  }
  await ctx.close();
})();
