const { chromium } = require('playwright');
const { getBodyText } = require('./module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const go = async (page, url) => { await page.goto(url.startsWith('http') ? url : 'http://lbast.ru/' + url, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {}); await sleep(900); };
const hrefByText = (page, src) => page.evaluate((s) => {
  const r = new RegExp(s, 'i');
  const a = Array.from(document.querySelectorAll('a')).find((x) => r.test((x.innerText || '').trim()));
  return a ? a.getAttribute('href') : null;
}, src);
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  await go(page, 'location.php?mod=fastway&lway=2');
  await sleep(6000);
  await go(page, 'location.php');
  console.log('=== СТОУНГАРД ===\n' + (await getBodyText(page).catch(()=>'')).replace(/[ \t]+/g,' ').slice(0, 900));
  const mag = await hrefByText(page, '^Магазин$');
  await go(page, new URL(mag, 'http://lbast.ru/').href);
  const shops = await page.$$eval('a', (as) => as.map((a) => ({ t: (a.innerText||'').trim(), h: a.getAttribute('href') })).filter((x) => /лавка|магазин|склад|скуп|алхим|зель|трав/i.test(x.t)));
  console.log('\n=== ЛАВКИ В МАГАЗИНЕ ===\n' + shops.map((s) => `«${s.t}» -> ${s.h}`).join('\n'));
  for (const s of shops) {
    await go(page, new URL(s.h, 'http://lbast.ru/').href);
    const sell = await hrefByText(page, '^Продать$');
    if (!sell) { console.log(`\n[${s.t}] ссылки «Продать» нет`); continue; }
    await go(page, new URL(sell, 'http://lbast.ru/').href);
    const t = (await getBodyText(page).catch(()=>'')).replace(/[ \t]+/g,' ');
    const rows = [...t.matchAll(/([^\n\[]{3,60}?)\s*\[(\d+)\]\s*-\s*(\d+)\s*дин/g)].map((m) => `${m[1].trim()} [${m[2]}] - ${m[3]} дин`);
    console.log(`\n[${s.t}] принимает: ` + (rows.join(' | ') || 'ничего из нашей сумки'));
  }
  await ctx.close();
})();
