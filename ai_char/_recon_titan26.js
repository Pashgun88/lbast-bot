const { chromium } = require('playwright');
const m = require('./module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  await page.goto('http://lbast.ru/loc.php?obj=5198&go=4', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(1000);
  const t = (await m.getBodyText(page).catch(() => '')).replace(/[ \t]+/g, ' ');
  console.log('=== СПРАВКА ===\n' + t.slice(0, 6000));
  await ctx.close();
})();
