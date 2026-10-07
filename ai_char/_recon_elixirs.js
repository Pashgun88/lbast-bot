// Только чтение: какие эликсиры есть в инвентаре и у каких есть «Экипировать».
const { chromium } = require('playwright');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = [];
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  const open = async (u, w = 700) => { await page.goto(new URL(u, 'http://lbast.ru/').href, { waitUntil: 'domcontentloaded', timeout: 60000 }); await sleep(w); };
  for (const u of ['inv.php', 'inv.php?cpage=2', 'inv.php?cpage=3']) {
    await open(u);
    const rows = await page.evaluate(() => {
      const as = Array.from(document.querySelectorAll('a'));
      const res = [];
      for (let i = 0; i < as.length; i++) {
        const t = (as[i].innerText || '').trim();
        if (!/эликсир|зелье|настой|лечени/i.test(t)) continue;
        const h = as[i].getAttribute('href') || '';
        if (!/invid=/.test(h)) continue;
        const near = [];
        for (let j = i + 1; j < Math.min(i + 6, as.length); j++) {
          const tt = (as[j].innerText || '').trim();
          if (/invid=/.test(as[j].getAttribute('href') || '')) break;
          if (tt) near.push(`${tt} -> ${as[j].getAttribute('href')}`);
        }
        res.push(`${t} | ${h}\n     ${near.join('\n     ')}`);
      }
      return res;
    });
    if (rows.length) out.push(`\n===== ${u} =====\n  ${rows.join('\n  ')}`);
  }
  await open('inv.php?mod=outfit');
  const t = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
  out.push(`\nПОДСУМОК: ${(t.match(/Подсумок:[^]{0,80}/) || ['?'])[0]}`);
  require('fs').writeFileSync(process.argv[2], out.join('\n'), 'utf8');
  await ctx.close();
})().catch((e) => { require('fs').writeFileSync(process.argv[2], `ОШИБКА: ${e.stack}`, 'utf8'); process.exit(1); });
