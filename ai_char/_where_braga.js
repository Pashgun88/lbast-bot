const { chromium } = require('playwright');
const m = require('./module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  const urls = ['inv.php', 'inv.php?pack=1', 'inv.php?pack=0', 'inv.php?cpage=2', 'inv.php?cpage=3',
    'inv.php?invMod=2', 'inv.php?invMod=3', 'inv.php?mod=starred'];
  for (const u of urls) {
    await page.goto('http://lbast.ru/' + u, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    await sleep(500);
    const t = await m.getBodyText(page).catch(() => '');
    const hit = (t.match(/[^\n]*(Брага|браг|Хмель)[^\n]*/gi) || []).map((x) => x.trim());
    console.log(`${u}: ${hit.join(' | ') || '-'}`);
  }
  await ctx.close();
})();
