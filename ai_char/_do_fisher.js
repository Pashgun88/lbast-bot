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
  const give = (await nav()).find((a) => /Отдать еду/.test(a.t));
  if (give) {
    await page.goto(new URL(give.h, 'http://lbast.ru/').href, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await sleep(1300);
    console.log('ПОСЛЕ «Отдать еду»:\n' + (await m.getBodyText(page)).replace(/[ \t]+/g, ' ').slice(0, 700));
  } else {
    console.log('кнопки «Отдать еду» на экране нет; экран: ' + (await m.getBodyText(page)).replace(/\s+/g, ' ').slice(0, 300));
  }
  // как именно выглядит ссылка коня на Ивовое озеро
  await page.goto('http://lbast.ru/location.php?mod=konj', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await sleep(900);
  const rows = await page.$$eval('a', (as) => as.filter((a) => /Ивовое/.test(a.textContent || ''))
    .map((a) => ({ text: a.textContent, inner: a.innerText, codes: Array.from((a.innerText || '').slice(0, 4)).map((ch) => ch.charCodeAt(0)) })));
  console.log('\nссылка коня «Ивовое озеро»: ' + JSON.stringify(rows));
  await ctx.close();
})();
