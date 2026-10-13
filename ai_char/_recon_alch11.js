// Только чтение: точки амулета (ищем Дорожный крест) и страница Гильдии травников.
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
  const step = async (name) => { for (let i = 0; i < 3; i++) { const ls = await links(); const h = ls.find((l) => l.t === name); if (h) { await open(h.h, 800); return true; } await sleep(900); await open('location.php', 600); } return false; };

  await open('location.php?mod=fastway');
  out.push(`АМУЛЕТ: ${(await txt()).slice(0, 900)}`);
  out.push(`ТОЧКИ: ${(await links()).filter((l) => /fastway|lway/.test(l.h)).map((l) => l.t + ' -> ' + l.h.replace(/r=\d+&?/, '')).join(' | ')}`);

  await open('location.php?mod=konj&lway=2', 2200);
  for (let i = 0; i < 6; i++) { await open('location.php', 700); const ls = await links(); if (ls.some((l) => l.t === 'Идти на восток - в город')) break; await sleep(1200); }
  for (let i = 0; i < 4; i++) { if (!(await step('Идти на север'))) out.push('!! север сорвался на шаге ' + i); }
  out.push(`\nЛОКАЦИЯ: ${(await txt()).slice(0, 400)}`);
  if (await step('Гильдия травников')) {
    out.push(`\n===== ГИЛЬДИЯ ТРАВНИКОВ =====\n${(await txt()).slice(0, 2500)}`);
    out.push(`ССЫЛКИ: ${(await links()).map((l) => l.t + ' -> ' + l.h.replace(/r=\d+&?/, '')).join(' | ').slice(0, 2000)}`);
  } else out.push('!! ссылку в гильдию не нашёл');
  require('fs').writeFileSync(process.argv[2], out.join('\n'), 'utf8');
  await ctx.close();
})().catch((e) => { require('fs').writeFileSync(process.argv[2], `ОШИБКА: ${e.stack}\n${out.join('\n')}`, 'utf8'); process.exit(1); });
