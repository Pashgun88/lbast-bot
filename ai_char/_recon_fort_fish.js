const { chromium } = require('playwright');
const { getBodyText } = require('./module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const click = async (page, re) => {
  const href = await page.evaluate((src) => {
    const r = new RegExp(src, 'i');
    const a = Array.from(document.querySelectorAll('a')).find((x) => r.test((x.innerText || '').trim()));
    return a ? a.getAttribute('href') : null;
  }, re.source).catch(() => null);
  if (!href) return false;
  await page.goto(new URL(href, page.url()).href, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(900);
  return true;
};
const show = async (page, label, lim = 1400) => {
  const t = (await getBodyText(page).catch(()=>'')).replace(/[ \t]+/g,' ');
  console.log(`\n=== ${label} ===\n` + t.slice(0, lim));
  const links = await page.$$eval('a', (as) => as.map((a) => (a.innerText||'').trim()).filter(Boolean));
  console.log('--- ссылки: ' + [...new Set(links)].join(' | '));
  return t;
};
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  await page.goto('http://lbast.ru/location.php', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(700);
  if (!(await click(page, /^Конь$/))) { console.log('нет ссылки Конь'); await ctx.close(); return; }
  await show(page, 'КОНЬ', 1200);
  if (!(await click(page, /Жженого листа/))) { console.log('нет пункта «Жженого листа»'); await ctx.close(); return; }
  for (let i = 0; i < 20; i++) {
    const t = (await getBodyText(page).catch(()=>''));
    if (!/В пути/i.test(t)) break;
    await sleep(3000);
    await page.goto('http://lbast.ru/location.php', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(()=>{});
  }
  const t = await show(page, 'ФОРТ ЖЖЁНОГО ЛИСТА', 1600);
  if (/рыбач|рыбал|удочк/i.test(t)) console.log('>>> рыбалка видна прямо тут');
  await ctx.close();
})();
