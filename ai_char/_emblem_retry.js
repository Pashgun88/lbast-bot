const { chromium } = require('playwright');
const { takeClanEmblemIfDue } = require('./lib/clan_emblem');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  await sleep(15000); // переждать автобан
  await takeClanEmblemIfDue(page);
  await ctx.close();
})();
