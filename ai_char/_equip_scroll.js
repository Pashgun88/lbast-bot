// Свиток надо ЭКИПИРОВАТЬ в слот пояса (Паша: «как леку»), а не просто положить в «Избранное».
// Сначала смотрим страницу экипировки, потом жмём «Экипировать» у свитка и проверяем результат.
const { chromium } = require('playwright');
const m = require('./module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = [];
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  const open = async (u, w = 900) => { await page.goto(new URL(u, 'http://lbast.ru/').href, { waitUntil: 'domcontentloaded', timeout: 60000 }); await sleep(w); };
  const txt = async (n = 1600) => (await m.getBodyText(page)).replace(/\s+/g, ' ').slice(0, n);

  await open('inv.php?mod=outfit');
  out.push(`===== ЭКИПИРОВКА (до) =====\n${await txt(2000)}`);

  await open('inv.php');
  const found = await page.evaluate(() => {
    const as = Array.from(document.querySelectorAll('a'));
    const res = { scroll: null, equip: null, poisonEquip: null };
    for (let i = 0; i < as.length; i++) {
      const t = (as[i].innerText || '').trim();
      const h = as[i].getAttribute('href') || '';
      if (/Свиток ледяного удара/i.test(t)) {
        res.scroll = h;
        for (let j = i + 1; j < Math.min(i + 5, as.length); j++) {
          if ((as[j].innerText || '').trim() === 'Экипировать') { res.equip = as[j].getAttribute('href'); break; }
        }
      }
      if (/Зелье отравления/i.test(t)) {
        for (let j = i + 1; j < Math.min(i + 5, as.length); j++) {
          if ((as[j].innerText || '').trim() === 'Экипировать') { res.poisonEquip = as[j].getAttribute('href'); break; }
        }
      }
    }
    return res;
  });
  out.push(`\nССЫЛКИ: свиток=${found.scroll}\n  Экипировать(свиток)=${found.equip}\n  Экипировать(яд)=${found.poisonEquip || 'нет такой ссылки у яда'}`);

  if (found.equip) {
    await open(found.equip, 1300);
    out.push(`\nОТВЕТ НА «Экипировать»: ${await txt(400)}`);
  }
  if (found.poisonEquip) {
    await open(found.poisonEquip, 1300);
    out.push(`\nОТВЕТ НА «Экипировать» (яд): ${await txt(400)}`);
  }

  await open('inv.php?mod=outfit');
  out.push(`\n===== ЭКИПИРОВКА (после) =====\n${await txt(2000)}`);
  require('fs').writeFileSync(process.argv[2], out.join('\n'), 'utf8');
  await ctx.close();
})().catch((e) => { require('fs').writeFileSync(process.argv[2], `ОШИБКА: ${e.stack}\n${out.join('\n')}`, 'utf8'); process.exit(1); });
