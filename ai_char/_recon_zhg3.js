const { chromium } = require('playwright');
const m = require('./module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  const txt = async () => (await m.getBodyText(page)).replace(/\s+/g, ' ');
  await page.goto('http://lbast.ru/zhg.php?mod=last', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(800);
  const s = await page.evaluate(() => {
    const a = Array.from(document.querySelectorAll('a')).find((x) => /^Поиск$/i.test((x.innerText || '').trim()));
    return a ? a.getAttribute('href') : null;
  });
  await page.goto(new URL(s, 'http://lbast.ru/').href, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(900);
  console.log('--- ПОИСК ---\n' + (await txt()).slice(0, 600));
  const inputs = await page.evaluate(() => Array.from(document.querySelectorAll('input,select,textarea'))
    .map((e) => `${e.tagName}:${e.getAttribute('name')}:${e.getAttribute('type') || ''}`));
  console.log('поля:', inputs.join(' | '));
  await ctx.close();
})();
