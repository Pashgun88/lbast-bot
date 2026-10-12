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
    const l = (await nav()).filter((a) => !/Чат|Форум|ЖГ|^Карта|Кланы|^Бои|Амулет|Aмулет|Конь|Выход|Размер|Кто здесь|Галерея|^Обновить$/.test(a.t));
    console.log('\n=== ' + label + ' ===\n' + t.slice(0, 1200) + '\nССЫЛКИ: ' + l.map((a) => `«${a.t}»->${a.h}`).join(' | ').slice(0, 1200));
    return l;
  };
  const click = async (re, label) => {
    const a = (await nav()).find((x) => re.test(x.t));
    if (!a) { console.log('НЕТ «' + label + '»'); return false; }
    await page.goto(new URL(a.h, 'http://lbast.ru/').href, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await sleep(1200); return true;
  };
  const { clickInfoForQuest, resetToQuestMenu } = require('./lib/quest_menu');
  await resetToQuestMenu(page);
  await sleep(700);
  const target = 'Травы: Лист змеевика';
  const ok = await clickInfoForQuest(page, target);
  console.log('открыл инфо квеста «' + target + '»: ' + ok);
  if (!ok) { await dump('Q-МЕНЮ'); return ctx.close(); }
  await sleep(1000);
  await dump('ИНФО КВЕСТА');
  if (!(await click(/К месту выполнения/, 'К месту выполнения'))) return ctx.close();
  for (let i = 0; i < 12; i++) {
    const t = await m.getBodyText(page).catch(() => '');
    if (!/В пути ещ/i.test(t)) break;
    console.log('в пути...');
    await page.goto(page.url(), { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
    await sleep(2500);
  }
  await dump('НА МЕСТЕ');
  if (!(await click(/Искать травы/, 'Искать травы'))) return ctx.close();
  for (let round = 1; round <= 6; round++) {
    const l = await dump('ПОИСК, круг ' + round);
    const star = l.find((a) => a.t === '*') || l.find((a) => a.t === 'Далее');
    if (!star) { console.log('нет ни «*», ни «Далее» - дальше идти некуда'); break; }
    await page.goto(new URL(star.h, 'http://lbast.ru/').href, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await sleep(900);
  }
  await ctx.close();
})();
