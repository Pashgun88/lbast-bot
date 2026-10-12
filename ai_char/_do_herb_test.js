const { chromium } = require('playwright');
const m = require('./module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  const hp = async () => {
    await page.goto('http://lbast.ru/location.php', { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
    await sleep(600);
    const t = await m.getBodyText(page).catch(() => '');
    return ((t.match(/AI__ \(([^)]*)\)/) || [])[1] || '?');
  };
  console.log('HP до: ' + (await hp()));
  const { runHerbQuestsIfAvailable } = require('./lib/quests_story');
  const ok = await runHerbQuestsIfAvailable(page);
  console.log('результат: ' + ok);
  console.log('HP после: ' + (await hp()));
  await ctx.close();
})();
