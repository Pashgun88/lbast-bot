const { chromium } = require('playwright');
const { getBodyText } = require('./module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  await page.goto('http://lbast.ru/pers.php', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  await sleep(700);
  const t = (await getBodyText(page).catch(() => '')).replace(/[ \t]+/g, ' ');
  console.log(t.split('\n').filter((l) => /задани|медал|мораль/i.test(l)).join('\n'));
  await ctx.close();
})();
