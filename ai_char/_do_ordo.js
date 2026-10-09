const { chromium } = require('playwright');
const { runOrdoQuestsIfAvailable } = require('./lib/quests_story');
const S = require('./lib/state');
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  await page.goto('http://lbast.ru/location.php?mod=quests', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await new Promise((r) => setTimeout(r, 1200));
  const ok = await runOrdoQuestsIfAvailable(page);
  console.log('РЕЗУЛЬТАТ Ордо:', ok);
  await ctx.close();
})();
