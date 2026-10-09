// Разведка: почему Варьете не входит в сцену. Печатаем экран целиком на каждом шаге.
const { chromium } = require('playwright');
const m = require('./module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  const links = () => page.evaluate(() => Array.from(document.querySelectorAll('a'))
    .map((a) => ({ t: (a.innerText || '').trim(), h: a.getAttribute('href') || '' })).filter((x) => x.t && x.h));
  const dump = async (label) => {
    const t = (await m.getBodyText(page)).replace(/\s+/g, ' ');
    console.log(`\n===== ${label} =====\nURL: ${page.url()}\nТЕКСТ: ${t.slice(0, 900)}`);
    console.log(`ССЫЛКИ: ${(await links()).map((l) => `${l.t} [${l.h}]`).join(' | ').slice(0, 1600)}`);
  };
  const go = async (re, label, w = 1500) => {
    const hit = (await links()).find((l) => re.test(l.t));
    if (!hit) { console.log(`НЕТ «${label}»`); return false; }
    await page.goto(new URL(hit.h, page.url()).href, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(w);
    await dump(label);
    return true;
  };
  await page.goto('http://lbast.ru/location.php', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(700);
  await dump('старт');
  await go(/^Q\d*$/, 'Q-меню');
  // инфо по Варьете
  const info = (await links()).find((l) => /инфо/i.test(l.t) && /vari|q2|zad/i.test(l.h));
  console.log('инфо-ссылок с Варьете найдено:', info ? info.h : 'нет - ищу иначе');
  await ctx.close();
})();
