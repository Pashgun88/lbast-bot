const { chromium } = require('playwright');
const m = require('./module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  await page.goto('http://lbast.ru/location.php?mod=konj', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(700);
  const l = await page.$$eval('a', (as) => as.map((a) => ({ t: (a.textContent || '').trim(), h: a.getAttribute('href') || '' })));
  console.log('КОНЬ: ' + l.filter((a) => /lway=/.test(a.h)).map((a) => a.t + '->' + a.h).join('\n'));
  await ctx.close();
})();
