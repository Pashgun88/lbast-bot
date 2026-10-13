// Разовый добег «Неожиданной встречи» с того места, где её застала сцена (лекарь, шаг 41).
const { chromium } = require('playwright');
const { runGuide } = require('./guide_run');
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  const r = await runGuide(page, 'neozhidannaya_vstrecha.steps', Number(process.argv[2] || 41), { exactStart: true });
  console.log('RESULT', JSON.stringify(r));
  await ctx.close();
})().catch((e) => { console.log('ОШИБКА', e.message); process.exit(1); });
