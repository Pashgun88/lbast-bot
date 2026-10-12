const { chromium } = require('playwright');
const m = require('./module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  const nav = async () => {
    const xs = await page.$$eval('a', (as) => as.map((a) => ({ t: (a.textContent || '').trim().replace(/\s+/g, ' '), h: a.getAttribute('href') || '' }))).catch(() => []);
    return xs.filter((a) => a.t);
  };
  await page.goto('http://lbast.ru/zhg_web.php?bid=46884', { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
  await sleep(1000);
  for (let p = 1; p <= 10; p++) {
    const t = (await m.getBodyText(page).catch(() => '')).replace(/[ \t]+/g, ' ');
    const hit = /аренд|сдам|прода|цена|цены|точк/i.test(t);
    console.log(`\n--- стр. ${p} --- похоже на торговую запись: ${hit} | ${t.length} симв.`);
    if (hit) {
      for (const line of t.split('\n')) if (/аренд|сдам|прода|цена|цены|точк|дин/i.test(line)) console.log('   > ' + line.trim().slice(0, 200));
    }
    const next = (await nav()).find((a) => /Направо|Дальше|»/.test(a.t) && !/Все блоги/.test(a.t));
    if (!next) { console.log('страниц больше нет'); break; }
    await page.goto(new URL(next.h, 'http://lbast.ru/').href, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await sleep(900);
  }
  await ctx.close();
})();
