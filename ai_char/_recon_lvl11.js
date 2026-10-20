const { chromium } = require('playwright');
const m = require('./module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clean = (t) => String(t || '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n');
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  const show = async (label, url, limit = 4000) => {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch((e) => console.log(label + ': ОШИБКА ' + e.message));
    await sleep(800);
    const t = clean(await m.getBodyText(page).catch(() => ''));
    console.log(`\n================ ${label} (${url}) ================\n` + t.slice(0, limit));
  };
  await show('ПЕРСОНАЖ', 'http://lbast.ru/pers.php', 3000);
  await show('СТАТЫ', 'http://lbast.ru/pers.php?mod=stats', 3000);
  await show('ТАТУИРОВКИ', 'http://lbast.ru/pers.php?mod=tatu', 4000);
  await show('ЗЛАТА АРЕНДА 8-16', 'http://lbast.ru/zhg.php?st_id=224968&bid=46884', 9000);
  await ctx.close();
})();
