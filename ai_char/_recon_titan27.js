const { chromium } = require('playwright');
const m = require('./module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  await page.goto('http://lbast.ru/loc.php?obj=5198', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(900);
  console.log('ДО:\n' + (await m.getBodyText(page)).replace(/[ \t]+/g, ' ').split('ШКОЛА ТИТАН')[1].slice(0, 900));
  await page.click('a:has-text("Выучить навыки атаки")');
  await sleep(1500);
  const t = (await m.getBodyText(page)).replace(/[ \t]+/g, ' ');
  console.log('\nПОСЛЕ КЛИКА «навыки атаки»:\n' + t.slice(0, 2500));
  await ctx.close();
})();
