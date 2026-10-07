// Только чтение: описание свитка и зелья (срок годности) + как устроено «Избранное» (пояс).
const { chromium } = require('playwright');
const m = require('./module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = [];
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  const open = async (u, w = 800) => { await page.goto(new URL(u, 'http://lbast.ru/').href, { waitUntil: 'domcontentloaded', timeout: 60000 }); await sleep(w); };
  const goText = async (t) => {
    const h = await page.evaluate((txt) => {
      const a = Array.from(document.querySelectorAll('a')).find((x) => (x.innerText || '').trim() === txt);
      return a ? a.getAttribute('href') : null;
    }, t);
    if (!h) return false;
    await open(h);
    return true;
  };
  const dump = async (title, n = 1800) => {
    const t = (await m.getBodyText(page)).replace(/\s+/g, ' ');
    out.push(`\n===== ${title} =====\nURL: ${page.url()}\n${t.slice(0, n)}`);
  };
  // 1) Избранное - похоже, это и есть боевой пояс
  await open('inv.php');
  if (await goText('Избранное')) await dump('Избранное (пояс?)', 2200);
  else out.push('ссылки «Избранное» нет');
  const ls = await page.evaluate(() => Array.from(document.querySelectorAll('a'))
    .map((a) => ({ t: (a.innerText || '').trim(), h: a.getAttribute('href') || '' })).filter((x) => x.t && x.h));
  out.push(`ССЫЛКИ: ${ls.map((l) => `${l.t} -> ${l.h}`).join('\n  ').slice(0, 1500)}`);

  // 2) описания товаров: ссылки «на N ур.» в магазине ведут на инфо
  await open('shop.php');
  await goText('Свитки и эликсиры');
  const info = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('a'))
      .map((a) => ({ t: (a.innerText || '').trim(), h: a.getAttribute('href') || '' }));
    return rows.filter((r) => /ур\./i.test(r.t) || /infa/i.test(r.h)).slice(0, 30);
  });
  out.push(`\nИНФО-ССЫЛКИ МАГАЗИНА: ${info.map((r) => `${r.t} -> ${r.h}`).join('\n  ').slice(0, 1500)}`);
  require('fs').writeFileSync(process.argv[2], out.join('\n'), 'utf8');
  await ctx.close();
})().catch((e) => { require('fs').writeFileSync(process.argv[2], `ОШИБКА: ${e.stack}`, 'utf8'); process.exit(1); });
