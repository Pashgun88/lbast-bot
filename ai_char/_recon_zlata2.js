const { chromium } = require('playwright');
const m = require('./module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  const txt = async () => (await m.getBodyText(page)).replace(/\s+/g, ' ');
  // 1) найти ник в чате и взять его ссылку
  await page.goto('http://lbast.ru/chat.php?room=12', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(1200);
  let href = await page.evaluate(() => {
    const a = Array.from(document.querySelectorAll('a')).find((x) => /^zlata$/i.test((x.innerText || '').trim()));
    return a ? a.getAttribute('href') : null;
  });
  console.log('ссылка на zlata в чате:', href);
  // 2) если нет - пробуем «Кто где?»
  if (!href) {
    await page.goto('http://lbast.ru/location.php?mod=whowhere', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(900);
    href = await page.evaluate(() => {
      const a = Array.from(document.querySelectorAll('a')).find((x) => /^zlata$/i.test((x.innerText || '').trim()));
      return a ? a.getAttribute('href') : null;
    });
    console.log('ссылка из «Кто где?»:', href);
  }
  if (href) {
    await page.goto(new URL(href, 'http://lbast.ru/').href, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(900);
    console.log('--- профиль zlata ---\n' + (await txt()).slice(0, 900));
    const links = await page.evaluate(() => Array.from(document.querySelectorAll('a')).map((a) => `${(a.innerText || '').trim()} [${a.getAttribute('href')}]`).filter((s) => s.trim()));
    console.log('ссылки профиля:', links.join(' | ').slice(0, 900));
  }
  await ctx.close();
})();
