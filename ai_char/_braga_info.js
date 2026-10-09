const { chromium } = require('playwright');
const m = require('./module');
const brewing = require('./lib/brewing');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const HOUSE_ID = 34313;
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
  await brewing.brewBragaInHouse(page, `http://lbast.ru/dom.php?mod=inhouse&dom_id=${HOUSE_ID}`, 999, 0);
  await sleep(800);
  await page.goto('http://lbast.ru/inv.php?pack=1', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(700);
  const t = await m.getBodyText(page);
  console.log('строки с брагой:', (t.match(/[^\n]*[Бб]раг[^\n]*/g) || []).join(' | '));
  // ссылка на сам предмет: ищем «Брага»
  const items = await page.evaluate(() => Array.from(document.querySelectorAll('a'))
    .map((a) => ({ t: (a.innerText || '').trim(), h: a.getAttribute('href') || '' }))
    .filter((x) => /брага/i.test(x.t)));
  console.log('ссылки предмета:', JSON.stringify(items));
  for (const it of items.slice(0, 2)) {
    await page.goto(new URL(it.h, page.url()).href, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(700);
    console.log(`ОПИСАНИЕ «${it.t}»:`, (await m.getBodyText(page)).replace(/\s+/g, ' ').slice(0, 700));
  }
  await ctx.close();
})();
