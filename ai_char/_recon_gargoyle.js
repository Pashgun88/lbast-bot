const { chromium } = require('playwright');
const m = require('./module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  const srch = async (w) => {
    await page.goto('http://lbast.ru/map.php?mv=0&go=search#searchbar', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await sleep(400);
    const inp = await page.$('input[name="look"]');
    await inp.fill(w); await inp.press('Enter'); await sleep(1200);
    const items = await page.$$eval('p', (ps) => ps.map((p) => (p.textContent || '').replace(/\s+/g, ' ').trim()).filter((s) => /^№\d+/.test(s)));
    console.log(`[${w}]\n  ` + (items.join('\n  ') || 'ничего'));
  };
  await srch('горгул');
  await srch('маяк');
  await ctx.close();
})();
