const { chromium } = require('playwright');
const { getBodyText } = require('./module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PAGES = ['inv.php','inv.php?cpage=2','inv.php?cpage=3','inv.php?invMod=2','inv.php?invMod=2&cpage=2','inv.php?invMod=3'];
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  for (const u of PAGES) {
    await page.goto('http://lbast.ru/' + u, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    await sleep(600);
    const t = (await getBodyText(page).catch(() => '')).replace(/[ \t]+/g, ' ');
    const lines = t.split('\n').filter((l) => /эликсир|голем/i.test(l));
    if (lines.length) console.log(`[${u}]\n` + lines.join('\n'));
  }
  // страница сумки целиком, где эликсиры (invMod=2 обычно расходники)
  await page.goto('http://lbast.ru/inv.php?invMod=2', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  await sleep(600);
  console.log('\n=== invMod=2 целиком ===\n' + (await getBodyText(page).catch(() => '')).replace(/[ \t]+/g, ' ').slice(0, 3000));
  await ctx.close();
})();
