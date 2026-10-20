// Письмо Злате про комплект на 10 уровень (Паша, 20.10.2026: «напиши злате по поводу комплекта на 10»).
const { chromium } = require('playwright');
const m = require('./module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const NICK = 'zlata';
const TEXT = 'Привет) Сегодня беру 10-й уровень. Есть у тебя комплект на 10 ур. в аренду на месяц? Скажи цену - дины готовы.';
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  console.log(`письмо для ${NICK} (${TEXT.length} симв.): ${TEXT}`);
  await require('./lib/mail').sendPrivateLetter(page, NICK, TEXT);
  await sleep(1400);
  console.log('ЭКРАН: ' + (await m.getBodyText(page).catch(() => '')).replace(/\s+/g, ' ').slice(0, 400));
  await ctx.close();
})();
