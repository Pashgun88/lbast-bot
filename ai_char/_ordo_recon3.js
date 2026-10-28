const { chromium } = require('playwright');
const { getBodyText } = require('./module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  // Башня уже открыта предыдущей разведкой; обновляем её по obj (находясь на месте)
  await page.goto('http://lbast.ru/loc.php?obj=5100', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  await sleep(700);
  const t0 = (await getBodyText(page).catch(() => '')).replace(/[ \t]+/g, ' ');
  if (!/ОРДО ЭКЗЕКУТОРС/i.test(t0)) { console.log('не в башне: ' + t0.slice(0, 200)); await ctx.close(); return; }
  // go=2 - «Доложить о выполнении задания». Если не выполнено, игра просто откажет.
  const h = await page.evaluate(() => {
    const a = Array.from(document.querySelectorAll('a')).find((x) => /Доложить о выполнении/i.test(x.textContent || ''));
    return a ? a.getAttribute('href') : null;
  });
  console.log('ссылка доклада: ' + h);
  await page.goto(new URL(h, 'http://lbast.ru/').href, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  await sleep(900);
  const t1 = (await getBodyText(page).catch(() => '')).replace(/[ \t]+/g, ' ');
  console.log('=== ОТВЕТ НА ДОКЛАД ===\n' + t1.slice(0, 1200));
  await ctx.close();
})();
