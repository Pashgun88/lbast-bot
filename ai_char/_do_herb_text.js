const { chromium } = require('playwright');
const m = require('./module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  const { runHerbQuestsIfAvailable } = require('./lib/quests_story');
  const ok = await runHerbQuestsIfAvailable(page);
  console.log('результат: ' + ok);
  console.log('\n=== ПОЛНЫЙ ЭКРАН ПОСЛЕ ПОПЫТКИ ===\n' + (await m.getBodyText(page).catch(() => '')).replace(/[ \t]+/g, ' ').slice(0, 1500));
  await ctx.close();
})();
