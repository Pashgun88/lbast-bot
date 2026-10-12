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
  await sleep(900);
  const next = (await nav()).find((a) => /Направо|»/.test(a.t) && !/Все блоги/.test(a.t));
  await page.goto(new URL(next.h, 'http://lbast.ru/').href, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await sleep(1000);
  const t = (await m.getBodyText(page).catch(() => ''));
  const i = t.indexOf('Аренда с 8');
  console.log('=== ЗАПИСЬ «АРЕНДА» ===\n' + (i >= 0 ? t.slice(Math.max(0, i - 200), i + 3000) : t.slice(0, 3000)));
  await ctx.close();
})();
