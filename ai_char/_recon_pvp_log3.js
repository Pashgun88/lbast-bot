// Только чтение: «Смотреть пред.бой» -> состав сторон в завершённом бою.
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
  await open('log_infa.php?mod=bojview&blogin=AI__');
  for (let step = 1; step <= 4; step++) {
    const ls = await links();
    const prev = ls.find((l) => /пред\.?\s*бой/i.test(l.t));
    if (!prev) { out.push(`шаг ${step}: ссылки «пред.бой» нет`); break; }
    await open(prev.h, 1100);
    const t = (await m.getBodyText(page)).replace(/\s+/g, ' ');
    out.push(`\n===== пред.бой #${step} (${prev.h}) =====\n${t.slice(0, 2500)}`);
    if (/yasnovidec/i.test(t)) { out.push('\n>>> ЭТО ТОТ САМЫЙ БОЙ <<<'); break; }
  }
  require('fs').writeFileSync(process.argv[2], out.join('\n'), 'utf8');
  await ctx.close();
})().catch((e) => { require('fs').writeFileSync(process.argv[2], `ОШИБКА: ${e.stack}`, 'utf8'); process.exit(1); });
