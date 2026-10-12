const { chromium } = require('playwright');
const m = require('./module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SKIP = /Чат|Форум|ЖГ|Карта|Кланы|Бои|Амулет|Aмулет|Конь|Выход|Размер|Кто здесь|Обновить|В игру|Галерея|статы|AI__|^Q\d|^D\d/;
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  const cities = [[2, 'Стоунгард'], [3, 'Эвилгард'], [6, 'Брейнрок'], [5, 'Хольмгард'], [8, 'Девтаун'], [4, 'Кулак Хаоса'], [7, 'Форт Жженого листа'], [9, 'Дорожный крест']];
  for (const [lway, name] of cities) {
    await page.goto('http://lbast.ru/location.php?mod=fastway&lway=' + lway, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    await sleep(1200);
    const seen = [];
    const grab = async (tag) => {
      const l = await page.$$eval('a', (as) => as.map((a) => ({ t: (a.textContent || '').trim(), h: a.getAttribute('href') || '' })));
      for (const a of l) if (a.t && !SKIP.test(a.t)) seen.push(tag + ': ' + a.t + ' -> ' + a.h);
    };
    await grab('центр');
    for (const idem of [5, 6, 7, 8]) {
      await page.goto('http://lbast.ru/location.php?idem=' + idem, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
      await sleep(700);
      await grab('idem' + idem);
      // возврат в центр города телепортом, чтобы не уйти далеко
      await page.goto('http://lbast.ru/location.php?mod=fastway&lway=' + lway, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
      await sleep(900);
    }
    const uniq = [...new Set(seen)];
    const hit = uniq.filter((s) => /итан|школ|Школ/i.test(s));
    console.log('\n### ' + name + ' (' + uniq.length + ' ссылок)' + (hit.length ? '  *** НАЙДЕНО: ' + hit.join(' | ') : ''));
    console.log(uniq.join('\n'));
  }
  await ctx.close();
})();
