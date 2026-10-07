// Пробуем два пути: свиток «Экипировать» (у него есть такая ссылка - похоже, это и есть пояс),
// яд - в «Избранное» по инвентарному id. Ничего чужого не удаляем.
const { chromium } = require('playwright');
const m = require('./module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = [];
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  const open = async (u, w = 900) => { await page.goto(new URL(u, 'http://lbast.ru/').href, { waitUntil: 'domcontentloaded', timeout: 60000 }); await sleep(w); };
  const txt = async (n = 500) => (await m.getBodyText(page)).replace(/\s+/g, ' ').slice(0, n);

  // свежие invid (они могли смениться)
  await open('inv.php');
  const ids = await page.evaluate(() => {
    const res = {};
    for (const a of Array.from(document.querySelectorAll('a'))) {
      const t = (a.innerText || '').trim();
      const h = a.getAttribute('href') || '';
      const mm = h.match(/invid=(\d+)/);
      if (mm && /Свиток ледяного удара/i.test(t)) res.scroll = mm[1];
      if (mm && /Зелье отравления/i.test(t)) res.poison = mm[1];
    }
    return res;
  });
  out.push(`invid: свиток=${ids.scroll} яд=${ids.poison}`);

  // 1) яд в «Избранное» по инвентарному id
  if (ids.poison) {
    await open('inv.php?mod=starred&edit=1');
    const r = await page.evaluate((v) => {
      const f = document.querySelector('form');
      const i = f && f.querySelector('input[name=itemID]');
      if (!i) return 'поля itemID нет';
      i.value = String(v);
      const s = f.querySelector('input[type=submit]');
      s.click(); return 'отправил';
    }, ids.poison);
    await sleep(1400);
    out.push(`ЯД в пояс (${r}): ${await txt(300)}`);
  }
  // 2) свиток туда же
  if (ids.scroll) {
    await open('inv.php?mod=starred&edit=1');
    const r = await page.evaluate((v) => {
      const f = document.querySelector('form');
      const i = f && f.querySelector('input[name=itemID]');
      if (!i) return 'поля itemID нет';
      i.value = String(v);
      const s = f.querySelector('input[type=submit]');
      s.click(); return 'отправил';
    }, ids.scroll);
    await sleep(1400);
    out.push(`СВИТОК в пояс (${r}): ${await txt(300)}`);
  }
  await open('inv.php?mod=starred');
  out.push(`\n===== ПОЯС =====\n${await txt(700)}`);
  require('fs').writeFileSync(process.argv[2], out.join('\n'), 'utf8');
  await ctx.close();
})().catch((e) => { require('fs').writeFileSync(process.argv[2], `ОШИБКА: ${e.stack}\n${out.join('\n')}`, 'utf8'); process.exit(1); });
