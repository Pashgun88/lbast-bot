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
  const step = async (label) => {
    const hit = (await links()).find((l) => l.t === label || new RegExp(label, 'i').test(l.t));
    if (!hit) { out.push(`шага «${label}» нет`); return false; }
    await open(hit.h, 1100); return true;
  };
  await open('location.php');
  out.push(`сейчас: ${await txt(160)}`);
  if (await step('Идти на запад')) {
    out.push(`\nУЩЕЛЬЕ: ${await txt(500)}`);
    if (await step('Каменоломня')) {
      out.push(`\n===== КАМЕНОЛОМНЯ =====\n${await txt(1600)}`);
      out.push(`ССЫЛКИ: ${(await links()).map((l) => `${l.t} -> ${l.h}`).join('\n  ').slice(0, 1200)}`);
    }
  }
  require('fs').writeFileSync(process.argv[2], out.join('\n'), 'utf8');
  await ctx.close();
})().catch((e) => { require('fs').writeFileSync(process.argv[2], `ОШИБКА: ${e.stack}\n${out.join('\n')}`, 'utf8'); process.exit(1); });
