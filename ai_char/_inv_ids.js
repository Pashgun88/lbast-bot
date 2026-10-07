// Только чтение: ищем в инвентаре строки свитка и яда и ВСЕ их ссылки (оттуда возьмём id).
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
      const res = [];
      let cur = null;
      for (const a of Array.from(document.querySelectorAll('a'))) {
        const t = (a.innerText || '').trim();
        const h = a.getAttribute('href') || '';
        if (/Свиток ледяного удара|Зелье отравления|Эликсир лечения/i.test(t)) { cur = { name: t, links: [`${t} -> ${h}`] }; res.push(cur); }
        else if (cur && res[res.length - 1] === cur && cur.links.length < 6 && t) cur.links.push(`${t} -> ${h}`);
      }
      return res;
    });
    if (rows.length) out.push(`\n===== ${u} =====\n${rows.map((r) => r.links.join('\n  ')).join('\n---\n')}`);
  }
  require('fs').writeFileSync(process.argv[2], out.join('\n'), 'utf8');
  await ctx.close();
})().catch((e) => { require('fs').writeFileSync(process.argv[2], `ОШИБКА: ${e.stack}`, 'utf8'); process.exit(1); });
