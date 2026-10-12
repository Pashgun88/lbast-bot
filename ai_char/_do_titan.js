const { chromium } = require('playwright');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  // уводим персонажа подальше, чтобы проверить маршрут с нуля
  await page.goto('http://lbast.ru/location.php?mod=fastway&lway=4', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(2500);
  const { runTitanSchoolIfDue } = require('./lib/titan_school');
  const res = await runTitanSchoolIfDue(page);
  console.log('результат шага: ' + res);
  await ctx.close();
})();
