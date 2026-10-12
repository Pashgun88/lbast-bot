const { chromium } = require('playwright');
const m = require('./module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  const { readCombatStats, equipItemByNamePrefix } = require('./lib/lease');
  // есть ли кольцо мастера Ордо в сумке
  let inv = '';
  for (const u of ['inv.php', 'inv.php?cpage=2', 'inv.php?cpage=3', 'inv.php?cpage=4']) {
    await page.goto('http://lbast.ru/' + u, { waitUntil: 'domcontentloaded', timeout: 40000 }).catch(() => {});
    await sleep(500);
    inv += '\n' + (await m.getBodyText(page).catch(() => ''));
  }
  const rings = (inv.match(/[^\n]*[Кк]ольцо[^\n]*/g) || []).map((s) => s.trim().replace(/\s+/g, ' '));
  console.log('кольца в сумке:\n  ' + (rings.join('\n  ') || 'нет'));
  const before = await readCombatStats(page);
  console.log('\nмф ДО: ' + JSON.stringify(before));
  const ok = await equipItemByNamePrefix(page, 'Кольцо мастера Ордо', 'Кольцо Ордо');
  console.log('надел: ' + ok);
  const after = await readCombatStats(page);
  console.log('мф ПОСЛЕ: ' + JSON.stringify(after));
  await ctx.close();
})();
