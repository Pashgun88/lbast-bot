const { chromium } = require('playwright');
const { getBodyText } = require('./module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const click = async (page, re) => {
  const href = await page.evaluate((src) => {
    const r = new RegExp(src, 'i');
    const a = Array.from(document.querySelectorAll('a')).find((x) => r.test((x.innerText || '').trim()));
    return a ? a.getAttribute('href') : null;
  }, re.source).catch(() => null);
  if (!href) return null;
  await page.goto(new URL(href, page.url()).href, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(800);
  return href;
};
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  await page.goto('http://lbast.ru/location.php', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(600);
  const h = await click(page, /^Рыбалка$/);
  console.log('ссылка «Рыбалка»: ' + h);
  const t = (await getBodyText(page).catch(()=>'')).replace(/[ \t]+/g,' ');
  console.log('=== СТРАНИЦА РЫБАЛКИ ===\n' + t.slice(0, 2500));
  const links = await page.$$eval('a', (as) => as.map((a) => `«${(a.innerText||'').trim()}» -> ${a.getAttribute('href')}`));
  console.log('\n--- ссылки ---\n' + links.filter((l)=>!/Размер текста|Выход/.test(l)).join('\n'));
  const forms = await page.$$eval('form', (fs) => fs.map((f) => ({ action: f.getAttribute('action'),
    fields: Array.from(f.querySelectorAll('input,textarea,select')).map((i) => `${i.name||'-'}:${i.type}:${i.value||''}`) })));
  console.log('--- формы: ' + JSON.stringify(forms));
  await ctx.close();
})();
