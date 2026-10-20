const { chromium } = require('playwright');
const { getBodyText } = require('./module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  await page.goto('http://lbast.ru/inv.php?cpage=2', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(600);
  const href = await page.evaluate(() => {
    const a = Array.from(document.querySelectorAll('a')).find((x) => /эликсир каменного голема/i.test((x.textContent||'').trim()));
    return a ? a.getAttribute('href') : null;
  });
  await page.goto(new URL(href, 'http://lbast.ru/').href, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(600);
  console.log('=== ИНФО ЭЛИКСИРА ===\n' + (await getBodyText(page).catch(()=>'')).replace(/[ \t]+/g,' ').slice(0, 1200));
  await ctx.close();
})();
