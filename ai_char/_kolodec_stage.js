const { chromium } = require('playwright');
const m = require('./module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  for (const u of ['pers.php?mod=questinfo&qid=5076', 'pers.php?mod=dnevnik', 'location.php?mod=quests']) {
    await page.goto('http://lbast.ru/' + u, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(800);
    const t = (await m.getBodyText(page)).replace(/\s+/g, ' ');
    console.log(`\n--- ${u} ---\n${t.slice(0, 900)}`);
  }
  await ctx.close();
})();
