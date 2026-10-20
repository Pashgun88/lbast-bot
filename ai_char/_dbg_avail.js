const { chromium } = require('playwright');
const { getBodyText } = require('./module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  await page.goto('http://lbast.ru/pers.php?mod=stats', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(600);
  const t = (await getBodyText(page).catch(() => '')).replace(/[ \t]+/g, ' ');
  const i = t.indexOf('Доступно');
  console.log(JSON.stringify(t.slice(i - 20, i + 60)));
  await ctx.close();
})();
