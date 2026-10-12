const { chromium } = require('playwright');
const m = require('./module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  const nav = async () => {
    const xs = await page.$$eval('a', (as) => as.map((a) => ({ t: (a.textContent || '').trim().replace(/\s+/g, ' '), h: a.getAttribute('href') || '' }))).catch(() => []);
    return xs.filter((a) => a.t);
  };
  await page.goto('http://lbast.ru/zhg.php?blogin=zlata&bid=46884', { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
  await sleep(900);
  const l = await nav();
  const trade = l.find((a) => /Торговые/i.test(a.t));
  console.log('«Торговые»: ' + JSON.stringify(trade));
  if (trade) {
    await page.goto(new URL(trade.h, 'http://lbast.ru/').href, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await sleep(1100);
    const t = (await m.getBodyText(page).catch(() => '')).replace(/[ \t]+/g, ' ');
    console.log('\n=== ТОРГОВЫЕ БЛОГИ ===\n' + t.slice(0, 2000));
    const z = (await nav()).filter((a) => /zlata/i.test(a.t) || /zlata/i.test(a.h));
    console.log('\nzlata в списке: ' + JSON.stringify(z).slice(0, 600));
    if (z.length) {
      await page.goto(new URL(z[0].h, 'http://lbast.ru/').href, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await sleep(1200);
      console.log('\n=== ТОРГОВЫЙ БЛОГ ZLATA ===\n' + (await m.getBodyText(page)).replace(/[ \t]+/g, ' ').slice(0, 4000));
    }
  }
  await ctx.close();
})();
