// Разведка: куда привозит конь на миссию Ордо и что там на экране.
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
    console.log(`ССЫЛКИ: ${(await links()).map((l) => l.t).join(' | ').slice(0, 1200)}`);
  };
  // что в слоте задания
  await page.goto('http://lbast.ru/pers.php', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(900);
  await dump('анкета (слот задания)');
  // конь на миссию
  await page.goto('http://lbast.ru/location.php?mod=konj&lway=q2001_1', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(1200);
  for (let i = 0; i < 20; i++) { const t = await m.getBodyText(page); if (!/В пути еще/.test(t)) break; await sleep(2000); await page.reload({ waitUntil: 'domcontentloaded' }); }
  await sleep(1200);
  await page.goto('http://lbast.ru/location.php', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(900);
  await dump('куда привёз конь');
  await ctx.close();
})();
