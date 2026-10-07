// Только чтение: раздел «Свитки и эликсиры» целиком, со всеми страницами.
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
  await open('shop.php');
  if (!(await goText('Свитки и эликсиры'))) { out.push('нет раздела «Свитки и эликсиры»'); }
  else {
    const base = page.url();
    out.push(`БАЗА: ${base}`);
    for (let p = 1; p <= 6; p++) {
      const u = p === 1 ? base : `${base}${base.includes('?') ? '&' : '?'}cpage=${p}`;
      await open(u);
      const t = (await m.getBodyText(page)).replace(/\s+/g, ' ');
      out.push(`\n===== страница ${p} =====\n${t.slice(0, 2200)}`);
      if (!/\d+\s*дин/i.test(t)) break;
    }
  }
  require('fs').writeFileSync(process.argv[2], out.join('\n'), 'utf8');
  await ctx.close();
})().catch((e) => { require('fs').writeFileSync(process.argv[2], `ОШИБКА: ${e.stack}`, 'utf8'); process.exit(1); });
