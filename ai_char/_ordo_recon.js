// Разведка: почему миссия Ордо «главарь банды» не находит своих шагов. 28.10.2026.
const { chromium } = require('playwright');
const { getBodyText } = require('./module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const links = (page) => page.evaluate(() =>
  Array.from(document.querySelectorAll('a')).map((a) => ({ t: (a.textContent || '').replace(/\s+/g, ' ').trim(), h: a.getAttribute('href') || '' })).filter((x) => x.t));

(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());

  // 1. Что в слоте по анкете
  await page.goto('http://lbast.ru/pers.php', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  await sleep(700);
  const pers = (await getBodyText(page).catch(() => '')).replace(/[ \t]+/g, ' ');
  const slotLines = pers.split('\n').filter((l) => /задани|выполняете|отказ/i.test(l));
  console.log('=== АНКЕТА, про задание ===\n' + slotLines.join('\n'));

  // 2. Едем на миссию тем же маршрутом, что и драйвер
  await page.goto('http://lbast.ru/location.php?mod=konj&lway=q2001_1', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  await sleep(3000);
  for (let i = 0; i < 6; i++) {
    const t = (await getBodyText(page).catch(() => '')).replace(/[ \t]+/g, ' ');
    if (!/в пути|едете/i.test(t)) break;
    console.log('...в пути, жду');
    await sleep(5000);
    await page.goto('http://lbast.ru/location.php', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  }
  const t2 = (await getBodyText(page).catch(() => '')).replace(/[ \t]+/g, ' ');
  console.log('=== ПОСЛЕ КОНЯ q2001_1 ===\nURL: ' + page.url() + '\n' + t2.slice(0, 1600));
  console.log('=== ССЫЛКИ ===\n' + JSON.stringify(await links(page), null, 1));
  await ctx.close();
})();
