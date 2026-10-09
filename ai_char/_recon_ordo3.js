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
    console.log(`\n===== ${label} =====\nURL: ${page.url()}\nТЕКСТ: ${t.slice(0, 1200)}`);
    console.log(`ССЫЛКИ: ${(await links()).map((l) => `${l.t} [${l.h}]`).join(' | ').slice(0, 1200)}`);
  };
  const go = async (re, label, w = 1500) => {
    const hit = (await links()).find((l) => re.test(l.t));
    if (!hit) { console.log(`НЕТ «${label}»`); return false; }
    await page.goto(new URL(hit.h, page.url()).href, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(w);
    await dump(label);
    return true;
  };
  await page.goto('http://lbast.ru/location.php?mod=fastway&lway=2', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(1200);
  for (const st of ['Южные ворота', 'Идти на юг', 'Идти на восток']) await go(new RegExp(`^${st}$`), st, 900).then(() => {});
  const tower = (await links()).find((l) => /obj=5100$/.test(l.h));
  await page.goto(new URL(tower.h, page.url()).href, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(900);
  await go(/^Уничтожить главаря банды$/, 'zad=1 (взять/продолжить)');
  await ctx.close();
})();
