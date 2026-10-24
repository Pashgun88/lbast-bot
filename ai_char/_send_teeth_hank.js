// Приказ Паши в клановом зале 24.10.2026: «Кинь Ханку зубы, у тебя много должно быть» + «По 250 кидай».
// Цена в форме - ОБЩАЯ сумма за пачку (урок черепов 21.09.2026).
const { chromium } = require('playwright');
const { getBodyText } = require('./module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const NICK = 'Hank';
const PRICE = 250;
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  const read = async () => {
    for (const u of [`inv.php?lgn=${NICK}`, `inv.php?lgn=${NICK}&cpage=2`, `inv.php?lgn=${NICK}&cpage=3`]) {
      await page.goto('http://lbast.ru/' + u, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(()=>{});
      await sleep(500);
      const row = await page.evaluate(() => {
        const all = Array.from(document.querySelectorAll('a'));
        for (let i = 0; i < all.length; i++) {
          if (!/^Зуб Горгульи$/i.test((all[i].textContent || '').trim())) continue;
          let count = null, pered = null;
          for (let k = i + 1; k < Math.min(i + 6, all.length); k++) {
            const t = (all[k].textContent || '').trim();
            if (/^\d+$/.test(t) && count === null) count = Number(t);
            if (t === 'Передать' && !pered) pered = all[k].getAttribute('href');
          }
          if (pered) return { count: count || 1, pered };
        }
        return null;
      }).catch(() => null);
      if (row) return row;
    }
    return null;
  };
  const row = await read();
  if (!row) { console.log('Зубов в сумке не нашёл - ничего не отправляю.'); await ctx.close(); return; }
  const total = row.count * PRICE;
  console.log(`Зубов ${row.count} шт, цена ${PRICE} за штуку -> общая сумма ${total}`);
  await page.goto(new URL(row.pered, 'http://lbast.ru/').href, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(600);
  await page.locator('input[name="kol"]').fill(String(row.count));
  await page.locator('input[name="price"]').fill(String(total));
  await page.locator('input[name="cmnp"]').fill(`зубы горгульи, ${PRICE} за штуку (по просьбе Tsunami)`).catch(()=>{});
  await Promise.all([
    page.waitForLoadState('domcontentloaded'),
    page.locator('input[type="submit"]').first().click(),
  ]);
  await sleep(900);
  console.log('ответ: ' + (await getBodyText(page).catch(()=>'')).replace(/\s+/g,' ').slice(0, 200));
  // истина - игра: смотрим, что осталось
  const after = await read();
  console.log('на руках после: ' + (after ? after.count : 0));
  await ctx.close();
})();
