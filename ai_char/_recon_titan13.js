const { chromium } = require('playwright');
const m = require('./module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  await page.goto('http://lbast.ru/location.php?mod=fastway&lway=2', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(1200);
  // все ссылки центра
  const l = await page.$$eval('a', (as) => as.map((a) => ({ t: (a.textContent || '').trim(), h: a.getAttribute('href') || '' })));
  console.log('ЦЕНТР: ' + l.filter((a) => a.t).map((a) => a.t + '->' + a.h).join(' | '));
  const open = async (label, href) => {
    await page.goto(new URL(href, 'http://lbast.ru/').href, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch((e) => console.log('ERR ' + e.message));
    await sleep(900);
    const t = (await m.getBodyText(page).catch(() => '')).replace(/[ \t]+/g, ' ');
    console.log('\n=== ' + label + ' ===' + (/итан/i.test(t) ? '  <<< ТИТАН' : '') + '\n' + t.slice(0, 2200));
    const ll = await page.$$eval('a', (as) => as.map((a) => (a.textContent || '').trim() + ' -> ' + (a.getAttribute('href') || '')));
    console.log('ССЫЛКИ: ' + ll.filter((s) => s.length > 4 && !/Чат|Форум|ЖГ|Карта|Кланы|Бои|Амулет|Конь|Выход|Размер|Кто здесь/.test(s)).join(' | ').slice(0, 1200));
  };
  const akad = l.find((a) => /Академия/.test(a.t));
  if (akad) await open('АКАДЕМИЯ ЗНАНИЙ', akad.h);
  await ctx.close();
})();
