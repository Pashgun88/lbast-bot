const { chromium } = require('playwright');
const { getBodyText } = require('./module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  for (const [label, go] of [['КУМУС (правила?)',10],['TOP-20',5],['ЛИДЕРЫ ДНЯ',3],['ИСТОРИЯ ИГР',4]]) {
    await page.goto(`http://lbast.ru/loc.php?obj=5229&go=${go}`, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(()=>{});
    await sleep(800);
    const t = (await getBodyText(page).catch(()=>'')).replace(/[ \t]+/g,' ');
    console.log(`\n================ ${label} (go=${go}) ================\n` + t.slice(0, 2200));
  }
  await ctx.close();
})();
