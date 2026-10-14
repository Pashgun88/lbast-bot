// Только чтение: где продают удочку и что говорит Старый рыбак.
const { chromium } = require('playwright');
const m = require('./module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = [];
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  const open = async (u, w = 900) => { await page.goto(new URL(u, 'http://lbast.ru/').href, { waitUntil: 'domcontentloaded', timeout: 60000 }); await sleep(w); };
  const txt = async () => (await m.getBodyText(page).catch(() => '')).replace(/\s+/g, ' ');
  const links = () => page.evaluate(() => Array.from(document.querySelectorAll('a')).map((a) => ({ t: (a.innerText || '').trim(), h: a.getAttribute('href') || '' })).filter((x) => x.t && x.h));
  // поиск по карте: где магазин с удочкой
  const search = async (w) => {
    await page.goto('http://lbast.ru/map.php?mv=0&go=search#searchbar', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await sleep(500);
    const inp = await page.$('input[name="look"]');
    if (!inp) return;
    await inp.fill(w); await inp.press('Enter'); await sleep(1300);
    const t = (await m.getBodyText(page).catch(() => '')).replace(/[ \t]+/g, ' ');
    const body = (t.split('Замки NPC Все').pop() || '').split('1. Введите')[0].replace(/\s+/g, ' ').trim();
    out.push(`[КАРТА ${w}] ${body.slice(0, 800) || '-'}`);
  };
  for (const w of ['удочк', 'рыбол', 'рыбак']) await search(w);
  // магазин Стоунгарда: страницы покупки
  await open('shop.php', 1000);
  out.push(`\nМАГАЗИН: ${(await txt()).slice(0, 600)}`);
  out.push(`ССЫЛКИ: ${(await links()).map((l) => l.t + ' -> ' + l.h.replace(/r=\d+&?/, '')).join(' | ').slice(0, 1200)}`);
  require('fs').writeFileSync(process.argv[2], out.join('\n'), 'utf8');
  await ctx.close();
})().catch((e) => { require('fs').writeFileSync(process.argv[2], `ОШИБКА: ${e.stack}\n${out.join('\n')}`, 'utf8'); process.exit(1); });
