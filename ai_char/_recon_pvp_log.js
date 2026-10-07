// Только чтение: ищем бой с yasnovidec и состав сторон (кто за нас вступился).
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

  await open('arena.php?mod=battles');
  const t = (await m.getBodyText(page)).replace(/\s+/g, ' ');
  out.push(`===== arena.php?mod=battles =====\n${t.slice(0, 2000)}`);
  const ls = await links();
  out.push(`ССЫЛКИ: ${ls.filter((l) => /log_infa|boj|бой/i.test(l.h + l.t)).map((l) => `${l.t} -> ${l.h}`).join('\n  ').slice(0, 1500)}`);

  // первый лог боя, где есть yasnovidec или AI__
  const cand = ls.filter((l) => /log_infa/.test(l.h)).slice(0, 6);
  for (const c of cand) {
    await open(c.h, 800);
    const b = (await m.getBodyText(page)).replace(/\s+/g, ' ');
    if (/yasnovidec/i.test(b)) {
      out.push(`\n===== ЛОГ БОЯ ${c.h} =====\n${b.slice(0, 3000)}`);
      break;
    }
  }
  require('fs').writeFileSync(process.argv[2], out.join('\n'), 'utf8');
  await ctx.close();
})().catch((e) => { require('fs').writeFileSync(process.argv[2], `ОШИБКА: ${e.stack}`, 'utf8'); process.exit(1); });
