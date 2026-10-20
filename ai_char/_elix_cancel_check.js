// 1) отменить предложение эликсиров казне, 2) проверить, берёт ли их лавка в Стоунгарде.
const { chromium } = require('playwright');
const { getBodyText } = require('./module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const go = async (page, url) => { await page.goto(url.startsWith('http') ? url : 'http://lbast.ru/' + url, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {}); await sleep(800); };
const clickText = async (page, re) => {
  const href = await page.evaluate((src) => {
    const r = new RegExp(src, 'i');
    const a = Array.from(document.querySelectorAll('a')).find((x) => r.test((x.innerText || '').trim()));
    return a ? a.getAttribute('href') : null;
  }, re.source).catch(() => null);
  if (!href) return false;
  await go(page, new URL(href, page.url()).href);
  return true;
};
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());

  // --- 1. Передачи: что висит и чем отменяется ---
  await go(page, 'inv.php');
  if (!(await clickText(page, /^Передачи$/))) console.log('ссылки «Передачи» нет');
  console.log('=== ПЕРЕДАЧИ ===\n' + (await getBodyText(page).catch(()=>'')).replace(/[ \t]+/g,' ').slice(0, 1500));
  const links = await page.$$eval('a', (as) => as.map((a) => `«${(a.innerText||'').trim()}» -> ${a.getAttribute('href')}`));
  console.log('--- ссылки: ' + links.filter((l) => l.length < 160).join('\n    '));
  await ctx.close();
})();
