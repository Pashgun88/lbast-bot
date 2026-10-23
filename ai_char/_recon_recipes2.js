const { chromium } = require('playwright');
const { getBodyText } = require('./module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  await page.goto('http://lbast.ru/location.php', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(500);
  const click = async (re) => {
    const h = await page.evaluate((src) => {
      const r = new RegExp(src, 'i');
      const a = Array.from(document.querySelectorAll('a')).find((x) => r.test((x.innerText||'').trim()));
      return a ? a.getAttribute('href') : null;
    }, re.source).catch(()=>null);
    if (!h) return false;
    await page.goto(new URL(h, page.url()).href, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(800);
    return true;
  };
  if (!(await click(/^Гильдия травников$/))) console.log('гильдии на локации нет');
  if (!(await click(/Готовить эликсиры/))) console.log('нет «Готовить эликсиры»');
  console.log('=== РЕЦЕПТЫ ===\n' + (await getBodyText(page).catch(()=>'')).replace(/[ \t]+/g,' ').slice(0, 3000));
  await ctx.close();
})();
