const { chromium } = require('playwright');
const m = require('./module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  const main = async (label) => {
    await page.goto('http://lbast.ru/loc.php?obj=5198', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await sleep(900);
    const t = (await m.getBodyText(page)).replace(/[ \t]+/g, ' ');
    console.log('\n[' + label + ']' + (t.split('усами.')[1] || t).slice(0, 500));
  };
  await main('перезаход 1');
  await page.goto('http://lbast.ru/loc.php?obj=5198&go=2', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await sleep(1000);
  console.log('\n=== НАВЫКИ ЗАЩИТЫ ===\n' + (await m.getBodyText(page)).replace(/[ \t]+/g, ' ').slice(0, 2200));
  const l = await page.$$eval('a', (as) => as.map((a) => (a.textContent || '').trim().replace(/\s+/g, ' ') + ' -> ' + (a.getAttribute('href') || '')));
  console.log('\nССЫЛКИ В СПИСКЕ:\n' + l.filter((s) => !/Чат|Форум|ЖГ|Карта|Кланы|Бои|Амулет|Конь|Выход|Размер|Кто здесь|Обновить|В игру/.test(s)).join('\n').slice(0, 1500));
  await main('перезаход 2');
  await ctx.close();
})();
