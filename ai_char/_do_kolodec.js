const { chromium } = require('playwright');
const m = require('./module');
const { runGuide } = require('./guides/guide_run');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  await page.goto('http://lbast.ru/pers.php', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(800);
  const t = (await m.getBodyText(page)).replace(/\s+/g, ' ');
  console.log('слот:', (t.match(/Текущее задание:[^»]{0,70}/) || ['?'])[0]);
  const r = await runGuide(page, 'guides/kolodec.steps', Number(process.env.FROM || 0));
  console.log('ИТОГ Колодец:', JSON.stringify(r));
  await ctx.close();
})();
