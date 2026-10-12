const { chromium } = require('playwright');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  await page.goto('http://lbast.ru/pers.php?mod=stats', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await sleep(900);
  const rows = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll('a').forEach((a) => {
      const h = a.getAttribute('href') || '';
      if (!/stat|mod=stats/i.test(h)) return;
      // текст строки, в которой лежит ссылка
      let row = a.parentElement;
      for (let i = 0; i < 3 && row; i++) { if ((row.textContent || '').length > 5) break; row = row.parentElement; }
      out.push({ text: (a.textContent || '').trim(), href: h, row: ((row && row.textContent) || '').replace(/\s+/g, ' ').trim().slice(0, 60) });
    });
    return out;
  });
  console.log(JSON.stringify(rows, null, 1).slice(0, 2000));
  await ctx.close();
})();
