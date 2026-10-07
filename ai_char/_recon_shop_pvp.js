// Только чтение: ищем свиток ледяного удара и зелье/эль отравления в Стоунгарде,
// плюс смотрим, как устроен пояс в инвентаре.
const { chromium } = require('playwright');
const m = require('./module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = [];
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  const open = async (u, w = 900) => { await page.goto(new URL(u, 'http://lbast.ru/').href, { waitUntil: 'domcontentloaded', timeout: 60000 }); await sleep(w); };
  const links = () => page.evaluate(() => Array.from(document.querySelectorAll('a'))
    .map((a) => ({ t: (a.innerText || '').trim(), h: a.getAttribute('href') || '' })).filter((x) => x.t && x.h));
  const goText = async (t) => {
    const h = await page.evaluate((txt) => {
      const a = Array.from(document.querySelectorAll('a')).find((x) => (x.innerText || '').trim() === txt);
      return a ? a.getAttribute('href') : null;
    }, t);
    if (!h) return false;
    await open(h);
    return true;
  };
  const dump = async (title) => {
    const t = (await m.getBodyText(page)).replace(/\s+/g, ' ');
    out.push(`\n===== ${title} =====\nURL: ${page.url()}\n${t.slice(0, 2500)}`);
  };

  await open('location.php?mod=fastway&lway=2', 6500);
  await open('location.php');
  await dump('Стоунгард');

  if (await goText('Магазин')) {
    await dump('Магазин: разделы');
    const ls = await links();
    out.push(`РАЗДЕЛЫ: ${ls.map((l) => l.t).join(' | ').slice(0, 800)}`);
    for (const name of ['Лавка боевых ресурсов', 'Магазин', 'Свитки', 'Зелья', 'Эликсиры', 'Алхимия']) {
      const back = page.url();
      if (await goText(name)) { await dump(`Раздел «${name}»`); await open(back); }
    }
  } else out.push('Магазина на локации не нашёл');

  await open('inv.php');
  await dump('Инвентарь, страница 1');
  const ls2 = await links();
  out.push(`ССЫЛКИ ИНВЕНТАРЯ: ${ls2.map((l) => `${l.t}`).join(' | ').slice(0, 800)}`);

  require('fs').writeFileSync(process.argv[2], out.join('\n'), 'utf8');
  await ctx.close();
})().catch((e) => { require('fs').writeFileSync(process.argv[2], `ОШИБКА: ${e.stack}`, 'utf8'); process.exit(1); });
