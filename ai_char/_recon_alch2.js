// Только чтение: как добраться до Гильдии травников и Лаборатории травника.
const { chromium } = require('playwright');
const m = require('./module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = [];
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  const open = async (u, w = 900) => { await page.goto(new URL(u, 'http://lbast.ru/').href, { waitUntil: 'domcontentloaded', timeout: 60000 }); await sleep(w); };
  const txt = async () => (await m.getBodyText(page).catch(() => '')).replace(/\s+/g, ' ');
  const links = () => page.evaluate(() => Array.from(document.querySelectorAll('a')).map((a) => `${(a.innerText || '').trim()} -> ${a.getAttribute('href') || ''}`).filter((s) => s.trim().length > 3));

  // куда возит конь
  await open('location.php?mod=konj');
  out.push(`===== КОНЬ =====\n${(await txt()).slice(0, 1500)}`);
  out.push(`ССЫЛКИ КОНЯ: ${(await links()).join(' | ').slice(0, 2500)}`);

  // справка про травника/гильдию
  for (const w of ['травник', 'гильдия травников', 'эликсир']) {
    await open('library/help/index.php?mod=search&look=' + encodeURIComponent(w)).catch(() => {});
    out.push(`\n[СПРАВКА ${w}] ${(await txt()).slice(0, 600)}`);
  }
  require('fs').writeFileSync(process.argv[2], out.join('\n'), 'utf8');
  await ctx.close();
})().catch((e) => { require('fs').writeFileSync(process.argv[2], `ОШИБКА: ${e.stack}\n${out.join('\n')}`, 'utf8'); process.exit(1); });
