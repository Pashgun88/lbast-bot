// Лечилку - в подсумок (Паша, 07.10.2026). В инвентаре её нет (на поясе числилась с запасом 0),
// поэтому сначала покупка. На 8 уровне доступен «Большой эликсир лечения (HP+80)» за 16 дин:
// Великие (HP+120 и выше) требуют 9-11 уровень. Берём ОДНУ штуку.
const { chromium } = require('playwright');
const m = require('./module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = [];
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  const open = async (u, w = 900) => { await page.goto(new URL(u, 'http://lbast.ru/').href, { waitUntil: 'domcontentloaded', timeout: 60000 }); await sleep(w); };
  const txt = async (n = 600) => (await m.getBodyText(page)).replace(/\s+/g, ' ').slice(0, n);
  const goText = async (t) => {
    const h = await page.evaluate((x) => {
      const a = Array.from(document.querySelectorAll('a')).find((e) => (e.innerText || '').trim() === x);
      return a ? a.getAttribute('href') : null;
    }, t);
    if (!h) return false;
    await open(h); return true;
  };

  // 1) покупка: shop_id=1029 - Большой эликсир лечения (HP+80)
  await open('shop.php');
  if (!(await goText('Свитки и эликсиры'))) throw new Error('нет раздела');
  const buy = await page.evaluate(() => {
    const a = Array.from(document.querySelectorAll('a')).find((x) => (x.getAttribute('href') || '').includes('shop_id=1029'));
    return a ? a.getAttribute('href') : null;
  });
  if (!buy) throw new Error('нет ссылки покупки shop_id=1029');
  await open(buy);
  const conf = await page.evaluate(() => {
    const f = document.querySelector('form');
    if (!f) return 'формы подтверждения нет';
    const k = f.querySelector('input[name=kol]');
    if (k) k.value = '1';
    const s = f.querySelector('input[type=submit]');
    if (s) { s.click(); return `нажал «${s.value}»`; }
    f.submit(); return 'отправил форму';
  });
  await sleep(1500);
  out.push(`ПОКУПКА (${conf}): ${await txt(260)}`);

  // 2) экипировать
  await open('inv.php');
  const eq = await page.evaluate(() => {
    const as = Array.from(document.querySelectorAll('a'));
    for (let i = 0; i < as.length; i++) {
      if (/Большой эликсир лечения/i.test((as[i].innerText || '').trim())) {
        for (let j = i + 1; j < Math.min(i + 6, as.length); j++) {
          if ((as[j].innerText || '').trim() === 'Экипировать') return as[j].getAttribute('href');
        }
      }
    }
    return null;
  });
  if (!eq) out.push('У лечилки нет ссылки «Экипировать» - смотреть руками.');
  else { await open(eq, 1300); out.push(`ЭКИПИРОВКА: ${await txt(300)}`); }

  await open('inv.php?mod=outfit');
  const t = (await m.getBodyText(page)).replace(/\s+/g, ' ');
  out.push(`\nСЛОТЫ: ${(t.match(/Пояс:.*?Клан-вещь:[^|]{0,60}/) || [t.slice(0, 900)])[0]}`);
  await open('inv.php?mod=starred');
  out.push(`\nПОЯС(Избранное): ${await txt(400)}`);
  require('fs').writeFileSync(process.argv[2], out.join('\n'), 'utf8');
  await ctx.close();
})().catch((e) => { require('fs').writeFileSync(process.argv[2], `ОШИБКА: ${e.stack}\n${out.join('\n')}`, 'utf8'); process.exit(1); });
