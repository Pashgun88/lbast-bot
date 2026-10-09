// Разведка: чем в таверне «Соломенная крыша» начинается «Колодец Страха» + есть ли брага.
const { chromium } = require('playwright');
const m = require('./module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  const links = () => page.evaluate(() => Array.from(document.querySelectorAll('a'))
    .map((a) => ({ t: (a.innerText || '').trim().replace(/\s+/g, ' '), h: a.getAttribute('href') || '' })).filter((x) => x.t && x.h));
  const dump = async (label) => {
    const t = (await m.getBodyText(page)).replace(/\s+/g, ' ');
    console.log(`\n===== ${label} =====\nТЕКСТ: ${t.slice(0, 900)}`);
    console.log(`ССЫЛКИ: ${(await links()).map((l) => l.t).join(' | ').slice(0, 900)}`);
  };
  const go = async (re, label, w = 1200) => {
    const hit = (await links()).find((l) => re.test(l.t));
    if (!hit) { console.log(`НЕТ «${label}»`); return false; }
    await page.goto(new URL(hit.h, page.url()).href, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(w);
    await dump(label);
    return true;
  };
  // брага в сумке?
  let inv = '';
  for (const u of ['http://lbast.ru/inv.php', 'http://lbast.ru/inv.php?cpage=2', 'http://lbast.ru/inv.php?cpage=3']) {
    await page.goto(u, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    await sleep(600);
    inv += await m.getBodyText(page).catch(() => '');
  }
  const braga = inv.match(/[^\n]*[Бб]рага[^\n]*/g);
  console.log('БРАГА в сумке:', braga ? braga.slice(0, 3).join(' // ') : 'НЕТ');
  // таверна
  await page.goto('http://lbast.ru/location.php?mod=fastway&lway=2', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(1400);
  await go(/^Северные ворота$/, 'Северные ворота', 900);
  await go(/^Идти в боевые кварталы$/, 'Идти в боевые кварталы', 900);
  await go(/Соломенная крыша/, 'Таверна «Соломенная крыша»', 900);
  await go(/^В обеденный зал$/, 'В обеденный зал', 1200);
  await ctx.close();
})();
