const { chromium } = require('playwright');
const m = require('./module');
const brewing = require('./lib/brewing');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  let inv = '';
  for (const u of ['http://lbast.ru/inv.php', 'http://lbast.ru/inv.php?cpage=2', 'http://lbast.ru/inv.php?cpage=3']) {
    await page.goto(u, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    await sleep(500);
    inv += await m.getBodyText(page).catch(() => '');
  }
  for (const w of ['Хмель', 'Брага']) {
    const hit = inv.match(new RegExp(`[^\n]*${w}[^\n]*`, 'g'));
    console.log(`${w}: ${hit ? hit.slice(0, 2).join(' // ') : 'нет'}`);
  }
  const left = await brewing.brewBragaInHouse(page, `http://lbast.ru/dom.php?mod=inhouse&dom_id=${process.env.HID}`, 999, 0);
  console.log('резерв после:', left);
  await ctx.close();
})();
