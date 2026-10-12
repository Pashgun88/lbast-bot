const { chromium } = require('playwright');
const m = require('./module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  const txt = async () => (await m.getBodyText(page)).replace(/\s+/g, ' ');
  await page.goto('http://lbast.ru/pers.php?mod=questinfo', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(1000);
  const t = await txt();
  console.log('--- ВСЕ КВЕСТЫ ---\n' + t.slice(0, 2500));
  const herbs = await page.evaluate(() => Array.from(document.querySelectorAll('a'))
    .map((a) => ({ t: (a.innerText || '').trim(), h: a.getAttribute('href') || '' })));
  // ищем всё, что похоже на травы
  const names = t.split('•').map((s) => s.trim()).filter((s) => /трав|молодиц|змеевик|вишн|краст|пустолист|кактус|арай|прере|хмел/i.test(s));
  console.log('\nтравяные строки:', names.map((s) => s.slice(0, 70)).join(' || '));
  await ctx.close();
})();
