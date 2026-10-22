const { chromium } = require('playwright');
const TEXT = 'Привет! Браслет видел - вещь по делу, крит 23 это серьёзно. Только покупку я сам не решаю, спрошу у своих; назови цену, с ней и пойду спрашивать.';
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  const { replyToLetter } = require('./lib/mail');
  const ok = await replyToLetter(page, '_LEKS_', TEXT);
  console.log(`ответ _LEKS_: ${ok ? 'отправлен' : 'НЕ отправлен'} - ${TEXT}`);
  await ctx.close();
})();
