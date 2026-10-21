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
  await sleep(900);
  return true;
};
const show = async (page, label) => {
  const t = (await getBodyText(page).catch(()=>'')).replace(/[ \t]+/g,' ');
  console.log(`\n--- ${label} ---\n` + t.split('\n').filter((l)=>l.trim()).slice(0, 14).join('\n'));
};
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  await page.goto('http://lbast.ru/location.php', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(700);
  await show(page, 'где стоим');
  for (let i = 1; i <= 3; i++) {
    if (!(await goLink(page, /^Идти на запад/))) { console.log(`на запад дальше нельзя (шаг ${i})`); break; }
    await show(page, `запад ${i}`);
  }
  // ищем ратушу
  const rat = await page.evaluate(() => {
    const a = Array.from(document.querySelectorAll('a')).find((x) => /ратуш/i.test((x.innerText||'').trim()));
    return a ? { t: a.innerText.trim(), h: a.getAttribute('href') } : null;
  });
  console.log('\nссылка на ратушу: ' + JSON.stringify(rat));
  if (rat) {
    await page.goto(new URL(rat.h, page.url()).href, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(900);
    const t = (await getBodyText(page).catch(()=>'')).replace(/[ \t]+/g,' ');
    console.log('\n=== РАТУША ===\n' + t.slice(0, 3000));
    const links = await page.$$eval('a', (as) => as.map((a) => `«${(a.innerText||'').trim()}» -> ${a.getAttribute('href')}`));
    console.log('--- ссылки: ' + links.join(' | '));
  }
  await ctx.close();
})();
