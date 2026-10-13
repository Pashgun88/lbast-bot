const { chromium } = require('playwright');
const m = require('./module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  await page.goto('http://lbast.ru/pers.php', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(900);
  const t = (await m.getBodyText(page)).replace(/\s+/g, ' ');
  const out = [
    (t.match(/Текущее задание:[^»]{0,90}/) || ['Текущего задания нет'])[0],
    (t.match(/Деньги:\s*\d+/) || ['-'])[0],
    (t.match(/AI__ \(\d+\/\d+\)/) || ['-'])[0],
  ].join(' | ');
  require('fs').writeFileSync(process.argv[2], out, 'utf8');
  await ctx.close();
})().catch((e) => { require('fs').writeFileSync(process.argv[2], 'ОШИБКА: ' + e.message, 'utf8'); process.exit(1); });
