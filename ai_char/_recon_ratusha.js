const { chromium } = require('playwright');
const { getBodyText } = require('./module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const goLink = async (page, re, label) => {
  const href = await page.evaluate((src) => {
    const r = new RegExp(src, 'i');
    const a = Array.from(document.querySelectorAll('a')).find((x) => r.test((x.innerText || '').trim()));
    return a ? a.getAttribute('href') : null;
  }, re.source).catch(() => null);
  if (!href) { console.log('нет ссылки: ' + label); return false; }
  await page.goto(new URL(href, page.url()).href, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(800);
  return true;
};
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  await page.goto('http://lbast.ru/location.php?mod=fastway&lway=2', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(7000);
  await page.goto('http://lbast.ru/location.php', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(700);
  for (const [re, label] of [[/Северные ворота/, 'Северные ворота'], [/^Идти на север/, 'на север'], [/Магистратура/, 'Магистратура'], [/^Ратуша$/, 'Ратуша']]) {
    if (!(await goLink(page, re, label))) { await ctx.close(); return; }
  }
  const t = (await getBodyText(page).catch(()=>'')).replace(/[ \t]+/g,' ');
  console.log('=== РАТУША ===\n' + t.slice(0, 3000));
  const links = await page.$$eval('a', (as) => as.map((a) => `«${(a.innerText||'').trim()}» -> ${a.getAttribute('href')}`));
  console.log('\n--- ссылки ---\n' + links.join('\n'));
  // если есть ссылка про аукцион - открыть
  const auc = await page.evaluate(() => {
    const a = Array.from(document.querySelectorAll('a')).find((x) => /аукцион/i.test((x.innerText||'').trim()));
    return a ? a.getAttribute('href') : null;
  });
  if (auc) {
    await page.goto(new URL(auc, page.url()).href, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(800);
    console.log('\n=== СТРАНИЦА АУКЦИОНОВ ===\n' + (await getBodyText(page).catch(()=>'')).replace(/[ \t]+/g,' ').slice(0, 3000));
  }
  await ctx.close();
})();
