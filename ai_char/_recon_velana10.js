const { chromium } = require('playwright');
const m = require('./module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  const nav = async () => (await page.$$eval('a', (as) => as.map((a) => ({ t: (a.textContent || '').trim().replace(/\s+/g, ' '), h: a.getAttribute('href') || '' })))).filter((a) => a.t);
  const show = async (label) => {
    const t = (await m.getBodyText(page)).replace(/[ \t]+/g, ' ');
    console.log('\n=== ' + label + ' ===\n' + t.slice(0, 2200));
    const l = (await nav()).filter((a) => !/Чат|Форум|ЖГ|^Карта|Кланы|^Бои|Амулет|Aмулет|Конь|Выход|Размер|Кто здесь|Обновить|^В игру$/.test(a.t));
    console.log('ВАРИАНТЫ: ' + l.map((a) => a.t + ' -> ' + a.h).join(' | '));
    return l;
  };
  const click = async (re, label) => {
    const a = (await nav()).find((x) => re.test(x.t));
    if (!a) { console.log('НЕТ «' + label + '». Есть: ' + (await nav()).map((x) => x.t).join(' | ').slice(0, 300)); return false; }
    await page.goto(new URL(a.h, 'http://lbast.ru/').href, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(1200); return true;
  };
  await page.goto('http://lbast.ru/location.php', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(900);
  await show('ГДЕ СТОИМ');
  if (!(await click(/Поговорить с женщиной/, 'Поговорить с женщиной'))) return ctx.close();
  await click(/Что у вас случилось/, 'Что у вас случилось');
  await show('ЧТО СЛУЧИЛОСЬ');
  await ctx.close();
})();
