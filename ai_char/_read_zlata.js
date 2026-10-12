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
  await page.goto('http://lbast.ru/letters.php?mod=in', { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
  await sleep(1000);
  let t = (await m.getBodyText(page).catch(() => '')).replace(/[ \t]+/g, ' ');
  console.log('=== ВХОДЯЩИЕ ===\n' + t.slice(0, 1200));
  const z = (await nav()).find((a) => /zlata/i.test(a.t));
  if (!z) { console.log('письма от zlata в списке не нашёл'); return ctx.close(); }
  await page.goto(new URL(z.h, 'http://lbast.ru/').href, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await sleep(1100);
  t = (await m.getBodyText(page).catch(() => '')).replace(/[ \t]+/g, ' ');
  console.log('\n=== ПЕРЕПИСКА С ZLATA ===\n' + t.slice(0, 2500));
  await ctx.close();
})();
