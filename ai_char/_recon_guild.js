const { chromium } = require('playwright');
const m = require('./module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  const txt = async () => (await m.getBodyText(page)).replace(/\s+/g, ' ');
  // анкета: подтвердить членство
  await page.goto('http://lbast.ru/log_infa.php?mod=who&blogin=AI__', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(900);
  const t = await txt();
  console.log('анкета:', (t.match(/Гильдия[^»]{0,40}/) || ['гильдия не указана'])[0]);
  console.log('титул/мораль:', (t.match(/Титул:[^»]{0,30}/) || ['-'])[0]);
  // пробуем объект гильдии напрямую
  await page.goto('http://lbast.ru/loc.php?obj=5163', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  await sleep(900);
  console.log('--- obj=5163 ---\n' + (await txt()).slice(0, 900));
  const links = await page.evaluate(() => Array.from(document.querySelectorAll('a'))
    .map((a) => `${(a.innerText || '').trim()} [${a.getAttribute('href')}]`).filter((s) => s.trim().length > 2));
  console.log('ссылки:', links.join(' | ').slice(0, 800));
  await ctx.close();
})();
