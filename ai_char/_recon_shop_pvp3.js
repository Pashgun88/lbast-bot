// Только чтение: остаток раздела через кнопку «Далее» + поиск отравления по лавкам.
const { chromium } = require('playwright');
const m = require('./module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = [];
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  const open = async (u, w = 800) => { await page.goto(new URL(u, 'http://lbast.ru/').href, { waitUntil: 'domcontentloaded', timeout: 60000 }); await sleep(w); };
  const goText = async (t) => {
    const h = await page.evaluate((txt) => {
      const a = Array.from(document.querySelectorAll('a')).find((x) => (x.innerText || '').trim() === txt);
      return a ? a.getAttribute('href') : null;
    }, t);
    if (!h) return false;
    await open(h);
    return true;
  };
  await open('shop.php');
  await goText('Свитки и эликсиры');
  for (let i = 1; i <= 4; i++) {
    const before = page.url();
    if (!(await goText('Далее'))) { out.push(`«Далее» #${i}: ссылки нет`); break; }
    const t = (await m.getBodyText(page)).replace(/\s+/g, ' ');
    out.push(`\n===== после «Далее» #${i} =====\nURL: ${page.url()}\n${t.slice(0, 2200)}`);
    if (page.url() === before) break;
  }
  // лавка подарков и клановый магазин - вдруг отравление там
  for (const name of ['Лавка подарков', 'Клановый магазин']) {
    await open('shop.php');
    if (await goText(name)) {
      const t = (await m.getBodyText(page)).replace(/\s+/g, ' ');
      out.push(`\n===== ${name} =====\n${t.slice(0, 1800)}`);
    }
  }
  require('fs').writeFileSync(process.argv[2], out.join('\n'), 'utf8');
  await ctx.close();
})().catch((e) => { require('fs').writeFileSync(process.argv[2], `ОШИБКА: ${e.stack}`, 'utf8'); process.exit(1); });
