const { chromium } = require('playwright');
const m = require('./module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  await page.goto('http://lbast.ru/location.php?mod=quests', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(700);
  const all = await page.$$eval('a', (as) => as.map((a) => ({ t: (a.textContent || '').trim(), h: a.getAttribute('href') || '' })));
  const allLink = all.find((a) => /Все квесты/i.test(a.t));
  console.log('ссылка «Все квесты»: ' + JSON.stringify(allLink));
  if (allLink) {
    await page.goto(new URL(allLink.h, 'http://lbast.ru/location.php').href, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(900);
    const t = (await m.getBodyText(page)).replace(/[ \t]+/g, ' ');
    console.log('\n=== ВСЕ КВЕСТЫ ===\n' + t.slice(0, 6000));
    const links = await page.$$eval('a', (as) => as.map((a) => (a.textContent || '').trim() + ' -> ' + (a.getAttribute('href') || '')));
    const hit = links.filter((s) => /итан/i.test(s));
    console.log('\n*** ТИТАН: ' + (hit.join(' | ') || 'не найдено'));
  }
  await ctx.close();
})();
