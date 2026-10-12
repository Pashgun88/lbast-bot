const { chromium } = require('playwright');
const m = require('./module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  const search = async (w) => {
    await page.goto('http://lbast.ru/map.php?mv=0&go=search#searchbar', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await sleep(400);
    const inp = await page.$('input[name="look"]');
    await inp.fill(w); await inp.press('Enter');
    await sleep(1200);
    const t = (await m.getBodyText(page).catch(() => '')).replace(/[ \t]+/g, ' ');
    const body = (t.split('Замки NPC Всё').pop() || '').split('1. Введите')[0].replace(/\s+/g, ' ').trim();
    console.log(`\n=== [${w}] ===\n` + body.slice(0, 3000));
    const ll = await page.$$eval('a', (as) => as.map((a) => (a.textContent || '').trim() + ' -> ' + (a.getAttribute('href') || '')));
    console.log('ССЫЛКИ: ' + ll.filter((s) => !/Вернуться в игру|карту|глобальную|Амулет и конь|Календарь|Прохождения|Боты ->|Магазины|Квесты ->|Объекты|Травы|Топонимы|Замки|NPC|Всё ->|Свернуть/.test(s)).join(' | ').slice(0, 1500));
  };
  await search('титан');
  await search('43');
  await ctx.close();
})();
