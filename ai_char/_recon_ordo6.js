// Только чтение: где оборвалась миссия Ордо (главарь банды) и что сейчас в слоте задания.
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

  await open('pers.php');
  const t = await txt();
  out.push(`СЛОТ: ${(t.match(/Текущее задание:[^»]{0,120}/) || ['-'])[0]}`);

  await open('location.php?mod=quests', 1000);
  out.push(`\nQ-МЕНЮ: ${(await txt()).slice(0, 900)}`);
  out.push(`ССЫЛКИ Q: ${(await links()).filter((l) => /qid=|quest/i.test(l.h)).map((l) => l.t + ' -> ' + l.h.replace(/r=\d+&?/, '')).join(' | ').slice(0, 900)}`);

  for (const lway of ['q2001_1', 'q2001_2']) {
    await open('location.php?mod=konj&lway=' + lway, 2200);
    for (let i = 0; i < 6; i++) { await open('location.php', 800); if ((await links()).length > 8) break; await sleep(1200); }
    out.push(`\n===== конь ${lway} =====\n${(await txt()).slice(0, 700)}`);
    out.push(`ССЫЛКИ: ${(await links()).filter((l) => !/^(Амулет|Aмулет|Конь|Чат|Форум|ЖГ|Карта|Кланы|Бои|Выход|Галерея|Размер текста|Кто здесь\?)/.test(l.t)).map((l) => l.t + ' -> ' + l.h.replace(/r=\d+&?/, '')).join(' | ').slice(0, 1200)}`);
  }
  require('fs').writeFileSync(process.argv[2], out.join('\n'), 'utf8');
  await ctx.close();
})().catch((e) => { require('fs').writeFileSync(process.argv[2], `ОШИБКА: ${e.stack}\n${out.join('\n')}`, 'utf8'); process.exit(1); });
