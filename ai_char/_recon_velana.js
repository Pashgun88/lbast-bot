const { chromium } = require('playwright');
const m = require('./module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SKIP = /Чат|Форум|ЖГ|^Карта|Кланы|^Бои|Амулет|Aмулет|Конь|Выход|Размер|Кто здесь|Галерея|статы|AI__|^Q\d|^D\d|Обновить|Памятник|Мемориальная/;
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  const srch = async (w) => {
    await page.goto('http://lbast.ru/map.php?mv=0&go=search#searchbar', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await sleep(400);
    const inp = await page.$('input[name="look"]');
    await inp.fill(w); await inp.press('Enter'); await sleep(1200);
    const t = (await m.getBodyText(page).catch(() => '')).replace(/[ \t]+/g, ' ');
    const body = (t.split('Замки NPC Всё').pop() || '').split('1. Введите')[0].replace(/\s+/g, ' ').trim();
    console.log(`[${w}] ` + body.slice(0, 700));
  };
  await srch('Велана');
  await srch('Северный тракт');
  await srch('122');
  const dump = async (label) => {
    const t = (await m.getBodyText(page).catch(() => '')).replace(/\s+/g, ' ');
    const l = (await page.$$eval('a', (as) => as.map((a) => ({ t: (a.textContent || '').trim().replace(/\s+/g, ' '), h: a.getAttribute('href') || '' })))).filter((a) => a.t && !SKIP.test(a.t));
    console.log('\n--- ' + label + ' ---\n' + t.slice(0, 550) + '\n>> ' + l.map((a) => a.t).join(' | '));
    return l;
  };
  // можно ли вообще ходить с нулевым HP
  await page.goto('http://lbast.ru/location.php', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(800);
  const t = await m.getBodyText(page);
  console.log('\nHP-строка: ' + ((t.match(/AI__ \([^)]*\)/) || [])[0] || '?') + ' | «Восстановите» на экране: ' + /Восстановите/i.test(t));
  await dump('где стоим');
  await ctx.close();
})();
