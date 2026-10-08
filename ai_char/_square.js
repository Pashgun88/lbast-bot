const { chromium } = require('playwright');
const m = require('./module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = [];
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  const open = async (u, w = 900) => { await page.goto(new URL(u, 'http://lbast.ru/').href, { waitUntil: 'domcontentloaded', timeout: 60000 }); await sleep(w); };
  const links = () => page.evaluate(() => Array.from(document.querySelectorAll('a'))
    .map((a) => ({ t: (a.innerText || '').trim(), h: a.getAttribute('href') || '' })).filter((x) => x.t && x.h));
  const txt = async (n = 1200) => (await m.getBodyText(page)).replace(/\s+/g, ' ').slice(0, n);
  await open('location.php');
  const sq = (await links()).find((l) => /Центральная площадь/i.test(l.t));
  if (!sq) { out.push('нет «Центральная площадь»'); }
  else {
    await open(sq.h, 1100);
    out.push(`===== ЦЕНТРАЛЬНАЯ ПЛОЩАДЬ =====\n${await txt(1500)}`);
    out.push(`ССЫЛКИ: ${(await links()).map((l) => `${l.t} -> ${l.h}`).join('\n  ').slice(0, 1400)}`);
  }
  require('fs').writeFileSync(process.argv[2], out.join('\n'), 'utf8');
  await ctx.close();
})().catch((e) => { require('fs').writeFileSync(process.argv[2], `ОШИБКА: ${e.stack}\n${out.join('\n')}`, 'utf8'); process.exit(1); });
