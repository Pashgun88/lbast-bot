const { chromium } = require('playwright');
const m = require('./module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BASE = 'http://lbast.ru/';
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  const links = async () => page.$$eval('a', (as) => as.map((a) => ({ t: (a.textContent || '').trim(), h: a.getAttribute('href') || '' })));
  await page.goto(BASE + 'location.php', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(600);
  const l0 = await links();
  console.log('--- ТЕКУЩАЯ ЛОКАЦИЯ, ВСЕ ССЫЛКИ ---');
  for (const a of l0) if (a.t) console.log(`  ${a.t}  ->  ${a.h}`);
  await ctx.close();
})();
