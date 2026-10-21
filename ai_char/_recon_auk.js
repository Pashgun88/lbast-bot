const { chromium } = require('playwright');
const { getBodyText } = require('./module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  const dump = async (label, url, lim=1200) => {
    await page.goto('http://lbast.ru/' + url, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(()=>{});
    await sleep(600);
    const t = (await getBodyText(page).catch(()=>'')).replace(/[ \t]+/g,' ');
    console.log(`\n=== ${label} (${url}) ===\n` + t.slice(0, lim));
  };
  // центральная площадь Стоунгарда
  await page.goto('http://lbast.ru/location.php', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(600);
  const cp = await page.evaluate(() => {
    const a = Array.from(document.querySelectorAll('a')).find((x) => /Центральная площадь/i.test((x.innerText||'').trim()));
    return a ? a.getAttribute('href') : null;
  });
  if (cp) {
    await page.goto(new URL(cp, 'http://lbast.ru/').href, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(700);
    const t = (await getBodyText(page).catch(()=>'')).replace(/[ \t]+/g,' ');
    console.log('=== ЦЕНТРАЛЬНАЯ ПЛОЩАДЬ ===\n' + t.slice(0, 1500));
    const links = await page.$$eval('a', (as) => as.map((a) => `«${(a.innerText||'').trim()}» -> ${a.getAttribute('href')}`));
    console.log('--- ссылки: ' + links.join(' | '));
  } else console.log('ссылки на Центральную площадь нет');
  for (const u of ['auk.php','auction.php','torg.php','market.php']) await dump(u, u, 400);
  await ctx.close();
})();
