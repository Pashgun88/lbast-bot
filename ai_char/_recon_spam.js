const { chromium } = require('playwright');
const { getBodyText } = require('./module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const goLink = async (page, re) => {
  const href = await page.evaluate((src) => {
    const r = new RegExp(src, 'i');
    const a = Array.from(document.querySelectorAll('a')).find((x) => r.test((x.innerText || '').trim()));
    return a ? a.getAttribute('href') : null;
  }, re.source).catch(() => null);
  if (!href) return false;
  await page.goto(new URL(href, page.url()).href, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(800);
  return true;
};
const show = async (page, label) => {
  const t = (await getBodyText(page).catch(()=>'')).replace(/[ \t]+/g,' ');
  console.log(`\n=== ${label} (${page.url()}) ===\n` + t.slice(0, 1800));
  const links = await page.$$eval('a', (as) => as.map((a) => `«${(a.innerText||'').trim()}» -> ${a.getAttribute('href')}`));
  console.log('--- ссылки: ' + links.filter((l)=>!/Обновить|В игру|Размер текста/.test(l)).join(' | '));
  const forms = await page.$$eval('form', (fs) => fs.map((f) => ({ action: f.getAttribute('action'), method: f.getAttribute('method'),
    fields: Array.from(f.querySelectorAll('input,textarea,select')).map((i) => `${i.tagName}:${i.name || '-'}:${i.type || ''}`) })));
  if (forms.length) console.log('--- формы: ' + JSON.stringify(forms));
};
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  await page.goto('http://lbast.ru/letters.php', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(800);
  await show(page, 'ПИСЬМА');
  if (!(await goLink(page, /Доска событий/))) { console.log('нет ссылки «Доска событий»'); await ctx.close(); return; }
  await show(page, 'ДОСКА СОБЫТИЙ');
  if (!(await goLink(page, /Дать спам/))) { console.log('нет ссылки «Дать спам»'); await ctx.close(); return; }
  await show(page, 'ДАТЬ СПАМ');
  await ctx.close();
})();
