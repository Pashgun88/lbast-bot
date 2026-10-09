// Прогон шага «Работа гражданина» тем же кодом, что в драйвере.
const { chromium } = require('playwright');
const { runCitizenWorkIfDue } = require('./lib/citizen_work');
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  const ok = await runCitizenWorkIfDue(page);
  console.log('ИТОГ:', ok);
  await ctx.close();
})().catch((e) => { console.log('ОШИБКА:', e.stack); process.exit(1); });
