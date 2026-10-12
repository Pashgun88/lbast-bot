const { chromium } = require('playwright');
const m = require('./module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  await page.goto('http://lbast.ru/loc.php?obj=5022', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(1100);
  const t = (await m.getBodyText(page)).replace(/[ \t]+/g, ' ');
  console.log('=== РАЗГОВОР С ЖЕНЩИНОЙ ===\n' + t.slice(0, 3000));
  const l = await page.$$eval('a', (as) => as.map((a) => (a.textContent || '').trim().replace(/\s+/g, ' ') + ' -> ' + (a.getAttribute('href') || '')));
  console.log('\nССЫЛКИ:\n' + l.filter((s) => !/Чат|Форум|ЖГ|Карта|Кланы|Бои|Амулет|Конь|Выход|Размер|Кто здесь/.test(s)).join('\n'));
  await ctx.close();
})();
