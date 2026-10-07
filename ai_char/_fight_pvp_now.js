// Ведём текущий бой ТЕМ ЖЕ кодом, что в драйвере (lib/pvp.runPvpFightLoop) - это и проверка.
const { chromium } = require('playwright');
const m = require('./module');
const pvp = require('./lib/pvp');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  await page.goto('http://lbast.ru/location.php', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(800);
  // зайти в бой по ссылке boj=
  const boj = await page.evaluate(() => {
    const a = Array.from(document.querySelectorAll('a')).find((x) => (x.getAttribute('href') || '').includes('boj='));
    return a ? a.getAttribute('href') : null;
  });
  if (boj) { await page.goto(new URL(boj, 'http://lbast.ru/').href, { waitUntil: 'domcontentloaded', timeout: 60000 }); await sleep(800); }
  const t0 = (await m.getBodyText(page)).replace(/\s+/g, ' ');
  console.log('ЭКРАН:', t0.slice(0, 400));
  console.log('это ПВП-экран?', pvp.isPvpFightScreen(t0));
  const sel = await page.evaluate(() => Array.from(document.querySelectorAll('select'))
    .map((s) => Array.from(s.options).map((o) => (o.textContent || '').trim()).join(' / ')));
  console.log('ВЫПАДАЮЩИЕ СПИСКИ:', JSON.stringify(sel));
  const ok = await pvp.runPvpFightLoop(page, 'ПВП');
  console.log('итог боя:', ok);
  console.log('ПОСЛЕ:', (await m.getBodyText(page)).replace(/\s+/g, ' ').slice(0, 300));
  await ctx.close();
})().catch((e) => { console.log('ОШИБКА:', e.stack); process.exit(1); });
