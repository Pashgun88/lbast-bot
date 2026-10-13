const { chromium } = require('playwright');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  const { sellFriedFishIfDue } = require('./lib/fish_sale');
  const ok = await sellFriedFishIfDue(page);
  console.log('результат продажи: ' + ok);
  await ctx.close();
})();
