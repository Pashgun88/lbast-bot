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
  await page.goto('http://lbast.ru/letters.php?mod=inbox', { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
  await sleep(1200);
  console.log('=== ВХОДЯЩИЕ ===\n' + (await m.getBodyText(page).catch(() => '')).replace(/[ \t]+/g, ' ').slice(0, 1500));
  const l = await nav();
  console.log('\nССЫЛКИ: ' + l.map((a) => '«' + a.t + '»').join(' | ').slice(0, 800));
  const z = l.find((a) => /zlata/i.test(a.t));
  if (z) {
    await page.goto(new URL(z.h, 'http://lbast.ru/').href, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await sleep(1200);
    console.log('\n=== ПЕРЕПИСКА С ZLATA ===\n' + (await m.getBodyText(page)).replace(/[ \t]+/g, ' ').slice(0, 2500));
  }
  await ctx.close();
})();
