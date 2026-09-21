// Разовый прогон «Тайны Мисттоуна» (Паша, 21.09.2026: «сначала это сделай и потом поблагодари Галлу»).
// Лечение до 95% - там, где стоим (в Кулаке быстрее), потом дорога и маршрут mistown_tainy.steps.
const path = require('path');
const { chromium } = require('playwright');
const m = require('../module');
const { runGuide } = require('./guide_run');
const { goToChaosByAmulet } = require('../lib/recovery');
const { goToMisstoneMainStreet } = require('../lib/weekday_dailies');

(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  try {
    await page.goto('http://lbast.ru/location.php', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await goToChaosByAmulet(page);
    await m.waitForHpAbove(page, 475, { waitMs: 3 * 60 * 1000, maxWaits: 20 });
    await page.goto('http://lbast.ru/location.php', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await goToMisstoneMainStreet(page);
    const r = await runGuide(page, path.join(__dirname, 'mistown_tainy.steps'), 0, {});
    console.log('ИТОГ:', JSON.stringify(r));
    console.log((await m.getBodyText(page)).replace(/\s+/g, ' ').slice(0, 400));
  } finally { await ctx.close(); }
})();
