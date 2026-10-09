const { chromium } = require('playwright');
const m = require('./module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  const links = () => page.evaluate(() => Array.from(document.querySelectorAll('a'))
    .map((a) => ({ t: (a.innerText || '').trim(), h: a.getAttribute('href') || '' })).filter((x) => x.t && x.h));
  const say = async (label) => console.log(`${label}: ${(await m.getBodyText(page)).replace(/\s+/g, ' ').slice(0, 400)}`);
  const go = async (re, label, w = 1200) => {
    const hit = (await links()).find((l) => re.test(l.t));
    if (!hit) { console.log(`НЕТ «${label}»`); return false; }
    await page.goto(new URL(hit.h, page.url()).href, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(w);
    return true;
  };
  await page.goto('http://lbast.ru/location.php?mod=fastway&lway=2', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(1300);
  for (const st of ['Южные ворота', 'Идти на юг', 'Идти на восток']) await go(new RegExp(`^${st}$`), st, 900);
  const tower = (await links()).find((l) => /obj=5100$/.test(l.h));
  await page.goto(new URL(tower.h, page.url()).href, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(900);
  await go(/^Отказаться от задания$/, 'Отказаться от задания');
  await say('после отказа');
  await page.goto('http://lbast.ru/pers.php', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(900);
  const t = (await m.getBodyText(page)).replace(/\s+/g, ' ');
  console.log('слот:', (t.match(/Текущее задание:[^»]{0,90}/) || ['не нашёл'])[0]);
  await ctx.close();
})();
