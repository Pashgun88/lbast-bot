const { chromium } = require('playwright');
const { runHerbGuildIfDue } = require('./lib/herb_guild');
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  await runHerbGuildIfDue(page);
  await ctx.close();
})().catch((e) => { console.log('ОШИБКА:', e.message); process.exit(1); });
