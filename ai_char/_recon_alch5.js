const { chromium } = require('playwright');
const m = require('./module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = [];
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  const open = async (u, w = 1200) => { await page.goto(new URL(u, 'http://lbast.ru/').href, { waitUntil: 'domcontentloaded', timeout: 60000 }); await sleep(w); };
  const txt = async () => (await m.getBodyText(page).catch(() => '')).replace(/\s+/g, ' ');
  const links = () => page.evaluate(() => Array.from(document.querySelectorAll('a')).map((a) => ({ t: (a.innerText || '').trim(), h: a.getAttribute('href') || '' })).filter((x) => x.t && x.h));
  await open('location.php?mod=konj&lway=2', 2500);
  out.push(`ПОЕЗДКА: ${(await txt()).slice(0, 500)}`);
  out.push(`ССЫЛКИ: ${(await links()).map((l) => l.t + ' -> ' + l.h).join(' | ').slice(0, 1200)}`);
  await open('location.php', 1500);
  out.push(`\nПОСЛЕ: ${(await txt()).slice(0, 700)}`);
  out.push(`ССЫЛКИ: ${(await links()).map((l) => l.t + ' -> ' + l.h).join(' | ').slice(0, 2000)}`);
  require('fs').writeFileSync(process.argv[2], out.join('\n'), 'utf8');
  await ctx.close();
})().catch((e) => { require('fs').writeFileSync(process.argv[2], `ОШИБКА: ${e.stack}\n${out.join('\n')}`, 'utf8'); process.exit(1); });
