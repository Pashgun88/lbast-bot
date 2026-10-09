const { chromium } = require('playwright');
const m = require('./module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  const links = () => page.evaluate(() => Array.from(document.querySelectorAll('a'))
    .map((a) => ({ t: (a.innerText || '').trim(), h: a.getAttribute('href') || '' })).filter((x) => x.t && x.h));
  const where = async () => (await m.getBodyText(page)).replace(/\s+/g, ' ').slice(28, 110);
  const go = async (re, label, w = 1200) => {
    const hit = (await links()).find((l) => re.test(l.t));
    if (!hit) { console.log(`НЕТ «${label}»`); return false; }
    await page.goto(new URL(hit.h, page.url()).href, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(w);
    console.log(`${label} -> ${await where()}`);
    return true;
  };
  await page.goto('http://lbast.ru/location.php', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(700);
  console.log('старт:', await where());
  await go(/^Конь$/, 'Конь');
  await go(/Горы Дарии/, 'Горы Дарии', 9000);
  await page.goto('http://lbast.ru/location.php', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(800);
  console.log('после коня:', await where());
  await go(/^Идти на запад$/, 'запад');
  await go(/^Идти на юг$/, 'юг');
  await go(/^Идти на запад$/, 'запад-2');
  const ls = await links();
  console.log('каменоломня есть?', ls.some((l) => /^Каменоломня$/.test(l.t)));
  console.log('ходы:', ls.filter((l) => /Идти|Камено/.test(l.t)).map((l) => l.t).join(' | '));
  await ctx.close();
})().catch((e) => { console.log('ОШИБКА:', e.stack); process.exit(1); });
