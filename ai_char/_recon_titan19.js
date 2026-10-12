const { chromium } = require('playwright');
const m = require('./module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  await page.goto('http://lbast.ru/location.php?mod=konj&lway=5', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(2000);
  const dump = async (label) => {
    const t = (await m.getBodyText(page).catch(() => '')).replace(/[ \t]+/g, ' ');
    console.log('\n=== ' + label + ' ===\n' + t.slice(0, 1600));
    const l = await page.$$eval('a', (as) => as.map((a) => ({ t: (a.textContent || '').trim(), h: a.getAttribute('href') || '' })));
    console.log('ССЫЛКИ: ' + l.filter((a) => a.t && !/Чат|Форум|ЖГ|Карта|Кланы|^Бои|Амулет|Aмулет|Конь|Выход|Размер|Кто здесь|Галерея|статы|AI__|^Q\d|^D\d/.test(a.t)).map((a) => a.t + '->' + a.h).join(' | '));
    return l;
  };
  await dump('ПОСЛЕ ВЫЕЗДА');
  // дожидаемся прибытия: кликаем "В пути" пока есть
  for (let i = 0; i < 12; i++) {
    const l = await page.$$eval('a', (as) => as.map((a) => (a.textContent || '').trim()));
    const wait = l.find((t) => /^В пути/.test(t));
    if (!wait) break;
    console.log('жду: ' + wait);
    await page.click(`a:has-text("В пути")`).catch(() => {});
    await sleep(8000);
  }
  await dump('ГОРЫ ДАРИИ');
  await ctx.close();
})();
