const { chromium } = require('playwright');
const m = require('./module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  const srch = async (w) => {
    await page.goto('http://lbast.ru/map.php?mv=0&go=search#searchbar', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await sleep(350);
    const inp = await page.$('input[name="look"]');
    await inp.fill(String(w)); await inp.press('Enter'); await sleep(1100);
    const items = await page.$$eval('p', (ps) => ps.map((p) => (p.textContent || '').replace(/\s+/g, ' ').trim()).filter((s) => s.length > 3));
    console.log(`\n[${w}]\n  ` + items.join('\n  ').slice(0, 1500));
  };
  await srch('Жженого');
  await srch(122);
  // весь слой NPC и слой топонимов рядом с 122
  for (const layer of ['showNPC', 'showToponim']) {
    await page.goto('http://lbast.ru/map.php?mv=0&go=' + layer, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await sleep(800);
    const items = await page.$$eval('p', (ps) => ps.map((p) => (p.textContent || '').replace(/\s+/g, ' ').trim()).filter((s) => /^№\d+/.test(s)));
    const near = items.filter((s) => /^№1(1[5-9]|2[0-9])\b/.test(s) || /Северный тракт|Жженого|Жжёного/i.test(s));
    console.log('\n=== ' + layer + ' (рядом с 122 / по названию) ===\n  ' + near.join('\n  '));
  }
  await ctx.close();
})();
