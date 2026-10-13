// Только чтение: страницы гильдии травников + проверка маршрута от Дорожного креста.
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

  // 1. маршрут Паши: Дорожный крест -> юг -> юг
  await open('location.php?mod=fastway&lway=9', 1800);
  for (let i = 0; i < 5; i++) { await open('location.php', 700); if ((await txt()).length > 80) break; await sleep(1000); }
  out.push(`КРЕСТ: ${(await txt()).slice(0, 300)}`);
  const ok1 = await step('Идти на юг');
  out.push(`юг1 (${ok1}): ${(await txt()).slice(0, 220)}`);
  const ok2 = await step('Идти на юг');
  out.push(`юг2 (${ok2}): ${(await txt()).slice(0, 220)}`);

  // 2. страницы гильдии
  for (const go of [1, 4, 5]) {
    await open(`loc.php?obj=5134&go=${go}`, 1000);
    out.push(`\n===== go=${go} =====\n${(await txt()).slice(0, 2500)}`);
    out.push(`ССЫЛКИ: ${(await links()).map((l) => l.t + ' -> ' + l.h.replace(/r=\d+&?/, '')).join(' | ').slice(0, 2000)}`);
  }
  require('fs').writeFileSync(process.argv[2], out.join('\n'), 'utf8');
  await ctx.close();
})().catch((e) => { require('fs').writeFileSync(process.argv[2], `ОШИБКА: ${e.stack}\n${out.join('\n')}`, 'utf8'); process.exit(1); });
