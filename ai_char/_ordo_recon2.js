const { chromium } = require('playwright');
const { getBodyText } = require('./module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const links = (page) => page.evaluate(() =>
  Array.from(document.querySelectorAll('a')).map((a) => ({ t: (a.textContent || '').replace(/\s+/g, ' ').trim(), h: a.getAttribute('href') || '' })).filter((x) => x.t));
const step = async (page, text) => {
  const h = await page.evaluate((want) => {
    const a = Array.from(document.querySelectorAll('a')).find((x) => (x.textContent || '').replace(/\s+/g, ' ').trim() === want);
    return a ? a.getAttribute('href') : null;
  }, text);
  if (!h) return false;
  await page.goto(new URL(h, 'http://lbast.ru/').href, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  await sleep(900);
  return true;
};
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());

  // Висящий бой?
  await page.goto('http://lbast.ru/arena.php?mod=battles', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  await sleep(700);
  const b = (await getBodyText(page).catch(() => '')).replace(/[ \t]+/g, ' ');
  console.log('=== БОИ ===\n' + b.slice(0, 900));

  // В башню Ордо
  await page.goto('http://lbast.ru/location.php?mod=fastway&lway=2', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  await sleep(2500);
  await page.goto('http://lbast.ru/location.php', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  await sleep(600);
  for (const s of ['Южные ворота', 'Идти на юг', 'Идти на восток', 'Башня Ордо Экзекуторс']) {
    const ok = await step(page, s);
    console.log(`шаг «${s}»: ${ok ? 'ок' : 'НЕ НАЙДЕН'}`);
    if (!ok) break;
  }
  const t = (await getBodyText(page).catch(() => '')).replace(/[ \t]+/g, ' ');
  console.log('=== БАШНЯ ОРДО ===\nURL: ' + page.url() + '\n' + t.slice(0, 2000));
  console.log('=== ССЫЛКИ БАШНИ ===\n' + JSON.stringify((await links(page)).filter((x) => !/Чат|Форум|Кланы|ЖГ|Карта|Галерея|Амулет|Конь|Выход|Размер/i.test(x.t)), null, 1));
  await ctx.close();
})();
