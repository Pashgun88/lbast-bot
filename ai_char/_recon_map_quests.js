// Только чтение: описание «Карта сокровищ» из инвентаря + инфо по всем незакрытым квестам.
const { chromium } = require('playwright');
const m = require('./module');
const fs = require('fs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = [];
const QIDS = [['Заброшенный замок', 5058], ['Магическая башня', 5065], ['Колодец Страха', 5076],
  ['Вспышки прошлого', 5080], ['Унесенные ветром', 5082], ['Неожиданная встреча', 5131],
  ['Огни Девтауна', 5147], ['Жертвоприношение', 5171], ['Остров героев', 5188]];
const INV = ['inv.php', 'inv.php?cpage=2', 'inv.php?invMod=3', 'inv.php?invMod=3&cpage=2', 'inv.php?invMod=3&cpage=3'];
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  const open = async (u, w = 700) => { await page.goto(new URL(u, 'http://lbast.ru/').href, { waitUntil: 'domcontentloaded', timeout: 60000 }); await sleep(w); };
  // 1) карта сокровищ: найти строку и её [i]
  let mapHref = null;
  for (const u of INV) {
    await open(u);
    const found = await page.evaluate(() => {
      let lastName = '';
      for (const a of Array.from(document.querySelectorAll('a'))) {
        const t = (a.textContent || '').trim();
        const h = a.getAttribute('href') || '';
        if (/log_infa_or\.php/.test(h) && /карта/i.test(lastName)) return { name: lastName, href: h };
        if (t && !/^\d+$/.test(t) && !/^(Использовать|Передать|Экипировать|Снять|\[i\])$/.test(t)) lastName = t;
      }
      return null;
    }).catch(() => null);
    if (found) { out.push(`КАРТА найдена на ${u}: ${found.name}`); mapHref = found.href; break; }
  }
  if (mapHref) {
    await open(mapHref, 900);
    out.push(`--- описание карты ---\n${(await m.getBodyText(page)).replace(/\n{2,}/g, '\n').slice(0, 1200)}`);
  } else {
    out.push('КАРТА: строки с «карта» в инвентаре не нашёл.');
  }
  // 2) инфо по квестам
  for (const [name, qid] of QIDS) {
    await open(`pers.php?mod=questinfo&qid=${qid}`, 600);
    const t = (await m.getBodyText(page)).replace(/\s+/g, ' ');
    const i = t.indexOf('Группа бойцов');
    out.push(`\n### ${name} (qid=${qid})\n${t.slice(i > 0 ? i + 14 : 0).slice(0, 900)}`);
  }
  fs.writeFileSync('_recon_map_quests.out.txt', out.join('\n'), 'utf8');
  await ctx.close();
})();
