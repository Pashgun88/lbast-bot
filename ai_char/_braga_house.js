const { chromium } = require('playwright');
const m = require('./module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  const say = async (label) => {
    const t = await m.getBodyText(page).catch(() => '');
    const hit = (t.match(/[^\n]*(Брага|браг)[^\n]*/gi) || []).map((x) => x.trim());
    console.log(`${label}: ${hit.join(' | ') || 'браги не видно'}`);
    return t;
  };
  await page.goto('http://lbast.ru/location.php?mod=fastway&lway=4', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(1500);
  const fortHref = await page.evaluate(() => {
    const a = Array.from(document.querySelectorAll('a')).find((x) => /^Форпост$/i.test((x.innerText || '').trim()));
    return a ? a.getAttribute('href') : null;
  }).catch(() => null);
  await page.goto('http://lbast.ru/' + String(fortHref).replace(/^\//, ''), { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(800);
  await page.goto('http://lbast.ru/dom.php?mod=inhouse&dom_id=34313', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(800);
  const t = await say('в доме, экран дома');
  console.log('ссылки дома:', (await page.evaluate(() => Array.from(document.querySelectorAll('a')).map((a) => (a.innerText || '').trim()).filter(Boolean))).join(' | ').slice(0, 500));
  await page.goto('http://lbast.ru/inv.php?pack=1', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(600);
  await say('сумка, стоя в доме');
  await ctx.close();
})();
