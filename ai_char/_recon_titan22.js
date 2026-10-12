const { chromium } = require('playwright');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  for (const layer of ['showBuildings', 'showQuests', 'showToponim', 'showNPC']) {
    await page.goto('http://lbast.ru/map.php?mv=0&go=' + layer, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(900);
    const items = await page.$$eval('p', (ps) => ps.map((p) => (p.textContent || '').replace(/\s+/g, ' ').trim()).filter((s) => /^№\d+/.test(s)));
    const dar = items.filter((s) => /Дарии|призрак/i.test(s));
    console.log('\n=== ' + layer + ' (всего ' + items.length + ') — Горы Дарии ===');
    for (const s of dar) console.log('  ' + s);
  }
  await ctx.close();
})();
