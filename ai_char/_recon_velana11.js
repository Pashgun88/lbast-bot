const { chromium } = require('playwright');
const m = require('./module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  const go = async (url) => {
    for (let i = 1; i <= 5; i++) {
      try { await page.goto(url, { waitUntil: 'commit', timeout: 30000 }); await sleep(2500); return true; }
      catch (e) { console.log(`переход ${i}/5 не удался: ${e.message.split('\n')[0]}`); await sleep(4000); }
    }
    return false;
  };
  const nav = async () => (await page.$$eval('a', (as) => as.map((a) => ({ t: (a.textContent || '').trim().replace(/\s+/g, ' '), h: a.getAttribute('href') || '' })))).filter((a) => a.t).catch(() => []);
  const show = async (label) => {
    const t = (await m.getBodyText(page).catch(() => '')).replace(/[ \t]+/g, ' ');
    console.log('\n=== ' + label + ' ===\n' + t.slice(0, 2200));
    const l = (await nav()).filter((a) => !/Чат|Форум|ЖГ|^Карта|Кланы|^Бои|Амулет|Aмулет|Конь|Выход|Размер|Кто здесь|Обновить|^В игру$/.test(a.t));
    console.log('ВАРИАНТЫ: ' + l.map((a) => a.t).join(' | '));
    return l;
  };
  const click = async (re, label) => {
    const a = (await nav()).find((x) => re.test(x.t));
    if (!a) { console.log('НЕТ «' + label + '»'); return false; }
    return go(new URL(a.h, 'http://lbast.ru/').href);
  };
  if (!(await go('http://lbast.ru/location.php'))) { console.log('игра не отвечает'); return ctx.close(); }
  await show('ГДЕ СТОИМ');
  if (await click(/Поговорить с женщиной/, 'Поговорить с женщиной')) {
    await click(/Что у вас случилось/, 'Что у вас случилось');
    await show('ЧТО СЛУЧИЛОСЬ');
  }
  await ctx.close();
})();
