const { chromium } = require('playwright');
const m = require('./module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  let inv = '';
  for (const u of ['inv.php', 'inv.php?cpage=2', 'inv.php?cpage=3', 'inv.php?cpage=4', 'inv.php?cpage=5']) {
    try { await page.goto('http://lbast.ru/' + u, { waitUntil: 'domcontentloaded', timeout: 40000 }); } catch (e) { console.log(u + ': ' + e.message.split('\n')[0]); continue; }
    await sleep(600);
    inv += '\n' + (await m.getBodyText(page).catch(() => ''));
  }
  const words = ['молодиц', 'змеевик', 'вишн', 'краст', 'арайя', 'пустолист', 'травии', 'прере', 'кактус', 'хмел', 'варан', 'горгул', 'василиск', 'брага', 'браги'];
  console.log('=== ТРАВЫ В СУМКЕ ===');
  for (const w of words) {
    const hit = (inv.match(new RegExp('[^\n]*' + w + '[^\n]*', 'gi')) || []).map((s) => s.trim().replace(/\s+/g, ' '));
    console.log(`  ${w}: ${hit.length ? hit.slice(0, 2).join(' | ') : '— нет'}`);
  }
  await ctx.close();
})();
