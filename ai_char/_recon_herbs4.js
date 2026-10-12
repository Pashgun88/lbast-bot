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
  const body = async () => (await m.getBodyText(page).catch(() => '')).replace(/[ \t]+/g, ' ');
  const { clickInfoForQuest, resetToQuestMenu } = require('./lib/quest_menu');
  await resetToQuestMenu(page); await sleep(700);
  const target = process.argv[2] || 'Травы: Дикая вишня';
  if (!(await clickInfoForQuest(page, target))) { console.log('квеста нет в меню'); return ctx.close(); }
  await sleep(900);
  const go = async (re, label) => {
    const a = (await nav()).find((x) => re.test(x.t));
    if (!a) { console.log('НЕТ «' + label + '»'); return false; }
    await page.goto(new URL(a.h, 'http://lbast.ru/').href, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await sleep(1200); return true;
  };
  if (!(await go(/К месту выполнения/, 'К месту выполнения'))) return ctx.close();
  for (let i = 0; i < 12; i++) {
    if (!/В пути ещ/i.test(await body())) break;
    await page.goto(page.url(), { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
    await sleep(2500);
  }
  console.log('НА МЕСТЕ: ' + (await body()).split('\n').filter((s) => s.trim()).slice(2, 6).join(' / '));
  if (!(await go(/Искать травы/, 'Искать травы'))) return ctx.close();
  for (let round = 1; round <= 10; round++) {
    const t = await body();
    const l = await nav();
    const stars = l.filter((a) => a.t === '*');
    console.log(`\n--- круг ${round}: звёздочек ${stars.length} ---\n` + t.replace(/\s+/g, ' ').slice(0, 900));
    const next = stars[0] || l.find((a) => a.t === 'Далее');
    if (!next) { console.log('выбирать нечего - конец'); break; }
    console.log('жму: ' + next.t + ' -> ' + next.h);
    await page.goto(new URL(next.h, 'http://lbast.ru/').href, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await sleep(1000);
  }
  console.log('\nИТОГ ЭКРАНА: ' + (await body()).replace(/\s+/g, ' ').slice(0, 900));
  await ctx.close();
})();
