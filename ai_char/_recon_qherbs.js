const { chromium } = require('playwright');
const m = require('./module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  await page.goto('http://lbast.ru/location.php?mod=quests', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(1000);
  const t = (await m.getBodyText(page)).replace(/\s+/g, ' ');
  console.log('--- Q-МЕНЮ ---\n' + t.slice(0, 1200));
  // инвентарь: какие травы уже лежат
  let inv = '';
  for (const u of ['inv.php', 'inv.php?cpage=2', 'inv.php?cpage=3', 'inv.php?cpage=4']) {
    await page.goto('http://lbast.ru/' + u, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    await sleep(500);
    inv += '\n' + await m.getBodyText(page).catch(() => '');
  }
  const words = ['арайя', 'пустолист', 'травии', 'пререя', 'кактус', 'хмель', 'молодиц', 'змеевик', 'вишн', 'краст', 'варан', 'горгул', 'василиск'];
  console.log('\n--- ЧТО В СУМКЕ ---');
  for (const w of words) {
    const hit = (inv.match(new RegExp('[^\n]*' + w + '[^\n]*', 'gi')) || []).map((s) => s.trim());
    console.log(`${w}: ${hit.length ? hit.slice(0, 2).join(' | ') : '-'}`);
  }
  await ctx.close();
})();
