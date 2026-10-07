// Только чтение: ищем ЗАВЕРШЁННЫЙ бой с yasnovidec - через лог боя по нику и через События.
const { chromium } = require('playwright');
const m = require('./module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = [];
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  const open = async (u, w = 900) => { await page.goto(new URL(u, 'http://lbast.ru/').href, { waitUntil: 'domcontentloaded', timeout: 60000 }); await sleep(w); };
  const dump = async (title) => {
    const t = (await m.getBodyText(page)).replace(/\s+/g, ' ');
    out.push(`\n===== ${title} =====\n${t.slice(0, 2500)}`);
    const ls = await page.evaluate(() => Array.from(document.querySelectorAll('a'))
      .map((a) => ({ t: (a.innerText || '').trim(), h: a.getAttribute('href') || '' })).filter((x) => x.t && x.h));
    return ls;
  };
  for (const u of ['log_infa.php?mod=bojview&blogin=AI__',
                   'log_infa.php?mod=bojview&blogin=yasnovidec',
                   'pers.php?mod=sobit',
                   'chat.php?room=12&mod=spnapad']) {
    try { await open(u); await dump(u); } catch (e) { out.push(`\n===== ${u} =====\nОШИБКА: ${e.message}`); }
  }
  require('fs').writeFileSync(process.argv[2], out.join('\n'), 'utf8');
  await ctx.close();
})().catch((e) => { require('fs').writeFileSync(process.argv[2], `ОШИБКА: ${e.stack}`, 'utf8'); process.exit(1); });
