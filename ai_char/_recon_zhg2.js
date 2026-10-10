const { chromium } = require('playwright');
const m = require('./module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  const txt = async () => (await m.getBodyText(page)).replace(/\s+/g, ' ');
  await page.goto('http://lbast.ru/zhg.php?mod=last', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(900);
  const trade = await page.evaluate(() => {
    const a = Array.from(document.querySelectorAll('a')).find((x) => /^Торговые$/i.test((x.innerText || '').trim()));
    return a ? a.getAttribute('href') : null;
  });
  console.log('Торговые:', trade);
  await page.goto(new URL(trade, 'http://lbast.ru/').href, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(1000);
  console.log('--- ТОРГОВЫЕ ---\n' + (await txt()).slice(0, 1500));
  const z = await page.evaluate(() => Array.from(document.querySelectorAll('a'))
    .filter((x) => /zlata/i.test((x.innerText || '')))
    .map((x) => `${(x.innerText || '').trim()} [${x.getAttribute('href')}]`));
  console.log('zlata:', z.join(' | ') || 'не найдена');
  await ctx.close();
})();
