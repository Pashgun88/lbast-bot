const { chromium } = require('playwright');
const m = require('./module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  const dumpLinks = async (label, url, re) => {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    await sleep(800);
    const rows = await page.$$eval('a', (as) => as.map((a) => ({ t: (a.textContent || '').trim(), h: a.getAttribute('href') || '' })));
    console.log(`\n=== ССЫЛКИ ${label} ===`);
    rows.filter((r) => re.test(r.h)).forEach((r) => console.log(`  «${r.t}» -> ${r.h}`));
  };
  // текущие значения статов: берём таблицу целиком
  await page.goto('http://lbast.ru/pers.php?mod=stats', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(800);
  const tbl = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll('tr').forEach((tr) => {
      const t = (tr.innerText || '').replace(/\s+/g, ' ').trim();
      if (/Сила|Интуиция|Ловкость|Выносливость|Удача|Интеллект/.test(t) && t.length < 120) out.push(t);
    });
    return out;
  });
  console.log('=== СТАТЫ (строки таблицы) ===');
  tbl.forEach((r) => console.log('  ' + r));
  await dumpLinks('СТАТЫ', 'http://lbast.ru/pers.php?mod=stats', /setOneStat|stat/i);
  await dumpLinks('ТАТУ', 'http://lbast.ru/pers.php?mod=tatu', /tatu|Tatu/i);
  // письма
  await page.goto('http://lbast.ru/mail.php', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  await sleep(800);
  console.log('\n=== ПИСЬМА ===\n' + (await m.getBodyText(page).catch(() => '')).replace(/[ \t]+/g, ' ').slice(0, 2500));
  await ctx.close();
})();
