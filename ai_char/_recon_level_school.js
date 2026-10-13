const { chromium } = require('playwright');
const m = require('./module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  const body = async () => (await m.getBodyText(page).catch(() => '')).replace(/[ \t]+/g, ' ');
  // где вообще виден наш уровень
  for (const u of ['log_infa.php?mod=who&blogin=AI__', 'pers.php']) {
    await page.goto('http://lbast.ru/' + u, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
    await sleep(900);
    const t = await body();
    const lv = t.match(/AI__\s*\[(\d+)\]/) || t.match(/Уровень[^\d]{0,12}(\d+)/i);
    console.log(`[${u}] уровень найден: ${lv ? lv[1] : 'НЕТ'} | есть слово «Уровень»: ${/Уровень/i.test(t)}`);
    if (u.startsWith('log_infa')) console.log('   фрагмент: ' + t.replace(/\s+/g, ' ').slice(0, 300));
  }
  // школа
  await page.goto('http://lbast.ru/loc.php?obj=5198', { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
  await sleep(900);
  console.log('\n=== ШКОЛА СЕЙЧАС ===\n' + (await body()).slice(0, 900));
  await ctx.close();
})();
