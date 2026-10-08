const { chromium } = require('playwright');
const m = require('./module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = [];
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  const open = async (u, w = 900) => { await page.goto(new URL(u, 'http://lbast.ru/').href, { waitUntil: 'domcontentloaded', timeout: 60000 }); await sleep(w); };
  await open('map.php');
  const ls = await page.evaluate(() => Array.from(document.querySelectorAll('a'))
    .map((a) => ({ t: (a.innerText || '').trim(), h: a.getAttribute('href') || '' })));
  out.push(`СЛОИ: ${ls.map((l) => `${l.t} -> ${l.h}`).join('\n  ')}`);
  for (const name of ['Топонимы', 'Объекты', 'Всё']) {
    const hit = ls.find((l) => l.t === name);
    if (!hit) continue;
    await open(hit.h, 1500);
    const t = (await m.getBodyText(page)).replace(/\s+/g, ' ');
    const found = t.match(/[^ ]{0,15}(Ущель|Камено)[^ ]{0,15}/g);
    out.push(`\n«${name}»: ${found ? found.join(' | ') : 'нет'} || ${t.slice(0, 600)}`);
    if (found) break;
  }
  require('fs').writeFileSync(process.argv[2], out.join('\n'), 'utf8');
  await ctx.close();
})().catch((e) => { require('fs').writeFileSync(process.argv[2], `ОШИБКА: ${e.stack}\n${out.join('\n')}`, 'utf8'); process.exit(1); });
