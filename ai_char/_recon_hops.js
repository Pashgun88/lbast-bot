const { chromium } = require('playwright');
const m = require('./module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  for (const u of ['inv.php', 'inv.php?pack=1', 'inv.php?cpage=2', 'inv.php?cpage=3']) {
    await page.goto('http://lbast.ru/' + u, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    await sleep(600);
    const t = await m.getBodyText(page).catch(() => '');
    const hops = (t.match(/[^\n]*Хмель[^\n]*/g) || []).map((s) => JSON.stringify(s));
    const brag = (t.match(/[^\n]*[Бб]рага[^\n]*/g) || []).map((s) => JSON.stringify(s));
    console.log(`${u}: Хмель ${hops.join(' | ') || '-'} ; Брага ${brag.join(' | ') || '-'}`);
  }
  await ctx.close();
})();
