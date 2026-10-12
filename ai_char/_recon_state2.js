const { chromium } = require('playwright');
const m = require('./module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = [];
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  const body = async () => (await m.getBodyText(page).catch(() => '')).replace(/[ \t]+/g, ' ');
  const nav = async () => {
    const xs = await page.$$eval('a', (as) => as.map((a) => ({ t: (a.textContent || '').trim().replace(/\s+/g, ' '), h: a.getAttribute('href') || '' }))).catch(() => []);
    return xs.filter((a) => a.t);
  };
  // вкладка «Вы арендовали вещи»
  await page.goto('http://lbast.ru/inv.php?mod=lease', { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
  await sleep(900);
  const tab = (await nav()).find((a) => /Вы арендовали вещи/.test(a.t));
  if (tab) {
    await page.goto(new URL(tab.h, 'http://lbast.ru/').href, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await sleep(1000);
    const t = await body();
    const i = t.indexOf('Вы арендовали вещи');
    out.push('=== АРЕНДОВАНО ===\n' + t.slice(i >= 0 ? i : 0, (i >= 0 ? i : 0) + 1600));
  }
  // экипировка - список надетого
  await page.goto('http://lbast.ru/inv.php?mod=odet', { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
  await sleep(1000);
  out.push('\n=== НАДЕТО (mod=odet) ===\n' + (await body()).slice(0, 2000));
  require('fs').writeFileSync('_state_dump2.txt', out.join('\n'), 'utf8');
  console.log('ок, символов ' + out.join('\n').length);
  await ctx.close();
})();
