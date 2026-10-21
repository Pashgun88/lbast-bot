const { chromium } = require('playwright');
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  const { S } = require('./lib/state');
  S.bungaloWatchCheckedAt = 0; // разовый прогон по просьбе Паши, не дожидаясь восьми часов
  S.bungaloWatchPostedAt = 0;
  const { watchBungaloTasksIfDue } = require('./guides/bungalo_watch');
  console.log('результат: ' + await watchBungaloTasksIfDue(page));
  await ctx.close();
})();
