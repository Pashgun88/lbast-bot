const { chromium } = require('playwright');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  await page.goto('http://lbast.ru/pers.php?mod=tatu', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(800);
  const html = await page.content();
  const i = html.indexOf('Доступно тату');
  console.log(html.slice(Math.max(0, i - 400), i + 2600));
  await ctx.close();
})();
