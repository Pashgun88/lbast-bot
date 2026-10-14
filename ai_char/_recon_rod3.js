// Только чтение: экран рыбалки на Ивовом озере и что он предлагает без удочки.
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
  await open('location.php?mod=konj&lway=23', 2200);
  for (let i = 0; i < 8; i++) { await open('location.php', 800); if (!/В пути/.test(await txt())) break; await sleep(1200); }
  out.push(`ОЗЕРО: ${(await txt()).slice(0, 500)}`);
  out.push(`ССЫЛКИ: ${(await links()).map((l) => l.t + ' -> ' + l.h.replace(/r=\d+&?/, '')).join(' | ').slice(0, 1000)}`);
  const ls = await links();
  const fish = ls.find((l) => /^Рыбачить$/.test(l.t));
  if (fish) {
    await open(fish.h, 1100);
    out.push(`\nЭКРАН РЫБАЛКИ: ${(await txt()).slice(0, 800)}`);
    out.push(`ССЫЛКИ: ${(await links()).map((l) => l.t + ' -> ' + l.h.replace(/r=\d+&?/, '')).join(' | ').slice(0, 1000)}`);
  }
  require('fs').writeFileSync(process.argv[2], out.join('\n'), 'utf8');
  await ctx.close();
})().catch((e) => { require('fs').writeFileSync(process.argv[2], `ОШИБКА: ${e.stack}\n${out.join('\n')}`, 'utf8'); process.exit(1); });
