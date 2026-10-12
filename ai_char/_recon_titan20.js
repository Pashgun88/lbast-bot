const { chromium } = require('playwright');
const m = require('./module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SKIP = /Чат|Форум|ЖГ|Карта|Кланы|^Бои|Амулет|Aмулет|Конь|Выход|Размер|Кто здесь|Галерея|статы|AI__|^Q\d|^D\d|Обновить/;
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  const plateau = async () => {
    await page.goto('http://lbast.ru/location.php?mod=konj&lway=5', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(1500);
    for (let i = 0; i < 10; i++) {
      const txt = await m.getBodyText(page).catch(() => '');
      if (!/В пути/.test(txt)) break;
      await page.click('a:has-text("В пути")').catch(() => {});
      await sleep(7000);
    }
  };
  const dump = async (label) => {
    const t = (await m.getBodyText(page).catch(() => '')).replace(/\s+/g, ' ');
    const l = await page.$$eval('a', (as) => as.map((a) => ({ t: (a.textContent || '').trim().replace(/\s+/g, ' '), h: a.getAttribute('href') || '' })));
    const nav = l.filter((a) => a.t && !SKIP.test(a.t));
    console.log('\n--- ' + label + ' ---\n' + t.slice(0, 700));
    console.log('>> ' + nav.map((a) => a.t + '->' + a.h).join(' | '));
    return nav;
  };
  await plateau();
  for (const [idem, name] of [[3, 'восток'], [2, 'север'], [1, 'запад']]) {
    await page.goto('http://lbast.ru/location.php?idem=' + idem, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
    await sleep(1200);
    const nav = await dump('плато -> ' + name);
    // один шаг глубже по каждому направлению
    for (const a of nav.filter((x) => /idem=/.test(x.h)).slice(0, 4)) {
      await page.goto(new URL(a.h, 'http://lbast.ru/').href, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
      await sleep(1000);
      await dump(name + ' -> ' + a.t);
      await page.goto('http://lbast.ru/location.php?idem=' + idem, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
      await sleep(900);
    }
    await plateau();
  }
  await ctx.close();
})();
