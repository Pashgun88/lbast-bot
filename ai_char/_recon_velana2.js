const { chromium } = require('playwright');
const m = require('./module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SKIP = /Чат|Форум|ЖГ|^Карта|Кланы|^Бои|Амулет|Aмулет|Конь|Выход|Размер|Кто здесь|Галерея|статы|AI__|^Q\d|^D\d|Обновить|Памятник|Мемориальная|Стела/;
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  const nav = async () => (await page.$$eval('a', (as) => as.map((a) => ({ t: (a.textContent || '').trim().replace(/\s+/g, ' '), h: a.getAttribute('href') || '' })))).filter((a) => a.t);
  const dump = async (label) => {
    const t = (await m.getBodyText(page).catch(() => '')).replace(/\s+/g, ' ');
    const l = (await nav()).filter((a) => !SKIP.test(a.t));
    console.log('\n--- ' + label + ' ---\n' + t.slice(0, 600) + '\n>> ' + l.map((a) => a.t + ' -> ' + a.h).join(' | '));
    return l;
  };
  const click = async (re, label) => {
    const a = (await nav()).find((x) => re.test(x.t));
    if (!a) { console.log('НЕТ ' + label); return false; }
    await page.goto(new URL(a.h, 'http://lbast.ru/').href, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await sleep(1100); return true;
  };
  await page.goto('http://lbast.ru/location.php?mod=fastway&lway=2', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(2200);
  await click(/Северные ворота/, 'Северные ворота'); await dump('Северные ворота');
  await click(/^Идти на север/, 'на север'); const l = await dump('Северный тракт?');
  // шаг дальше по каждому направлению в поисках женщины
  for (const a of l.filter((x) => /^Идти/.test(x.t))) {
    await page.goto(new URL(a.h, 'http://lbast.ru/').href, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
    await sleep(1000);
    await dump('тракт -> ' + a.t);
    await page.goBack().catch(() => {}); await sleep(900);
  }
  await ctx.close();
})();
