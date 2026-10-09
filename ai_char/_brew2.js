const { chromium } = require('playwright');
const m = require('./module');
const brewing = require('./lib/brewing');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const HOUSE_ID = 34313;
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  // в Кулак Хаоса и в дом
  await page.goto('http://lbast.ru/location.php?mod=fastway&lway=4', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(1500);
  const fortHref = await page.evaluate(() => {
    const a = Array.from(document.querySelectorAll('a')).find((x) => /^Форпост$/i.test((x.innerText || '').trim()));
    return a ? a.getAttribute('href') : null;
  }).catch(() => null);
  console.log('Форпост:', fortHref);
  if (!fortHref) { console.log('нет ссылки Форпост:', (await m.getBodyText(page)).replace(/\s+/g, ' ').slice(0, 300)); await ctx.close(); return; }
  await page.goto('http://lbast.ru/' + fortHref.replace(/^\//, ''), { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(800);
  for (let i = 0; i < 2; i++) {
    const left = await brewing.brewBragaInHouse(page, `http://lbast.ru/dom.php?mod=inhouse&dom_id=${HOUSE_ID}`, 999, 0);
    await sleep(800);
  }
  await page.goto('http://lbast.ru/inv.php?pack=1', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(600);
  const t = await m.getBodyText(page);
  console.log('в сумке:', (t.match(/[^\n]*(Хмель|[Бб]рага)[^\n]*/g) || []).join(' | '));
  await ctx.close();
})();
