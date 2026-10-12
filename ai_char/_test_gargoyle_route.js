const { chromium } = require('playwright');
const m = require('./module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  const { goRouteToGargoyle, isGargoyleLocation } = require('./lib/farm');
  await page.goto('http://lbast.ru/location.php', { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
  await sleep(700);
  const t0 = (await m.getBodyText(page).catch(() => '')).replace(/\s+/g, ' ');
  console.log('стоим: ' + t0.slice(0, 160));
  console.log('уже у маяка: ' + (await isGargoyleLocation(page)));
  await goRouteToGargoyle(page);
  const here = (await m.getBodyText(page).catch(() => '')).replace(/\s+/g, ' ');
  console.log('\nпришли: ' + here.slice(0, 260));
  console.log('у маяка: ' + (await isGargoyleLocation(page)));
  // экран охоты, но В БОЙ НЕ ВСТУПАЕМ
  await page.goto('http://lbast.ru/location_boi.php', { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
  await sleep(900);
  console.log('\nэкран охоты: ' + (await m.getBodyText(page).catch(() => '')).replace(/\s+/g, ' ').slice(0, 400));
  await ctx.close();
})();
