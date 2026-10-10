const { chromium } = require('playwright');
const m = require('./module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  const txt = async () => (await m.getBodyText(page)).replace(/\s+/g, ' ');
  await page.goto('http://lbast.ru/location.php?mod=fastway&lway=2', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(1500);
  const shop = await page.evaluate(() => {
    const a = Array.from(document.querySelectorAll('a')).find((x) => /^Магазин$/i.test((x.innerText || '').trim()));
    return a ? a.getAttribute('href') : null;
  });
  console.log('магазин:', shop);
  await page.goto(new URL(shop, 'http://lbast.ru/').href, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(1000);
  console.log('--- ЛАВКА ---\n' + (await txt()).slice(0, 700));
  const links = await page.evaluate(() => Array.from(document.querySelectorAll('a'))
    .map((a) => `${(a.innerText || '').trim()} [${a.getAttribute('href')}]`).filter((s) => s.trim().length > 2));
  console.log('разделы:', links.join(' | ').slice(0, 1200));
  await ctx.close();
})();
