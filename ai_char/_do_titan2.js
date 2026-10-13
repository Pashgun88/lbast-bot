const { chromium } = require('playwright');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  const { runTitanSchoolIfDue } = require('./lib/titan_school');
  const res = await runTitanSchoolIfDue(page);
  console.log('результат шага: ' + res);
  await ctx.close();
})();
