const { chromium } = require('playwright');
const m = require('./module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  await page.goto('http://lbast.ru/zhg.php', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(500);
  const l = await page.$$eval('a', (as) => as.map((a) => ({ t: (a.textContent || '').trim(), h: a.getAttribute('href') || '' })));
  const s = l.find((a) => /Поиск/i.test(a.t));
  console.log('поиск: ' + JSON.stringify(s));
  await page.goto(new URL(s.h, 'http://lbast.ru/zhg.php').href, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(600);
  console.log((await m.getBodyText(page)).replace(/[ \t]+/g, ' ').slice(0, 800));
  const forms = await page.$$eval('form', (fs) => fs.map((f) => f.getAttribute('action') + ' :: ' + Array.from(f.querySelectorAll('input,select,textarea')).map((i) => i.tagName + '[' + i.getAttribute('name') + ']=' + (i.getAttribute('value') || '')).join(',')));
  console.log('ФОРМЫ: ' + JSON.stringify(forms));
  await ctx.close();
})();
