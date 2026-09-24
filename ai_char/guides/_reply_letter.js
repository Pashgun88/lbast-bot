// Разово: ответить на письмо в той же переписке. node guides/_reply_letter.js <ник> "<текст>"
const { chromium } = require('playwright');
const m = require('../module');

(async () => {
  const [nick, ...rest] = process.argv.slice(2);
  const text = rest.join(' ');
  if (!nick || !text) { console.log('нужно: <ник> "<текст>"'); return; }
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  try {
    const ok = await m.replyToLetter(page, nick, text);
    console.log(`ответ ${nick}: ${ok ? 'отправлен' : 'НЕ отправлен'} - ${text}`);
  } finally { await ctx.close(); }
})();
