const { chromium } = require('playwright');
const { getBodyText } = require('./module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const go = async (page, url) => { await page.goto(url.startsWith('http') ? url : 'http://lbast.ru/' + url, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {}); await sleep(900); };
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

  // --- 1. отмена предложения с эликсирами (ищем свежий offer_id рядом с названием) ---
  await go(page, 'inv.php?mod=offers');
  const cancelHref = await page.evaluate(() => {
    const all = Array.from(document.querySelectorAll('a'));
    for (let i = 0; i < all.length; i++) {
      if (!/эликсир каменного голема/i.test((all[i].innerText || '').trim())) continue;
      for (let k = i + 1; k < Math.min(i + 8, all.length); k++) {
        if (/^Отказаться$/i.test((all[k].innerText || '').trim())) return all[k].getAttribute('href');
      }
    }
    return null;
  });
  console.log('отмена: ' + cancelHref);
  if (cancelHref) {
    await go(page, new URL(cancelHref, 'http://lbast.ru/').href);
    console.log('после отмены:\n' + (await getBodyText(page).catch(()=>'')).replace(/[ \t]+/g,' ').slice(0, 700));
    await go(page, 'inv.php?mod=offers');
    const t = (await getBodyText(page).catch(()=>'')).replace(/[ \t]+/g,' ');
    console.log('эликсиры в передачах остались: ' + /эликсир каменного голема/i.test(t));
  }

  // --- 2. берёт ли лавка боевых ресурсов эликсиры ---
  await go(page, 'location.php?mod=fastway&lway=2');
  await sleep(6000);
  await go(page, 'location.php');
  for (const re of [/^Магазин$/, /^Лавка боевых ресурсов$/, /^Продать$/]) {
    if (!(await clickText(page, re))) { console.log('нет ссылки ' + re); await ctx.close(); return; }
  }
  const saleUrl = page.url();
  let hit = null;
  const names = [];
  for (let cpage = 1; cpage <= 8; cpage++) {
    if (cpage > 1) { const u = new URL(saleUrl); u.searchParams.set('cpage', String(cpage)); await go(page, u.href); }
    const t = (await getBodyText(page).catch(()=>'')).replace(/[ \t]+/g,' ');
    const rows = [...t.matchAll(/([^\n\[]{3,60}?)\s*\[(\d+)\]\s*-\s*(\d+)\s*дин/g)].map((m) => `${m[1].trim()} [${m[2]}] - ${m[3]} дин`);
    if (!rows.length) break;
    rows.forEach((r) => { if (!names.includes(r)) names.push(r); });
    const e = rows.find((r) => /эликсир каменного голема/i.test(r));
    if (e) hit = e;
  }
  console.log('\n=== СПИСОК ЛАВКИ (что она принимает) ===\n' + names.join('\n'));
  console.log('\nэликсир каменного голема в списке: ' + (hit || 'НЕТ'));
  await ctx.close();
})();
