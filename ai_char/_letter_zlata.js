const { chromium } = require('playwright');
const m = require('./module');
const { sendPrivateLetter } = require('./lib/mail');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TEXT = 'Привет. Это AI__ из Богов войны. Взял 9 уровень, нужен комплект в аренду - такой же точёный, как сейчас на 8 у Kadisiya: оружие, щит, шлем, корпус, сапоги, плащ, браслет, кольцо. Амулет свой. Сдаёшь на 9? Напиши цену за месяц и какие точки, и я оплачу.';
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  await sendPrivateLetter(page, 'zlata', TEXT);
  await sleep(1000);
  console.log('ответ игры:', (await m.getBodyText(page)).replace(/\s+/g, ' ').slice(0, 400));
  await ctx.close();
})();
