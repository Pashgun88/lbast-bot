const { chromium } = require('playwright');
const m = require('./module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  const txt = async () => (await m.getBodyText(page)).replace(/\s+/g, ' ');
  await page.goto('http://lbast.ru/log_infa.php?mod=who&blogin=AI__', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(900);
  const link = await page.evaluate(() => {
    const a = Array.from(document.querySelectorAll('a')).find((x) => /Статы и оружие/i.test((x.innerText || '').trim()));
    return a ? a.getAttribute('href') : null;
  });
  console.log('«Статы и оружие»:', link);
  if (link) {
    await page.goto(new URL(link, 'http://lbast.ru/').href, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(900);
    console.log('--- СТАТЫ И ОРУЖИЕ ---\n' + (await txt()).slice(0, 1400));
  }
  // требования вещей: открыть инфо арендованных предметов
  await page.goto('http://lbast.ru/inv.php?mod=outfit', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(800);
  const items = await page.evaluate(() => Array.from(document.querySelectorAll('a'))
    .map((a) => ({ t: (a.innerText || '').trim(), h: a.getAttribute('href') || '' }))
    .filter((x) => /log_infa_or\.php/.test(x.h)));
  console.log('предметов на себе:', items.length);
  for (const it of items.slice(0, 4)) {
    await page.goto(new URL(it.h, 'http://lbast.ru/').href, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(500);
    console.log('• ' + (await txt()).replace(/^\d\d:\d\d:\d\d, \S+\.?\s*/, '').slice(0, 320));
  }
  await ctx.close();
})();
