const { chromium } = require('playwright');
const m = require('./module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = [];
const say = (s) => { out.push(s); };
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  const body = async () => (await m.getBodyText(page).catch(() => '')).replace(/[ \t]+/g, ' ');
  // анкета: статы, мф, свободные статы
  await page.goto('http://lbast.ru/pers.php', { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
  await sleep(900);
  say('=== АНКЕТА ===\n' + (await body()).slice(0, 1200));
  // распределение статов
  await page.goto('http://lbast.ru/pers.php?mod=stats', { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
  await sleep(900);
  say('\n=== СТАТЫ ===\n' + (await body()).slice(0, 1500));
  // аренда
  await page.goto('http://lbast.ru/inv.php?mod=lease', { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
  await sleep(900);
  say('\n=== АРЕНДА ===\n' + (await body()).slice(0, 1200));
  // экипировка
  await page.goto('http://lbast.ru/inv.php?mod=equip', { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
  await sleep(900);
  say('\n=== ЭКИПИРОВКА ===\n' + (await body()).slice(0, 1500));
  require('fs').writeFileSync('_state_dump.txt', out.join('\n'), 'utf8');
  console.log('записано в _state_dump.txt, символов: ' + out.join('\n').length);
  await ctx.close();
})();
