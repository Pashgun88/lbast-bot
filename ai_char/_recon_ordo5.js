const { chromium } = require('playwright');
const m = require('./module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  const links = () => page.evaluate(() => Array.from(document.querySelectorAll('a'))
    .map((a) => ({ t: (a.innerText || '').trim(), h: a.getAttribute('href') || '' })).filter((x) => x.t && x.h));
  const dump = async (label) => {
    const t = (await m.getBodyText(page)).replace(/\s+/g, ' ');
    console.log(`\n===== ${label} =====\nURL: ${page.url()}\nТЕКСТ: ${t.slice(0, 1200)}`);
    console.log(`ССЫЛКИ: ${(await links()).map((l) => `${l.t} [${l.h}]`).join(' | ').slice(0, 1000)}`);
  };
  await page.goto('http://lbast.ru/location.php', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(800);
  await dump('где я сейчас');
  const back = (await links()).find((l) => /^Вернуться$/.test(l.t));
  if (back) {
    await page.goto(new URL(back.h, page.url()).href, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(1200);
    await dump('после «Вернуться»');
  }
  await ctx.close();
})();
