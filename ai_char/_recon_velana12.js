const { chromium } = require('playwright');
const m = require('./module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FIGHT_RE = /Атаковать|В бой|Ударить|Напасть/i;
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  const go = async (url) => {
    for (let i = 1; i <= 4; i++) {
      try { await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 }); await sleep(1200); return true; }
      catch (e) { console.log(`  переход ${i}/4: ${e.message.split('\n')[0]}`); await sleep(3000); }
    }
    return false;
  };
  const nav = async () => {
    const xs = await page.$$eval('a', (as) => as.map((a) => ({ t: (a.textContent || '').trim().replace(/\s+/g, ' '), h: a.getAttribute('href') || '' }))).catch(() => []);
    return xs.filter((a) => a.t);
  };
  const show = async (label) => {
    const t = (await m.getBodyText(page).catch(() => '')).replace(/[ \t]+/g, ' ');
    const l = (await nav()).filter((a) => !/Чат|Форум|ЖГ|^Карта|Кланы|^Бои|Амулет|Aмулет|Конь|Выход|Размер|Кто здесь|Обновить|^В игру$/.test(a.t));
    console.log('\n=== ' + label + ' ===\n' + t.slice(0, 1800) + '\nВАРИАНТЫ: ' + l.map((a) => a.t).join(' | '));
    return l;
  };
  const click = async (re, label) => {
    const a = (await nav()).find((x) => re.test(x.t));
    if (!a) { console.log('НЕТ «' + label + '»'); return false; }
    if (FIGHT_RE.test(a.t)) { console.log('СТОП: это бой («' + a.t + '») - сам не жму, сначала доклад.'); return false; }
    return go(new URL(a.h, 'http://lbast.ru/').href);
  };
  await go('http://lbast.ru/location.php?mod=fastway&lway=7');
  await sleep(2500);
  await click(/^Идти на юг$/, 'юг'); await click(/^Идти на восток$/, 'восток');
  await click(/Поговорить с женщиной/, 'женщина');
  await click(/Что у вас случилось/, 'Что у вас случилось');
  let l = await show('ШАГ 1');
  // ведём диалог по не-боевым вариантам, печатая каждый экран
  for (let step = 2; step <= 8; step++) {
    const opt = l.find((a) => /^[-–]/.test(a.t) && !FIGHT_RE.test(a.t) && !/некогда|Отказ/i.test(a.t))
      || l.find((a) => /^(Помочь|Согласиться|Да|Продолжить|Идти|Искать|Осмотреть|Поговорить)/i.test(a.t) && !FIGHT_RE.test(a.t));
    if (!opt) { console.log('\nБольше не-боевых вариантов нет.'); break; }
    console.log('\n--> жму: ' + opt.t);
    if (!(await go(new URL(opt.h, 'http://lbast.ru/').href))) break;
    l = await show('ШАГ ' + step);
    if (l.some((a) => FIGHT_RE.test(a.t))) { console.log('\nДАЛЬШЕ БОЙ: ' + l.filter((a) => FIGHT_RE.test(a.t)).map((a) => a.t).join(', ') + ' - останавливаюсь.'); break; }
  }
  await ctx.close();
})();
