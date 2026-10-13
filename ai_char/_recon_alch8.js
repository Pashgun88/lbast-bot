const { chromium } = require('playwright');
const m = require('./module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = [];
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  const sleepP = sleep;
  await page.goto('http://lbast.ru/map.php?mv=0&go=search#searchbar', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await sleepP(600);
  const inp = await page.$('input[name="look"]');
  await inp.fill('травн');
  await inp.press('Enter');
  await sleepP(1500);
  const html = await page.evaluate(() => {
    const as = Array.from(document.querySelectorAll('a'));
    return as.map((a) => `${(a.innerText || '').trim()} -> ${a.getAttribute('href') || ''} onclick=${a.getAttribute('onclick') || ''}`).join('\n');
  });
  out.push(html);
  const body = await page.evaluate(() => document.body.innerHTML.slice(0, 20000));
  out.push('\n\n===HTML===\n' + body);
  require('fs').writeFileSync(process.argv[2], out.join('\n'), 'utf8');
  await ctx.close();
})().catch((e) => { require('fs').writeFileSync(process.argv[2], `ОШИБКА: ${e.stack}\n${out.join('\n')}`, 'utf8'); process.exit(1); });
