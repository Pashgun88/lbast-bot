const { chromium } = require('playwright');
const m = require('./module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  const go = async (u, label) => {
    await page.goto(u, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch((e) => console.log(label + ' ERR ' + e.message));
    await sleep(700);
    const t = (await m.getBodyText(page).catch(() => '')).replace(/[ \t]+/g, ' ');
    console.log('\n=== ' + label + ' ===' + (/итан/i.test(t) ? ' <<< ТИТАН В ТЕКСТЕ' : ''));
    console.log(t.slice(0, 3000));
  };
  await go('http://lbast.ru/map.php?spl=1', 'ПРОХОЖДЕНИЯ КВЕСТОВ');
  // праздничные квесты
  await page.goto('http://lbast.ru/pers.php?mod=questinfo', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(500);
  const l = await page.$$eval('a', (as) => as.map((a) => ({ t: (a.textContent || '').trim(), h: a.getAttribute('href') || '' })));
  const hol = l.find((a) => /Смотреть список/i.test(a.t));
  console.log('\nпраздничные: ' + JSON.stringify(hol));
  if (hol) await go(new URL(hol.h, 'http://lbast.ru/pers.php').href, 'ПРАЗДНИЧНЫЕ');
  await ctx.close();
})();
