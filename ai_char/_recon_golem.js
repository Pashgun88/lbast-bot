const { chromium } = require('playwright');
const m = require('./module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  await page.goto('http://lbast.ru/inv.php?cpage=2', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(600);
  const t = (await m.getBodyText(page).catch(() => '')).replace(/\s+/g, ' ');
  console.log('ВХОЖДЕНИЙ:', (t.match(/Эликсир каменного голема/g) || []).length);
  console.log('КОНТЕКСТ:', (t.match(/.{0,70}Эликсир каменного голема.{0,120}/) || [''])[0]);
  // href «Использовать» именно у этого эликсира: берём ссылку-название и соседнюю
  const pairs = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll('a').forEach((a, i, arr) => {
      if (/Эликсир каменного голема/.test(a.innerText || '')) {
        const next = arr[i + 1];
        out.push({ name: a.getAttribute('href'), use: next ? { t: (next.innerText || '').trim(), h: next.getAttribute('href') } : null });
      }
    });
    return out;
  });
  console.log('ПАРЫ:', JSON.stringify(pairs, null, 1));
  await ctx.close();
})();
