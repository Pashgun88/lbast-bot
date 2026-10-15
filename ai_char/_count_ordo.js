const { chromium } = require('playwright');
const m = require('./module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  let all = '';
  for (let p = 1; p <= 8; p++) {
    await page.goto(p === 1 ? 'http://lbast.ru/inv.php' : `http://lbast.ru/inv.php?cpage=${p}`, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    await sleep(500);
    const t = (await m.getBodyText(page).catch(() => '')).replace(/\s+/g, ' ');
    const hdr = (t.match(/(\d+)-(\d+) из (\d+) по (\d+)/) || null);
    if (!hdr) { console.log(`стр ${p}: шапки нет - конец`); break; }
    console.log(`стр ${p}: ${hdr[0]}`);
    all += ' ' + t;
    if (Number(hdr[2]) >= Number(hdr[3])) break;
  }
  for (const name of ['Медальон бандита', 'Костяная цепь бандита', 'Медаль Ордо экзекуторс']) {
    const mm = all.match(new RegExp(name + '\s*(\d*)'));
    console.log(name, '->', mm ? `«${mm[0]}»` : 'НЕТ В СУМКЕ');
  }
  await ctx.close();
})();
