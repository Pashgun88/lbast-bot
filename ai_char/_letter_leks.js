const { chromium } = require('playwright');
const m = require('./module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const NICK = '_leks_';
const TEXT = 'Привет) Говорят, у тебя есть комплект мастера Ордо. Продаёшь? Сколько за него просишь?';
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  const { sendPrivateLetter } = require('./lib/mail');
  console.log('письмо для ' + NICK + ' (' + TEXT.length + ' симв.): ' + TEXT);
  await sendPrivateLetter(page, NICK, TEXT);
  await sleep(1200);
  const t = (await m.getBodyText(page).catch(() => '')).replace(/[ \t]+/g, ' ');
  console.log('\n=== ЭКРАН ПОСЛЕ ОТПРАВКИ ===\n' + t.slice(0, 900));
  // проверка: письмо должно быть видно в исходящих/переписке
  await page.goto('http://lbast.ru/letters.php', { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
  await sleep(900);
  const box = (await m.getBodyText(page).catch(() => '')).replace(/[ \t]+/g, ' ');
  console.log('\n=== ПОЧТА ===\n' + box.slice(0, 900));
  await ctx.close();
})();
