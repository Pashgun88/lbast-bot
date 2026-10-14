// Только чтение: где удочка - в сумке, в сундуке дома, в логе передач или в экипировке.
const { chromium } = require('playwright');
const m = require('./module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = [];
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  const open = async (u, w = 900) => { await page.goto(new URL(u, 'http://lbast.ru/').href, { waitUntil: 'domcontentloaded', timeout: 60000 }); await sleep(w); };
  const txt = async () => (await m.getBodyText(page).catch(() => '')).replace(/\s+/g, ' ');
  for (const u of ['inv.php', 'inv.php?cpage=2', 'inv.php?cpage=3', 'inv.php?cpage=4', 'inv.php?mod=outfit']) {
    await open(u);
    const t = await txt();
    const hit = t.match(/[^ ]{0,20}[Уу]доч[^ ]{0,20}|[^ ]{0,15}снаст[^ ]{0,15}/g);
    out.push(`${u}: ${hit ? hit.join(' | ') : 'удочки нет'}`);
  }
  // лог передач и журнал
  for (const u of ['inv.php?mod=sendlog', 'inv.php?mod=send', 'log_infa.php?mod=dnevnik']) {
    await open(u, 1000);
    out.push(`\n===== ${u} =====\n${(await txt()).slice(0, 1200)}`);
  }
  require('fs').writeFileSync(process.argv[2], out.join('\n'), 'utf8');
  await ctx.close();
})().catch((e) => { require('fs').writeFileSync(process.argv[2], `ОШИБКА: ${e.stack}\n${out.join('\n')}`, 'utf8'); process.exit(1); });
