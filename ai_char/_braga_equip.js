const { chromium } = require('playwright');
const m = require('./module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  await page.goto('http://lbast.ru/pers.php', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(800);
  const eq = await page.evaluate(() => {
    const a = Array.from(document.querySelectorAll('a')).find((x) => /Экипировка/i.test((x.innerText || '').trim()));
    return a ? a.getAttribute('href') : null;
  });
  console.log('ссылка экипировки:', eq);
  await page.goto(new URL(eq, page.url()).href, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(900);
  const t = (await m.getBodyText(page)).replace(/\s+/g, ' ');
  console.log('ЭКИПИРОВКА:', t.slice(0, 1400));
  console.log('брага в экипировке?', /браг/i.test(t));
  await ctx.close();
})();
