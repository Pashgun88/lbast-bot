const { chromium } = require('playwright');
const m = require('./module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  const open = async (u, w = 900) => { await page.goto(new URL(u, 'http://lbast.ru/').href, { waitUntil: 'domcontentloaded', timeout: 60000 }); await sleep(w); };
  const txt = async () => (await m.getBodyText(page).catch(() => '')).replace(/\s+/g, ' ');
  await open('location.php?mod=konj&lway=23', 2200);
  for (let i = 0; i < 8; i++) { await open('location.php', 800); if (!/В пути/.test(await txt())) break; await sleep(1200); }
  await open('loc.php?obj=5074', 1100);
  require('fs').writeFileSync(process.argv[2], (await txt()).slice(0, 400), 'utf8');
  await ctx.close();
})().catch((e) => { require('fs').writeFileSync(process.argv[2], 'ОШИБКА: ' + e.message, 'utf8'); process.exit(1); });
