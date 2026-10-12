const { chromium } = require('playwright');
const m = require('./module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  await page.goto('http://lbast.ru/location.php?mod=fastway', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(700);
  console.log((await m.getBodyText(page)).replace(/[ \t]+/g, ' ').slice(0, 2500));
  const l = await page.$$eval('a', (as) => as.map((a) => (a.textContent || '').trim() + ' -> ' + (a.getAttribute('href') || '')));
  console.log('\n--- ССЫЛКИ ---\n' + l.filter((s) => s.length > 4).join('\n').slice(0, 2500));
  await ctx.close();
})();
