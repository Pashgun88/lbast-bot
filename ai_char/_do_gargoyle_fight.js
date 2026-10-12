const { chromium } = require('playwright');
const m = require('./module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TARGET = 0.85;
const DEADLINE_MIN = 28;
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  const { fightLoop } = require('./lib/fight');
  const hp = async () => {
    await page.goto('http://lbast.ru/pers.php', { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
    await sleep(600);
    const t = (await m.getBodyText(page).catch(() => '')).replace(/[ \t]+/g, ' ');
    const mm = t.match(/AI__ \((-?\d+)\/(\d+)\)/);
    return mm ? { cur: Number(mm[1]), max: Number(mm[2]) } : null;
  };
  const deadline = Date.now() + DEADLINE_MIN * 60000;
  let h = await hp();
  console.log(`HP сейчас: ${h ? h.cur + '/' + h.max : '?'} - жду ${Math.round(TARGET * 100)}% (срок ${DEADLINE_MIN} мин)`);
  while (h && h.cur < h.max * TARGET && Date.now() < deadline) {
    await sleep(120000);
    h = await hp();
    console.log(`  ... HP ${h ? h.cur + '/' + h.max : '?'}`);
  }
  console.log(`Вхожу в бой с HP ${h ? h.cur + '/' + h.max : '?'}`);
  await page.goto('http://lbast.ru/location.php', { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
  await sleep(700);
  const links = await page.$$eval('a', (as) => as.map((a) => ({ t: (a.textContent || '').trim(), h: a.getAttribute('href') || '' }))).catch(() => []);
  const boj = links.find((a) => /boj=/.test(a.h));
  if (!boj) { console.log('висящего боя уже нет - ничего не делаю'); return ctx.close(); }
  await page.goto(new URL(boj.h, 'http://lbast.ru/').href, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await sleep(1000);
  const before = h ? h.cur : null;
  let won = null;
  try { won = await fightLoop(page); } catch (e) { console.log('fightLoop error: ' + e.message); }
  const after = await hp();
  const delta = (before !== null && after) ? before - after.cur : null;
  console.log(`ГОРГУЛЬЯ: результат=${won} HP ${before} -> ${after ? after.cur : '?'} (урон за бой: ${delta}) при запасе ${after ? after.max : '?'}`);
  await ctx.close();
})();
