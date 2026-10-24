const { chromium } = require('playwright');
const { getBodyText } = require('./module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  const want = /зуб горгул|череп|крыло василиск|язык призрачн|лист змеевик/i;
  for (const u of ['inv.php','inv.php?cpage=2','inv.php?cpage=3','inv.php?cpage=4']) {
    await page.goto('http://lbast.ru/' + u, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(()=>{});
    await sleep(500);
    const t = (await getBodyText(page).catch(()=>'')).replace(/[ \t]+/g,' ');
    const hits = t.split('\n').filter((l) => want.test(l));
    if (hits.length) console.log(`[${u}] ` + hits.join(' ; '));
  }
  await ctx.close();
})();
