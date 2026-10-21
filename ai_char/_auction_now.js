const { chromium } = require('playwright');
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  const { runAuctionRemindersIfDue } = require('./lib/auction_watch');
  console.log('результат: ' + await runAuctionRemindersIfDue(page));
  const { S } = require('./lib/state');
  console.log('доска в состоянии:');
  (S.auctionBoard || []).forEach((a) => console.log(`  ${a.prof} (${a.level} ур.) - ${a.holder} -> ${new Date(a.endsAt).toLocaleString('ru-RU')}`));
  console.log('семян: ' + S.auctionSeeds);
  await ctx.close();
})();
