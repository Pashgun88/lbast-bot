const { chromium } = require('playwright');
const m = require('./module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const STAT = 3; // Ловкость
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  const { readCombatStats } = require('./lib/lease');
  const avail = async () => {
    await page.goto('http://lbast.ru/pers.php?mod=stats', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await sleep(700);
    const t = (await m.getBodyText(page).catch(() => '')).replace(/[ \t]+/g, ' ');
    const mm = t.match(/Доступно статов:\s*(\d+)/);
    return mm ? Number(mm[1]) : null;
  };
  const before = await readCombatStats(page);
  console.log('мф ДО: ' + JSON.stringify(before));
  let left = await avail();
  console.log('свободных статов: ' + left);
  for (let i = 1; i <= 12 && left > 0; i++) {
    const link = await page.evaluate((st) => {
      const a = Array.from(document.querySelectorAll('a')).find((x) => (x.getAttribute('href') || '').includes('setOneStat&st=' + st));
      return a ? a.getAttribute('href') : null;
    }, STAT);
    if (!link) { console.log('ссылки прибавки нет - стоп'); break; }
    await page.goto(new URL(link, 'http://lbast.ru/').href, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await sleep(700);
    const now = await avail();
    console.log(`  +1 Ловкость (${i}): осталось ${now}`);
    if (now === left) { console.log('  счётчик не изменился - прекращаю, чтобы не тыкать вслепую'); break; }
    left = now;
  }
  const after = await readCombatStats(page);
  console.log('мф ПОСЛЕ: ' + JSON.stringify(after));
  await ctx.close();
})();
