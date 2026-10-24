const { chromium } = require('playwright');
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  const { S } = require('./lib/state');
  S.auctionBoardAt = 0;              // читаем доску сейчас
  S.auctionSent = {};
  const { runAuctionRemindersIfDue } = require('./lib/auction_watch');
  console.log('результат: ' + await runAuctionRemindersIfDue(page));
  (S.auctionBoard || []).forEach((a) => console.log(`  ${a.prof} - ${a.holder} -> ${new Date(a.endsAt).toLocaleString('ru-RU')}`));
  console.log('семян: ' + S.auctionSeeds);
  console.log('очередь зала: ' + require('fs').readFileSync('chat_outbox.json','utf8'));
  await ctx.close();
})();
