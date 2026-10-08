const { chromium } = require('playwright');
const m = require('./module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  await page.goto('http://lbast.ru/map.php?mv=0&go=showToponim', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(1500);
  const t = (await m.getBodyText(page)).replace(/\s+/g, ' ');
  const i = t.search(/Ущелье/);
  require('fs').writeFileSync(process.argv[2], i >= 0 ? t.slice(Math.max(0, i - 300), i + 500) : 'нет упоминания', 'utf8');
  await ctx.close();
})().catch((e) => { require('fs').writeFileSync(process.argv[2], `ОШИБКА: ${e.stack}`, 'utf8'); process.exit(1); });
