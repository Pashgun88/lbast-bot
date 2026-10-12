const { chromium } = require('playwright');
const m = require('./module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  await page.goto('http://lbast.ru/location.php?mod=fastway&lway=2', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(1500);
  const t = (await m.getBodyText(page)).replace(/[ \t]+/g, ' ');
  console.log(t.slice(0, 1800));
  const walk = async (label) => {
    const l = await page.$$eval('a', (as) => as.map((a) => ({ t: (a.textContent || '').trim(), h: a.getAttribute('href') || '' })));
    console.log('\n--- ' + label + ' ---');
    for (const a of l) if (/loc\.php|idem=/.test(a.h) && a.t) console.log(`  ${a.t} -> ${a.h}`);
    return l;
  };
  await walk('СТОУНГАРД центр');
  for (const idem of [1, 2, 3, 4]) {
    await page.goto('http://lbast.ru/location.php?idem=' + idem, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
    await sleep(900);
    const tt = (await m.getBodyText(page).catch(() => '')).replace(/\s+/g, ' ');
    console.log('\n### idem=' + idem + ': ' + tt.slice(0, 400));
    await walk('idem=' + idem);
  }
  await ctx.close();
})();
