const { chromium } = require('playwright');
const m = require('./module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  let inv = '';
  for (const u of ['inv.php', 'inv.php?cpage=2', 'inv.php?cpage=3', 'inv.php?cpage=4']) {
    await page.goto('http://lbast.ru/' + u, { waitUntil: 'domcontentloaded', timeout: 40000 }).catch(() => {});
    await sleep(500);
    inv += '\n' + (await m.getBodyText(page).catch(() => ''));
  }
  const hits = (inv.match(/[^\n]*[Ээ]ль[^\n]*/g) || []).map((s) => s.trim().replace(/\s+/g, ' '));
  console.log('эли в сумке:\n  ' + (hits.join('\n  ') || 'нет'));
  // как у нас устроена продажа в лавке
  const { sellFriedFishIfDue } = require('./lib/fish_sale');
  console.log('\nфункция продажи есть: ' + (typeof sellFriedFishIfDue === 'function'));
  await ctx.close();
})();
