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
    const place = (t.match(/D\d+ (.{0,45})/) || [, '?'])[1];
    console.log(`\n[${label}] ${place}\n   >> ` + l.map((a) => a.t).join(' | '));
    if (/женщин|Велана|девочк|мальчик|ребен|ребён|дет/i.test(t + l.map((a) => a.t).join(' '))) console.log('   *** ТУТ ЧТО-ТО ПРО ЖЕНЩИНУ/ДЕТЕЙ: ' + t.slice(0, 700));
    return l;
  };
  // от северных ворот Стоунгарда и дальше на север, пока дорога идёт
  await page.goto('http://lbast.ru/location.php?mod=fastway&lway=2', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(2200);
  const click = async (re) => {
    const a = (await nav()).find((x) => re.test(x.t));
    if (!a) return false;
    await page.goto(new URL(a.h, 'http://lbast.ru/').href, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await sleep(1000); return true;
  };
  await click(/Северные ворота/); await click(/^Идти на север/);
  for (let i = 1; i <= 8; i++) {
    if (!(await click(/^Идти на север$/))) { console.log('дальше на север дороги нет'); break; }
    const l = await dump('север ' + i);
    // заглянем на восток/запад с каждой точки
    for (const d of [/^Идти на восток$/, /^Идти на запад$/]) {
      const a = (await nav()).find((x) => d.test(x.t));
      if (!a) continue;
      await page.goto(new URL(a.h, 'http://lbast.ru/').href, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
      await sleep(900);
      await dump('север ' + i + ' ' + d.source);
      await page.goBack().catch(() => {}); await sleep(800);
    }
  }
  await ctx.close();
})();
