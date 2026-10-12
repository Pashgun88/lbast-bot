const { chromium } = require('playwright');
const m = require('./module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  for (const w of ['школ', 'титаны', 'тита']) {
    for (const mv of [0, 1]) {
      await page.goto('http://lbast.ru/map.php?mv=' + mv + '&go=search&look=' + encodeURIComponent(w), { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
      await sleep(500);
      const t = (await m.getBodyText(page).catch(() => '')).replace(/[ \t]+/g, ' ');
      const body = t.split('Замки NPC Всё').pop().split('1. Введите')[0].trim();
      console.log(`[${w} mv=${mv}] ` + (body.replace(/\s+/g, ' ').slice(0, 600) || '-'));
    }
  }
  await ctx.close();
})();
