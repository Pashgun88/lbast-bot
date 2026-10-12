const { chromium } = require('playwright');
const m = require('./module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  await page.goto('http://lbast.ru/map.php', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(600);
  const links = await page.$$eval('a', (as) => as.map((a) => ({ t: (a.textContent || '').trim(), h: a.getAttribute('href') || '' })));
  console.log(JSON.stringify(links, null, 0).slice(0, 2500));
  const html = await page.content();
  console.log('\n--- есть ли титан в html карты: ' + /итан/i.test(html));
  const forms = await page.$$eval('form', (fs) => fs.map((f) => f.getAttribute('action') + ' :: ' + Array.from(f.querySelectorAll('input,select')).map((i) => i.tagName + '[' + i.getAttribute('name') + ']').join(',')));
  console.log('ФОРМЫ: ' + JSON.stringify(forms));
  await ctx.close();
})();
