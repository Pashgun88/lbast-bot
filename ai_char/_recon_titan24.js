const { chromium } = require('playwright');
const m = require('./module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SKIP = /Чат|Форум|ЖГ|Карта|Кланы|^Бои$|Амулет|Aмулет|Конь|Выход|Размер|Кто здесь|Галерея|статы|AI__|^Q\d|^D\d|Обновить/;
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  const nav = async () => (await page.$$eval('a', (as) => as.map((a) => ({ t: (a.textContent || '').trim().replace(/\s+/g, ' '), h: a.getAttribute('href') || '' })))).filter((a) => a.t);
  const dump = async (label) => {
    const t = (await m.getBodyText(page).catch(() => '')).replace(/\s+/g, ' ');
    const l = (await nav()).filter((a) => !SKIP.test(a.t));
    const name = (t.match(/Q\d+ D\d+ (.{0,40})/) || [, ''])[1];
    console.log('\n--- ' + label + ' | ' + name + ' ---\n' + t.slice(0, 450) + '\n>> ' + l.map((a) => a.t).join(' | '));
    return l;
  };
  const click = async (re, label) => {
    const a = (await nav()).find((x) => re.test(x.t));
    if (!a) { console.log('НЕТ ' + label); return false; }
    await page.goto(new URL(a.h, 'http://lbast.ru/').href, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await sleep(1100); return true;
  };
  const toGorge = async () => {
    await page.goto('http://lbast.ru/location.php?mod=konj&lway=5', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(1500);
    for (let i = 0; i < 10; i++) { const t = await m.getBodyText(page).catch(() => ''); if (!/В пути/.test(t)) break; await page.click('a:has-text("В пути")').catch(() => {}); await sleep(7000); }
    await click(/^Идти на запад$/, 'запад'); await click(/^Идти на юг$/, 'юг'); await click(/^Идти на запад$/, 'запад');
  };
  await toGorge();
  for (const dir of [/^Идти на запад$/, /^Идти на юг$/]) {
    await toGorge();
    await click(dir, dir.source);
    const l = await dump('ущелье ' + dir.source);
    for (const a of l.filter((x) => !/^Идти/.test(x.t))) console.log('   ОБЪЕКТ: ' + a.t + ' -> ' + a.h);
    // ещё шаг вглубь по каждому направлению
    for (const a of l.filter((x) => /^Идти/.test(x.t))) {
      await page.goto(new URL(a.h, 'http://lbast.ru/').href, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
      await sleep(1000);
      const l2 = await dump('  ' + dir.source + ' -> ' + a.t);
      for (const b of l2.filter((x) => !/^Идти/.test(x.t))) console.log('      ОБЪЕКТ: ' + b.t + ' -> ' + b.h);
      await page.goBack().catch(() => {}); await sleep(900);
    }
  }
  await ctx.close();
})();
