const { chromium } = require('playwright');
const m = require('./module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  const txt = async () => (await m.getBodyText(page)).replace(/\s+/g, ' ');
  const flags = [['pruka', 'оружие'], ['lruka', 'щиты'], ['head', 'шлемы'], ['korpus', 'броня'], ['nogi', 'сапоги'], ['cloaks', 'плащи'], ['ukr', 'украшения']];
  for (const [f, name] of flags) {
    await page.goto(`http://lbast.ru/shop.php?mod=view&flag=${f}`, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    await sleep(700);
    const t = await txt();
    // ищем позиции 9 уровня и их требования
    const nine = (t.match(/[^»]{0,70}Уровень[^»]{0,8}9[^»]{0,220}/g) || []).slice(0, 3);
    console.log(`\n=== ${name} ===`);
    if (nine.length) nine.forEach((x) => console.log('  ' + x.replace(/\s+/g, ' ').slice(0, 260)));
    else console.log('  ' + t.slice(0, 400));
  }
  await ctx.close();
})();
