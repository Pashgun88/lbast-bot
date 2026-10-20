const { chromium } = require('playwright');
const { getBodyText } = require('./module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  await page.goto('http://lbast.ru/shop.php?flag=clan_shop', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(()=>{});
  await sleep(900);
  console.log('=== КЛАНОВЫЙ МАГАЗИН ===\n' + (await getBodyText(page).catch(()=>'')).replace(/[ \t]+/g,' ').slice(0, 3000));
  const links = await page.$$eval('a', (as) => as.map((a) => `«${(a.innerText||'').trim()}» -> ${a.getAttribute('href')}`));
  console.log('\n--- ссылки ---\n' + links.slice(0, 60).join('\n'));
  await ctx.close();
})();
