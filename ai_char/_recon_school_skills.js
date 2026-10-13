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
  const click = async (re, label) => {
    const a = (await nav()).find((x) => re.test(x.t));
    if (!a) { out.push('НЕТ «' + label + '»'); return false; }
    await page.goto(new URL(a.h, 'http://lbast.ru/').href, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(1100); return true;
  };
  // доходим до школы маршрутом (по номеру объекта нельзя - он привязан к месту)
  await page.goto('http://lbast.ru/location.php?mod=konj&lway=5', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(1500);
  for (let i = 0; i < 10; i++) { const t = await body(); if (!/В пути/.test(t)) break; await page.goto(page.url(), { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {}); await sleep(4000); }
  await page.goto('http://lbast.ru/location.php', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await sleep(800);
  await click(/^Идти на запад$/, 'запад'); await click(/^Идти на юг$/, 'юг');
  await click(/^Идти на запад$/, 'запад'); await click(/^Идти на юг$/, 'юг'); await click(/^Идти на юг$/, 'юг');
  if (!(await click(/^В школу$/, 'В школу'))) { console.log(out.join('\n')); return ctx.close(); }
  out.push('=== ШКОЛА ===\n' + (await body()).slice(0, 700));
  const base = page.url().replace(/&go=.*$/, '');
  for (const [go, name] of [[1, 'АТАКА'], [2, 'ЗАЩИТА']]) {
    await page.goto(base + '&go=' + go, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
    await sleep(900);
    const t = await body();
    const lines = t.split('\n').filter((l) => /•/.test(l)).map((l) => l.trim());
    const links = (await nav()).filter((a) => /next=/.test(a.h)).map((a) => a.t.replace(/\s+/g, ' ').slice(0, 60) + ' -> ' + a.h.replace(/.*next=/, 'next='));
    out.push(`\n=== ${name}: строк ${lines.length}, ссылок-покупок ${links.length} ===`);
    out.push(lines.slice(0, 12).join('\n'));
    out.push('ССЫЛКИ: ' + links.slice(0, 12).join(' | '));
  }
  require('fs').writeFileSync('_school_dump.txt', out.join('\n'), 'utf8');
  console.log('записано, символов ' + out.join('\n').length);
  await ctx.close();
})();
