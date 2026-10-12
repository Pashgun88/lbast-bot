const { chromium } = require('playwright');
const m = require('./module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SKIP = /Чат|Форум|ЖГ|Карта|Кланы|^Бои$|Амулет|Aмулет|Конь|Выход|Размер|Кто здесь|Галерея|статы|AI__|^Q\d|^D\d|Обновить/;
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  const nav = async () => (await page.$$eval('a', (as) => as.map((a) => ({ t: (a.textContent || '').trim().replace(/\s+/g, ' '), h: a.getAttribute('href') || '' })))).filter((a) => a.t);
  const dump = async (label) => {
    const t = (await m.getBodyText(page).catch(() => '')).replace(/\s+/g, ' ');
    const l = (await nav()).filter((a) => !SKIP.test(a.t));
    console.log('\n--- ' + label + ' ---\n' + t.slice(0, 500) + '\n>> ' + l.map((a) => a.t).join(' | '));
    return l;
  };
  const click = async (re, label) => {
    const l = await nav();
    const a = l.find((x) => re.test(x.t));
    if (!a) { console.log('НЕТ ссылки ' + label); return false; }
    await page.goto(new URL(a.h, 'http://lbast.ru/').href, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await sleep(1100);
    return true;
  };
  await page.goto('http://lbast.ru/location.php?mod=konj&lway=5', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(1500);
  for (let i = 0; i < 10; i++) {
    const txt = await m.getBodyText(page).catch(() => '');
    if (!/В пути/.test(txt)) break;
    await page.click('a:has-text("В пути")').catch(() => {});
    await sleep(7000);
  }
  await dump('Горное плато');
  await click(/^Идти на запад$/, 'запад');  await dump('Кровавый пик');
  await click(/^Идти на юг$/, 'юг');        await dump('Горы');
  await click(/^Идти на запад$/, 'запад');  const l = await dump('Ущелье призраков');
  // пройдём по всем не-навигационным объектам тут
  for (const a of l.filter((x) => !/^Идти/.test(x.t))) console.log('  ОБЪЕКТ: ' + a.t + ' -> ' + a.h);
  await ctx.close();
})();
