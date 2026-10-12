const { chromium } = require('playwright');
const m = require('./module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  const txt = async () => (await m.getBodyText(page)).replace(/\s+/g, ' ');
  // текущие статы
  await page.goto('http://lbast.ru/log_infa.php?mod=oruzh&blogin=AI__', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(800);
  console.log('--- СТАТЫ СЕЙЧАС ---\n' + (await txt()).slice(0, 320));
  // ищем кольцо по страницам сумки
  const seen = new Set();
  for (const u of ['inv.php', 'inv.php?cpage=2', 'inv.php?cpage=3', 'inv.php?cpage=4']) {
    await page.goto('http://lbast.ru/' + u, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    await sleep(600);
    const items = await page.evaluate(() => Array.from(document.querySelectorAll('a'))
      .map((a) => ({ t: (a.innerText || '').trim(), h: a.getAttribute('href') || '' }))
      .filter((x) => /кольцо/i.test(x.t) && /log_infa_or/.test(x.h)));
    for (const it of items) {
      if (seen.has(it.t)) continue;
      seen.add(it.t);
      await page.goto(new URL(it.h, 'http://lbast.ru/').href, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await sleep(500);
      console.log(`\n• ${it.t}\n  ${(await txt()).replace(/^\d\d:\d\d:\d\d, \S+\.?\s*/, '').slice(0, 420)}`);
      console.log('  href: ' + it.h);
      await page.goto('http://lbast.ru/' + u, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
      await sleep(400);
    }
  }
  await ctx.close();
})();
