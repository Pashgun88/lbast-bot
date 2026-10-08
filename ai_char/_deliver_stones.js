// Камни надо отнести «в город». Проверяем Кулак Хаоса (дом) и Стоунгард: ищем куда сдать.
const { chromium } = require('playwright');
const m = require('./module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = [];
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  const open = async (u, w = 1000) => { await page.goto(new URL(u, 'http://lbast.ru/').href, { waitUntil: 'domcontentloaded', timeout: 60000 }); await sleep(w); };
  const links = () => page.evaluate(() => Array.from(document.querySelectorAll('a'))
    .map((a) => ({ t: (a.innerText || '').trim(), h: a.getAttribute('href') || '' })).filter((x) => x.t && x.h));
  const txt = async (n = 800) => (await m.getBodyText(page)).replace(/\s+/g, ' ').slice(0, n);

  await open('inv.php');
  const stones = (await m.getBodyText(page)).match(/[^ ]{0,12}[Кк]амн[^ ]{0,12}/g);
  out.push(`в инвентаре про камни: ${stones ? stones.join(' | ') : 'ничего'}`);

  for (const [lway, city] of [['4', 'Кулак Хаоса'], ['2', 'Стоунгард']]) {
    await open(`location.php?mod=fastway&lway=${lway}`, 6000);
    await open('location.php');
    const t = await txt(700);
    const ls = await links();
    const hint = /работа еще не выполнена/.test(t) ? 'работа ВСЁ ЕЩЁ не выполнена' : 'отметки о работе НЕТ';
    out.push(`\n===== ${city} =====\n${hint}\n${t}`);
    out.push(`ССЫЛКИ: ${ls.map((l) => l.t).join(' | ').slice(0, 700)}`);
    const cand = ls.find((l) => /камн|сдать|строй|работ|магистрат|склад/i.test(l.t));
    if (cand) out.push(`*** КАНДИДАТ: ${cand.t} -> ${cand.h}`);
  }
  require('fs').writeFileSync(process.argv[2], out.join('\n'), 'utf8');
  await ctx.close();
})().catch((e) => { require('fs').writeFileSync(process.argv[2], `ОШИБКА: ${e.stack}\n${out.join('\n')}`, 'utf8'); process.exit(1); });
