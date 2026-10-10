const { chromium } = require('playwright');
const m = require('./module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  const txt = async () => (await m.getBodyText(page)).replace(/\s+/g, ' ');
  await page.goto('http://lbast.ru/inv.php?mod=outfit', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(800);
  const st = await page.evaluate(() => {
    const a = Array.from(document.querySelectorAll('a')).find((x) => /^Статы$/i.test((x.innerText || '').trim()));
    return a ? a.getAttribute('href') : null;
  });
  console.log('ссылка Статы:', st);
  await page.goto(new URL(st, 'http://lbast.ru/').href, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(1000);
  console.log('--- СТАТЫ ---\n' + (await txt()).slice(0, 1600));
  const forms = await page.evaluate(() => Array.from(document.querySelectorAll('a'))
    .map((a) => `${(a.innerText || '').trim()} [${a.getAttribute('href')}]`).filter((s) => s.trim().length > 2));
  console.log('ссылки:', forms.join(' | ').slice(0, 900));
  await ctx.close();
})();
