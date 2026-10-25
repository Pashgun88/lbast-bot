// Разведка: «Снимите сломанную экипировку!». Паша, 25.10.2026 - нажать на красную надпись,
// выбросить сломанное, посмотреть что это; если герб - взять новый.
const { chromium } = require('playwright');
const { getBodyText } = require('./module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const links = (page) => page.evaluate(() =>
  Array.from(document.querySelectorAll('a')).map((a) => ({
    t: (a.textContent || '').replace(/\s+/g, ' ').trim(),
    h: a.getAttribute('href') || '',
  })).filter((x) => x.t || x.h));

(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  await page.goto('http://lbast.ru/location.php', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  await sleep(600);

  const t0 = (await getBodyText(page).catch(() => '')).replace(/[ \t]+/g, ' ');
  console.log('=== ЛОКАЦИЯ (первые 600) ===\n' + t0.slice(0, 600));

  const all = await links(page);
  const broken = all.filter((x) => /сломанн|снимите/i.test(x.t));
  console.log('=== ССЫЛКИ ПРО СЛОМАННОЕ ===\n' + JSON.stringify(broken, null, 1));

  if (!broken.length) { console.log('Красной надписи сейчас нет.'); await ctx.close(); return; }

  await page.goto('http://lbast.ru/' + broken[0].h.replace(/^\//, ''), { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  await sleep(700);
  const t1 = (await getBodyText(page).catch(() => '')).replace(/[ \t]+/g, ' ');
  console.log('=== ЭКРАН ПО КРАСНОЙ НАДПИСИ ===\nURL: ' + page.url() + '\n' + t1.slice(0, 2500));
  console.log('=== ССЫЛКИ ЭКРАНА ===\n' + JSON.stringify(await links(page), null, 1));
  await ctx.close();
})();
