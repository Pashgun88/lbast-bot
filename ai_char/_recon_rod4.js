// Только чтение: ищем удочку в магазине Стоунгарда (все отделы и страницы покупки).
const { chromium } = require('playwright');
const m = require('./module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = [];
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  const open = async (u, w = 900) => { await page.goto(new URL(u, 'http://lbast.ru/').href, { waitUntil: 'domcontentloaded', timeout: 60000 }); await sleep(w); };
  const txt = async () => (await m.getBodyText(page).catch(() => '')).replace(/\s+/g, ' ');
  const links = () => page.evaluate(() => Array.from(document.querySelectorAll('a')).map((a) => ({ t: (a.innerText || '').trim(), h: a.getAttribute('href') || '' })).filter((x) => x.t && x.h));
  const click = async (re) => { const ls = await links(); const h = ls.find((l) => re.test(l.t)); if (!h) return false; await open(h.h, 900); return true; };
  await open('location.php?mod=fastway&lway=2', 1800);
  for (let i = 0; i < 6; i++) { await open('location.php', 700); if (/Стоунгард/.test(await txt())) break; await sleep(1000); }
  if (!(await click(/^Магазин$/))) { out.push('Магазина нет на экране: ' + (await txt()).slice(0, 300)); }
  out.push(`МАГАЗИН: ${(await txt()).slice(0, 500)}`);
  const depts = (await links()).filter((l) => !/^(Обновить|Чат|В игру|Инвентарь|Форум|AI__|Выход)/.test(l.t));
  out.push(`ОТДЕЛЫ: ${depts.map((l) => l.t + ' -> ' + l.h.replace(/r=\d+&?/, '')).join(' | ')}`);
  for (const d of depts) {
    await open(d.h, 900);
    let found = null;
    for (let cp = 1; cp <= 6; cp += 1) {
      if (cp > 1) { const u = new URL(page.url()); u.searchParams.set('cpage', String(cp)); await open(u.href, 800); }
      const t = await txt();
      const hit = t.match(/[Уу]доч[^|]{0,40}/g);
      if (hit) { found = `стр.${cp}: ${hit.join(' | ')}`; break; }
      if (!/дин/.test(t)) break;
    }
    out.push(`\n--- ${d.t} --- ${found || 'удочки нет'}`);
  }
  require('fs').writeFileSync(process.argv[2], out.join('\n'), 'utf8');
  await ctx.close();
})().catch((e) => { require('fs').writeFileSync(process.argv[2], `ОШИБКА: ${e.stack}\n${out.join('\n')}`, 'utf8'); process.exit(1); });
