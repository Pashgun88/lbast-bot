const { chromium } = require('playwright');
const m = require('./module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  await page.goto('http://lbast.ru/inv.php', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(800);
  const pages = await page.evaluate(() => Array.from(document.querySelectorAll('a'))
    .map((a) => ({ t: (a.innerText || '').trim(), h: a.getAttribute('href') || '' }))
    .filter((x) => /^\[?\d\]?$/.test(x.t) && /inv/.test(x.h)));
  console.log('ссылки страниц:', JSON.stringify(pages));
  const seen = new Set();
  for (const p of [{ t: '1', h: 'inv.php' }, ...pages]) {
    if (seen.has(p.h)) continue;
    seen.add(p.h);
    await page.goto(new URL(p.h, 'http://lbast.ru/').href, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(500);
    const t = await m.getBodyText(page).catch(() => '');
    const hit = (t.match(/[^\n]*(Брага|браг)[^\n]*/gi) || []).map((x) => x.trim());
    console.log(`стр.${p.t} (${p.h}): ${hit.join(' | ') || 'браги нет'}`);
  }
  await ctx.close();
})();
