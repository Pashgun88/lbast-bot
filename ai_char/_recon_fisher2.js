const { chromium } = require('playwright');
const m = require('./module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  const nav = async () => {
    const xs = await page.$$eval('a', (as) => as.map((a) => ({ t: (a.textContent || '').trim().replace(/\s+/g, ' '), h: a.getAttribute('href') || '' }))).catch(() => []);
    return xs.filter((a) => a.t);
  };
  const dump = async (label) => {
    const t = (await m.getBodyText(page).catch(() => '')).replace(/[ \t]+/g, ' ');
    const l = (await nav()).filter((a) => !/Чат|Форум|ЖГ|^Карта|Кланы|^Бои|Амулет|Aмулет|Выход|Размер|Кто здесь|Галерея|^Обновить$|статы|^AI__|^Q\d|^D\d|Памятник|Мемориальная/.test(a.t));
    const place = (t.match(/D\d+ ([^\n]{0,50})/) || [, '?'])[1];
    console.log(`\n[${label}] ${place}\n   ТЕКСТ: ` + t.replace(/\s+/g, ' ').slice(0, 400) + '\n   >> ' + l.map((a) => '«' + a.t + '»').join(' | '));
    return l;
  };
  const click = async (re, label) => {
    const a = (await nav()).find((x) => re.test(x.t));
    if (!a) { console.log('НЕТ «' + label + '» — стоп'); return false; }
    await page.goto(new URL(a.h, 'http://lbast.ru/').href, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await sleep(1300); return true;
  };
  await page.goto('http://lbast.ru/location.php?mod=konj&lway=23', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(2000);
  for (let i = 0; i < 12; i++) {
    const t = await m.getBodyText(page).catch(() => '');
    if (!/В пути/i.test(t)) break;
    console.log('в пути...');
    await page.goto(page.url(), { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
    await sleep(4000);
  }
  await dump('Ивовое озеро');
  const route = [[/^Идти на запад$/, 'запад'], [/^Идти на юг$/, 'юг'], [/^Идти на юг$/, 'юг'], [/^Идти на юг$/, 'юг'], [/^Идти на запад$/, 'запад'], [/^Идти на запад$/, 'запад']];
  for (const [re, name] of route) {
    if (!(await click(re, name))) break;
    await dump('после ' + name);
  }
  if (await click(/Войти в лачугу/, 'Войти в лачугу')) await dump('лачуга');
  await ctx.close();
})();
