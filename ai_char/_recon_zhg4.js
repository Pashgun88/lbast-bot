const { chromium } = require('playwright');
const m = require('./module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  const txt = async () => (await m.getBodyText(page)).replace(/\s+/g, ' ');
  await page.goto('http://lbast.ru/zhg.php?mod=last', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(700);
  const s = await page.evaluate(() => {
    const a = Array.from(document.querySelectorAll('a')).find((x) => /^Поиск$/i.test((x.innerText || '').trim()));
    return a ? a.getAttribute('href') : null;
  });
  await page.goto(new URL(s, 'http://lbast.ru/').href, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(700);
  await page.fill('input[name="blogin"]', 'zlata');
  await page.click('input[type="submit"]');
  await sleep(1400);
  console.log('--- РЕЗУЛЬТАТ ПОИСКА ---\n' + (await txt()).slice(0, 1200));
  const links = await page.evaluate(() => Array.from(document.querySelectorAll('a'))
    .map((a) => `${(a.innerText || '').trim()} [${a.getAttribute('href')}]`)
    .filter((s) => /bid=|st_id=/.test(s)));
  console.log('ссылки блога:', links.join(' | ').slice(0, 600));
  await ctx.close();
})();
