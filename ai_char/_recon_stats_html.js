const { chromium } = require('playwright');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  await page.goto('http://lbast.ru/pers.php?mod=stats', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(700);
  const h = await page.content();
  const i = h.indexOf('Доступно статов');
  console.log('--- STATS HTML ---\n' + h.slice(Math.max(0, i - 200), i + 1500));
  await page.goto('http://lbast.ru/log_infa.php?mod=who&blogin=AI__', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  await sleep(700);
  const { getBodyText } = require('./module');
  console.log('\n--- АНКЕТА ---\n' + (await getBodyText(page).catch(() => '')).replace(/[ \t]+/g, ' ').slice(0, 2000));
  await ctx.close();
})();
