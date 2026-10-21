const { chromium } = require('playwright');
const { getBodyText } = require('./module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  for (const [label, url] of [['АУКЦИОН','loc.php?obj=5116&flag=100&mod=auction'],['О ГОРОДЕ','loc.php?obj=5116&flag=100&mod=help']]) {
    await page.goto('http://lbast.ru/' + url, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(()=>{});
    await sleep(900);
    console.log(`\n=== ${label} (${url}) ===\n` + (await getBodyText(page).catch(()=>'')).replace(/[ \t]+/g,' ').slice(0, 3500));
    const links = await page.$$eval('a', (as) => as.map((a) => `«${(a.innerText||'').trim()}» -> ${a.getAttribute('href')}`));
    console.log('--- ссылки: ' + links.join(' | '));
  }
  await ctx.close();
})();
