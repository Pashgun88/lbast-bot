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
  await page.goto('http://lbast.ru/zhg.php?mod=last&c=1', { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
  await sleep(1000);
  for (let p = 1; p <= 8; p++) {
    const t = (await m.getBodyText(page).catch(() => '')).replace(/[ \t]+/g, ' ');
    const byZlata = /by zlata/i.test(t);
    const titles = t.split('\n').filter((s) => s.trim()).slice(3, 50).join(' | ');
    console.log(`\n--- страница ${p} --- zlata здесь: ${byZlata}`);
    if (byZlata) { console.log(t.slice(0, 2000)); break; }
    const next = (await nav()).find((a) => /Направо/.test(a.t));
    if (!next) { console.log('дальше страниц нет'); break; }
    await page.goto(new URL(next.h, 'http://lbast.ru/').href, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await sleep(900);
  }
  await ctx.close();
})();
