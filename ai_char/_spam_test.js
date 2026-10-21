// Разовая проверка рассылки: строка настоящая и полезная (ближайший аукцион), а не «тест».
const { chromium } = require('playwright');
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  const aw = require('./lib/auction_watch');
  const mod = require('fs').readFileSync('./lib/auction_watch.js', 'utf8');
  // sendSpam не экспортирован - зовём через внутренний путь: повторяем шаги вручную тем же кодом.
  const text = 'Аукцион Аптекаря в Городе Мастеров 23.10 в 18:31';
  await page.goto('http://lbast.ru/letters.php?mod=clan_spam&go=create', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.locator('input[name="mess"]').fill(text);
  const from = await page.$eval('select[name="from_lev"]', (s) => s.options[0].value);
  const to = await page.$eval('select[name="to_lev"]', (s) => s.options[s.options.length - 1].value);
  await page.selectOption('select[name="from_lev"]', from);
  await page.selectOption('select[name="to_lev"]', to);
  console.log(`уровни ${from}-${to}, текст: ${text}`);
  await Promise.all([
    page.waitForLoadState('domcontentloaded'),
    page.locator('input[type="submit"]').first().click(),
  ]);
  const { getBodyText } = require('./module');
  console.log('ответ: ' + (await getBodyText(page).catch(()=>'')).replace(/\s+/g,' ').slice(0, 400));
  await page.goto('http://lbast.ru/letters.php?mod=clan_spam', { waitUntil: 'domcontentloaded', timeout: 60000 });
  console.log('доска: ' + (await getBodyText(page).catch(()=>'')).replace(/\s+/g,' ').slice(0, 500));
  await ctx.close();
})();
