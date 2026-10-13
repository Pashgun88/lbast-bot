const { chromium } = require('playwright');
const m = require('./module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  await page.goto('http://lbast.ru/loc.php?obj=5198', { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
  await sleep(900);
  console.log('ШКОЛА:\n' + (await m.getBodyText(page).catch(() => '')).replace(/[ \t]+/g, ' ').slice(0, 700));
  await page.goto('http://lbast.ru/inv.php', { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
  await sleep(700);
  const t = (await m.getBodyText(page).catch(() => '')).replace(/[ \t]+/g, ' ');
  console.log('\nденьги: ' + ((t.match(/У вас (\d+) дин/) || [])[1] || '?'));
  await ctx.close();
})();
