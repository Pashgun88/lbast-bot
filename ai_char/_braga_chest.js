const { chromium } = require('playwright');
const m = require('./module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  await page.goto('http://lbast.ru/location.php?mod=fastway&lway=4', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(1500);
  const fortHref = await page.evaluate(() => {
    const a = Array.from(document.querySelectorAll('a')).find((x) => /^Форпост$/i.test((x.innerText || '').trim()));
    return a ? a.getAttribute('href') : null;
  }).catch(() => null);
  await page.goto('http://lbast.ru/' + String(fortHref).replace(/^\//, ''), { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(700);
  await page.goto('http://lbast.ru/dom.php?mod=inhouse&dom_id=34313', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(700);
  const chest = await page.evaluate(() => {
    const a = Array.from(document.querySelectorAll('a')).find((x) => /^Сундук$/i.test((x.innerText || '').trim()));
    return a ? a.getAttribute('href') : null;
  });
  console.log('сундук:', chest);
  await page.goto(new URL(chest, page.url()).href, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(900);
  const t = (await m.getBodyText(page)).replace(/\s+/g, ' ');
  console.log('СУНДУК:', t.slice(0, 1200));
  await ctx.close();
})();
