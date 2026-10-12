const { chromium } = require('playwright');
const m = require('./module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  for (const mv of [0, 1, 2]) {
    const u = 'http://lbast.ru/map.php?mv=' + mv + '&go=search&look=' + encodeURIComponent('титан');
    await page.goto(u, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch((e) => console.log('ERR ' + e.message));
    await sleep(700);
    const t = (await m.getBodyText(page).catch(() => '')).replace(/[ \t]+/g, ' ');
    console.log('\n=== mv=' + mv + ' ===\n' + t.slice(0, 1800));
    const links = await page.$$eval('a', (as) => as.map((a) => (a.textContent || '').trim() + ' -> ' + (a.getAttribute('href') || '')));
    const hit = links.filter((s) => /итан/i.test(s));
    if (hit.length) console.log('*** ' + hit.join(' | '));
  }
  await ctx.close();
})();
