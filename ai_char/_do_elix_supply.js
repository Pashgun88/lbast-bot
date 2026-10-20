const { chromium } = require('playwright');
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  const { sendGolemElixirsIfDue } = require('./lib/golem_elixir_supply');
  console.log('результат: ' + await sendGolemElixirsIfDue(page));
  await ctx.close();
})();
