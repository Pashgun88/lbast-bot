const { chromium } = require('playwright');
const { getBodyText } = require('./module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const state = async (page) => {
  const t = (await getBodyText(page).catch(()=>'')).replace(/[ \t]+/g,' ');
  const links = await page.$$eval('a', (as) => as.map((a) => (a.innerText||'').trim()).filter(Boolean));
  return { t, links };
};
const goLink = async (page, re) => {
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
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  await page.goto('http://lbast.ru/location.php?mod=fastway&lway=2', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(7000);
  await page.goto('http://lbast.ru/location.php', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(700);
  if (!(await goLink(page, /Северные ворота/))) { console.log('нет Северных ворот'); await ctx.close(); return; }
  if (!(await goLink(page, /^Идти на север/))) { console.log('нет выхода на север'); await ctx.close(); return; }
  for (let i = 1; i <= 6; i++) {
    const { t, links } = await state(page);
    console.log(`\n--- шаг ${i} ---\n` + t.split('\n').filter((l)=>l.trim()).slice(0, 12).join('\n'));
    console.log('ссылки: ' + links.join(' | '));
    const west = links.find((l) => /на запад/i.test(l));
    if (west) { console.log('>>> есть поворот на запад: ' + west); break; }
    if (!(await goLink(page, /^Идти на север/))) { console.log('дальше на север нельзя'); break; }
  }
  await ctx.close();
})();
