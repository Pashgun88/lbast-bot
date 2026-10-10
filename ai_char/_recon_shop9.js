const { chromium } = require('playwright');
const m = require('./module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  const txt = async () => (await m.getBodyText(page)).replace(/\s+/g, ' ');
  await page.goto('http://lbast.ru/shop.php', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(900);
  console.log('--- ЛАВКА ---\n' + (await txt()).slice(0, 900));
  const links = await page.evaluate(() => Array.from(document.querySelectorAll('a'))
    .map((a) => `${(a.innerText || '').trim()} [${a.getAttribute('href')}]`).filter((s) => s.trim().length > 2));
  console.log('разделы:', links.join(' | ').slice(0, 1100));
  await ctx.close();
})();
