const { chromium } = require('playwright');
const m = require('./module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  const search = async (w) => {
    await page.goto('http://lbast.ru/map.php?mv=0&go=search#searchbar', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await sleep(500);
    const inp = await page.$('input[name="look"]');
    if (!inp) { console.log('нет поля look'); return; }
    await inp.fill(w);
    await inp.press('Enter');
    await sleep(1200);
    const t = (await m.getBodyText(page).catch(() => '')).replace(/[ \t]+/g, ' ');
    const body = (t.split('Замки NPC Всё').pop() || '').split('1. Введите')[0].replace(/\s+/g, ' ').trim();
    console.log(`\n[${w}] ` + (body.slice(0, 1200) || '-'));
  };
  for (const w of ['Вейлия', 'Молег', 'Дария', 'титан']) await search(w);
  await ctx.close();
})();
