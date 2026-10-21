const { chromium } = require('playwright');
const { getBodyText } = require('./module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  for (const [label, url] of [['ИНФРАСТРУКТУРА','goroda.php?mod=objects'],['О ГОРОДЕ','goroda.php?mod=gor_spravka'],['ОТЧЕТНОСТЬ','goroda.php?mod=loggordeyayelnost']]) {
    await page.goto('http://lbast.ru/' + url, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(()=>{});
    await sleep(800);
    const t = (await getBodyText(page).catch(()=>'')).replace(/[ \t]+/g,' ');
    console.log(`\n=== ${label} ===\n` + t.slice(0, 2200));
    const links = await page.$$eval('a', (as) => as.map((a) => `«${(a.innerText||'').trim()}» -> ${a.getAttribute('href')}`));
    console.log('--- ссылки: ' + links.filter(l=>!/Обновить|В чат|В игру/.test(l)).join(' | '));
  }
  await ctx.close();
})();
