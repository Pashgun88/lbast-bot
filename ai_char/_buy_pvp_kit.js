// ПОКУПКА по прямому указанию Паши 07.10.2026: «1 свиток и 3 яда купи».
//   Свиток ледяного удара - 25 дин, магазин -> «Свитки и эликсиры» (shop_id=1026).
//   Зелье отравления - 35 дин, магазин -> «Клановый магазин» (next=1038), по 1 шт. за клик.
// Берём ровно столько, сколько сказано, и после каждой покупки читаем ответ игры.
const { chromium } = require('playwright');
const m = require('./module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = [];
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  const open = async (u, w = 900) => { await page.goto(new URL(u, 'http://lbast.ru/').href, { waitUntil: 'domcontentloaded', timeout: 60000 }); await sleep(w); };
  const goText = async (t) => {
    const h = await page.evaluate((txt) => {
      const a = Array.from(document.querySelectorAll('a')).find((x) => (x.innerText || '').trim() === txt);
      return a ? a.getAttribute('href') : null;
    }, t);
    if (!h) return false;
    await open(h);
    return true;
  };
  const money = async () => {
    const t = (await m.getBodyText(page)).replace(/\s+/g, ' ');
    const mm = t.match(/(\d[\d\s]*)\s*дин/i);
    return mm ? mm[1].replace(/\s/g, '') : '?';
  };

  // 1) свиток
  await open('shop.php');
  if (!(await goText('Свитки и эликсиры'))) throw new Error('нет раздела «Свитки и эликсиры»');
  out.push(`денег до покупок: ${await money()}`);
  const buyHref = await page.evaluate(() => {
    const as = Array.from(document.querySelectorAll('a'));
    const a = as.find((x) => (x.getAttribute('href') || '').includes('shop_id=1026'));
    return a ? a.getAttribute('href') : null;
  });
  if (!buyHref) throw new Error('ссылки покупки свитка (shop_id=1026) нет');
  await open(buyHref);
  out.push(`СВИТОК: ответ игры: ${(await m.getBodyText(page)).replace(/\s+/g, ' ').slice(0, 300)}`);

  // 2) три зелья отравления, по одному за заход
  for (let i = 1; i <= 3; i++) {
    await open('shop.php');
    if (!(await goText('Клановый магазин'))) throw new Error('нет кланового магазина');
    const h = await page.evaluate(() => {
      const a = Array.from(document.querySelectorAll('a')).find((x) => (x.innerText || '').trim() === 'Зелье отравления');
      return a ? a.getAttribute('href') : null;
    });
    if (!h) throw new Error('строки «Зелье отравления» нет');
    await open(h);
    out.push(`ЯД ${i}/3: ${(await m.getBodyText(page)).replace(/\s+/g, ' ').slice(0, 300)}`);
  }

  // 3) что в итоге в инвентаре
  for (const u of ['inv.php', 'inv.php?cpage=2', 'inv.php?cpage=3']) {
    await open(u);
    const t = (await m.getBodyText(page)).replace(/\s+/g, ' ');
    const hits = t.match(/(Свиток ледяного удара[^А-Я]{0,30}|Зелье отравления[^А-Я]{0,30})/g);
    if (hits) out.push(`ИНВЕНТАРЬ (${u}): ${hits.join(' | ')}`);
  }
  await open('inv.php');
  out.push(`денег после: ${await money()}`);

  // 4) как устроено «Управление» поясом
  await open('inv.php?mod=starred&edit=1');
  out.push(`\n===== ПОЯС: Управление =====\n${(await m.getBodyText(page)).replace(/\s+/g, ' ').slice(0, 1500)}`);
  const ls = await page.evaluate(() => Array.from(document.querySelectorAll('a'))
    .map((a, i) => `${i}: "${(a.innerText || '').trim()}" -> ${a.getAttribute('href') || ''}`));
  out.push(`ССЫЛКИ:\n  ${ls.join('\n  ').slice(0, 1800)}`);

  require('fs').writeFileSync(process.argv[2], out.join('\n'), 'utf8');
  await ctx.close();
})().catch((e) => { require('fs').writeFileSync(process.argv[2], `ОШИБКА: ${e.stack}\n${out.join('\n')}`, 'utf8'); process.exit(1); });
