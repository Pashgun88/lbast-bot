const { chromium } = require('playwright');
const m = require('./module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  const txt = async () => (await m.getBodyText(page)).replace(/\s+/g, ' ');
  const go = async (re, label, lim = 1500) => {
    const h = await page.evaluate((src) => {
      const r = new RegExp(src, 'i');
      const a = Array.from(document.querySelectorAll('a')).find((x) => r.test((x.innerText || '').trim()));
      return a ? a.getAttribute('href') : null;
    }, re);
    if (!h) { console.log(`НЕТ «${label}»`); return false; }
    await page.goto(new URL(h, page.url()).href, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(900);
    console.log(`--- ${label} ---\n` + (await txt()).slice(0, lim));
    return true;
  };
  await page.goto('http://lbast.ru/inv.php?mod=lease', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(800);
  await go('^Вы арендовали вещи$', 'ВЫ АРЕНДОВАЛИ / ПРЕДЛОЖЕНИЯ', 2000);
  // письма
  await page.goto('http://lbast.ru/pers.php?mod=mail', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(900);
  console.log('--- ПИСЬМА ---\n' + (await txt()).slice(0, 1500));
  await ctx.close();
})();
