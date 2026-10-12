const { chromium } = require('playwright');
const m = require('./module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  const nav = async () => {
    const xs = await page.$$eval('a', (as) => as.map((a) => ({ t: (a.textContent || '').trim().replace(/\s+/g, ' '), h: a.getAttribute('href') || '' }))).catch(() => []);
    return xs.filter((a) => a.t);
  };
  for (const u of ['letters.php', 'letters.php?room=1', 'letters.php?mod=unread']) {
    await page.goto('http://lbast.ru/' + u, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
    await sleep(1100);
    const l = await nav();
    console.log(`\n[${u}] ссылок ${l.length}: ` + l.map((a) => '«' + a.t + '»->' + a.h).join(' | ').slice(0, 1200));
    const z = l.find((a) => /zlata/i.test(a.t));
    if (z) {
      await page.goto(new URL(z.h, 'http://lbast.ru/').href, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await sleep(1200);
      console.log('\n=== ПЕРЕПИСКА С ZLATA ===\n' + (await m.getBodyText(page)).replace(/[ \t]+/g, ' ').slice(0, 2500));
      break;
    }
  }
  await ctx.close();
})();
