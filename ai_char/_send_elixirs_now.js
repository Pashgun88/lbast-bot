// Разовый запуск передачи эликсиров исцеления Паше (Tsunami). Драйвер должен быть остановлен.
const { chromium } = require('playwright');
const { sendHealingElixirsIfDue } = require('./lib/healing_elixir_sale');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  await page.goto('http://lbast.ru/location.php', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  await sleep(700);
  const ok = await sendHealingElixirsIfDue(page, { force: true });
  console.log('RESULT:', ok);
  await ctx.close();
})();
