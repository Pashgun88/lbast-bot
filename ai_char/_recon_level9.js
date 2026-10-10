// Разведка под 9 уровень: статы, экипировка, предложения аренды.
const { chromium } = require('playwright');
const m = require('./module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  const txt = async () => (await m.getBodyText(page)).replace(/\s+/g, ' ');
  await page.goto('http://lbast.ru/pers.php', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(800);
  console.log('--- АНКЕТА ---\n' + (await txt()).slice(0, 1100));
  const go = async (re, label) => {
    const h = await page.evaluate((src) => {
      const r = new RegExp(src, 'i');
      const a = Array.from(document.querySelectorAll('a')).find((x) => r.test((x.innerText || '').trim()));
      return a ? a.getAttribute('href') : null;
    }, re);
    if (!h) { console.log(`НЕТ «${label}»`); return false; }
    await page.goto(new URL(h, page.url()).href, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(900);
    console.log(`--- ${label} ---\n` + (await txt()).slice(0, 1600));
    return true;
  };
  await go('^Статы$', 'СТАТЫ');
  await page.goto('http://lbast.ru/inv.php?mod=outfit', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(800);
  console.log('--- ЭКИПИРОВКА ---\n' + (await txt()).slice(0, 1400));
  await page.goto('http://lbast.ru/inv.php?mod=lease', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(900);
  console.log('--- АРЕНДА ---\n' + (await txt()).slice(0, 1800));
  console.log('ссылки аренды: ' + (await page.evaluate(() => Array.from(document.querySelectorAll('a')).map((a) => (a.innerText || '').trim()).filter(Boolean).join(' | '))).slice(0, 700));
  await ctx.close();
})();
