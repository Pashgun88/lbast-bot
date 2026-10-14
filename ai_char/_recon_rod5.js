// Только чтение: что предлагает Старый рыбак в Рыбацкой деревне.
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
  await open('location.php?mod=konj&lway=7', 2200);
  for (let i = 0; i < 8; i++) { await open('location.php', 800); if (!/В пути/.test(await txt())) break; await sleep(1200); }
  const ls = await links();
  for (const name of ['Старый рыбак', 'Дом старьевщика']) {
    const h = ls.find((l) => l.t === name);
    if (!h) { out.push(`${name}: ссылки нет`); continue; }
    await open(h.h, 1000);
    out.push(`\n===== ${name} =====\n${(await txt()).slice(0, 900)}`);
    out.push(`ССЫЛКИ: ${(await links()).map((l) => l.t + ' -> ' + l.h.replace(/r=\d+&?/, '')).join(' | ').slice(0, 900)}`);
    await open('location.php', 700);
  }
  require('fs').writeFileSync(process.argv[2], out.join('\n'), 'utf8');
  await ctx.close();
})().catch((e) => { require('fs').writeFileSync(process.argv[2], `ОШИБКА: ${e.stack}\n${out.join('\n')}`, 'utf8'); process.exit(1); });
