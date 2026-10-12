const { chromium } = require('playwright');
const m = require('./module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const NICK = 'zlata';
const TEXT = 'Привет) Нашёл в жг. Беру комплект мастера Ордо на 9 ур, на месяц, 1,5к. Скинь аренду - дины сразу отправлю.';
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  const { sendPrivateLetter } = require('./lib/mail');
  console.log('письмо для ' + NICK + ' (' + TEXT.length + ' симв.): ' + TEXT);
  await sendPrivateLetter(page, NICK, TEXT);
  await sleep(1300);
  console.log('\n=== ЭКРАН ===\n' + (await m.getBodyText(page).catch(() => '')).replace(/[ \t]+/g, ' ').slice(0, 600));
  // сколько у нас денег и нет ли уже висящего предложения аренды
  await page.goto('http://lbast.ru/inv.php', { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
  await sleep(900);
  const inv = (await m.getBodyText(page).catch(() => '')).replace(/[ \t]+/g, ' ');
  const money = (inv.match(/У вас (\d+) дин/) || [])[1];
  console.log('\nденег: ' + (money || '?') + ' дин');
  const l = await page.$$eval('a', (as) => as.map((a) => (a.textContent || '').trim()).filter((t) => /аренд/i.test(t))).catch(() => []);
  console.log('ссылки про аренду в инвентаре: ' + (l.join(' | ') || 'нет'));
  await ctx.close();
})();
