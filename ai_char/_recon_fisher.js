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
    const l = (await nav()).filter((a) => !/Чат|Форум|ЖГ|^Карта|Кланы|^Бои|Амулет|Aмулет|Конь|Выход|Размер|Кто здесь|Галерея|^Обновить$|статы|^AI__|^Q\d|^D\d|Памятник|Мемориальная/.test(a.t));
    console.log('\n=== ' + label + ' ===\n' + t.slice(0, 1100) + '\nССЫЛКИ: ' + l.map((a) => '«' + a.t + '»').join(' | '));
    return l;
  };
  const click = async (re, label) => {
    const a = (await nav()).find((x) => re.test(x.t));
    if (!a) { console.log('НЕТ «' + label + '»'); return false; }
    await page.goto(new URL(a.h, 'http://lbast.ru/').href, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await sleep(1300); return true;
  };
  const { clickInfoForQuest, resetToQuestMenu } = require('./lib/quest_menu');
  await resetToQuestMenu(page); await sleep(700);
  if (!(await clickInfoForQuest(page, 'Еда для рыбака'))) { console.log('квеста нет в меню'); return ctx.close(); }
  await sleep(900);
  await dump('ИНФО');
  if (!(await click(/К месту выполнения/, 'К месту выполнения'))) return ctx.close();
  for (let i = 0; i < 12; i++) {
    const t = await m.getBodyText(page).catch(() => '');
    if (!/В пути/i.test(t)) break;
    await click(/^В пути/, 'В пути');
  }
  await dump('ПРИЕХАЛИ');
  if (await click(/Дойти до деревни/, 'Дойти до деревни')) await dump('ДЕРЕВНЯ');
  await ctx.close();
})();
