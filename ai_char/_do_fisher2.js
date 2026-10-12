const { chromium } = require('playwright');
const m = require('./module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  const { resetToQuestMenu } = require('./lib/quest_menu');
  const { progressFisherFoodQuest } = require('./lib/quests_basic');
  await resetToQuestMenu(page);
  await sleep(800);
  const ok = await progressFisherFoodQuest(page, {});
  console.log('результат: ' + ok);
  console.log('ЭКРАН: ' + (await m.getBodyText(page).catch(() => '')).replace(/\s+/g, ' ').slice(0, 500));
  await ctx.close();
})();
