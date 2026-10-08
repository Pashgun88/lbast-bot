// Только чтение: ищем «Ущелье призраков» и «Каменоломня» на карте мира.
const { chromium } = require('playwright');
const m = require('./module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = [];
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  const open = async (u, w = 900) => { await page.goto(new URL(u, 'http://lbast.ru/').href, { waitUntil: 'domcontentloaded', timeout: 60000 }); await sleep(w); };
  for (const u of ['map.php', 'map.php?mv=0', 'map.php?mv=1', 'map.php?mv=2']) {
    await open(u);
    const t = (await m.getBodyText(page)).replace(/\s+/g, ' ');
    const hit = t.match(/[^ ]{0,20}(Ущель|Камено)[^ ]{0,20}/g);
    out.push(`${u}: ${hit ? hit.join(' | ') : 'не найдено'} || ${t.slice(0, 400)}`);
    if (hit) {
      const ls = await page.evaluate(() => Array.from(document.querySelectorAll('a'))
        .map((a) => `${(a.innerText || '').trim()} -> ${a.getAttribute('href')}`).filter((s) => /Ущель|Камено/i.test(s)));
      out.push(`  ССЫЛКИ: ${ls.join(' | ')}`);
      break;
    }
  }
  require('fs').writeFileSync(process.argv[2], out.join('\n'), 'utf8');
  await ctx.close();
})().catch((e) => { require('fs').writeFileSync(process.argv[2], `ОШИБКА: ${e.stack}\n${out.join('\n')}`, 'utf8'); process.exit(1); });
