const { chromium } = require('playwright');
const m = require('./module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SKIP = /Чат|Форум|ЖГ|^Карта|Кланы|^Бои$|Амулет|Aмулет|Конь|Выход|Размер|Кто здесь|Галерея|статы|AI__|^Q\d|^D\d|Обновить/;
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  // 1) что в меню дейликов сейчас
  await page.goto('http://lbast.ru/location.php?mod=daily', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(900);
  console.log('=== МЕНЮ ДЕЙЛИКОВ ===\n' + (await m.getBodyText(page)).replace(/[ \t]+/g, ' ').slice(0, 1800));
  // 2) поиск по карте
  for (const w of ['сына', 'женщин']) {
    await page.goto('http://lbast.ru/map.php?mv=0&go=search#searchbar', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await sleep(400);
    const inp = await page.$('input[name="look"]');
    if (inp) { await inp.fill(w); await inp.press('Enter'); await sleep(1200); }
    const t = (await m.getBodyText(page).catch(() => '')).replace(/[ \t]+/g, ' ');
    const body = (t.split('Замки NPC Всё').pop() || '').split('1. Введите')[0].replace(/\s+/g, ' ').trim();
    console.log(`\n[карта: ${w}] ` + (body.slice(0, 900) || '-'));
  }
  // 3) форт Жженого листа и округа
  await page.goto('http://lbast.ru/location.php?mod=fastway&lway=7', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(2500);
  const dump = async (label) => {
    const t = (await m.getBodyText(page).catch(() => '')).replace(/\s+/g, ' ');
    const l = (await page.$$eval('a', (as) => as.map((a) => ({ t: (a.textContent || '').trim().replace(/\s+/g, ' '), h: a.getAttribute('href') || '' })))).filter((a) => a.t && !SKIP.test(a.t));
    console.log('\n--- ' + label + ' ---\n' + t.slice(0, 600) + '\n>> ' + l.map((a) => a.t + ' -> ' + a.h).join(' | '));
    return l;
  };
  const l0 = await dump('ФОРТ ЖЖЁНОГО ЛИСТА');
  for (const a of l0.filter((x) => /^Идти/.test(x.t))) {
    await page.goto(new URL(a.h, 'http://lbast.ru/').href, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
    await sleep(1100);
    await dump('форт -> ' + a.t);
    await page.goto('http://lbast.ru/location.php?mod=fastway&lway=7', { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
    await sleep(2000);
  }
  await ctx.close();
})();
