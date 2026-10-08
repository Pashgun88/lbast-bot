// Только чтение: обход гор Дарии на 2 шага, ищем «Ущелье призраков» / «Каменоломня».
const { chromium } = require('playwright');
const m = require('./module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = [];
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  const open = async (u, w = 700) => { await page.goto(new URL(u, 'http://lbast.ru/').href, { waitUntil: 'domcontentloaded', timeout: 60000 }); await sleep(w); };
  const links = () => page.evaluate(() => Array.from(document.querySelectorAll('a'))
    .map((a) => ({ t: (a.innerText || '').trim(), h: a.getAttribute('href') || '' })).filter((x) => x.t && x.h));
  const name = async () => {
    const t = (await m.getBodyText(page)).replace(/\s+/g, ' ');
    const mm = t.match(/\(\d+\)\s+Q?\d*\s*D?\d*\s*(.{0,40}?)\s+(?:Вокруг|Вы |Здесь|Это |Дорожный|Указатель|Идти)/);
    return (mm ? mm[1] : t.slice(40, 90)).trim();
  };
  const DIRS = ['Идти на запад', 'Идти на север', 'Идти на восток', 'Идти на юг'];
  const home = 'http://lbast.ru/location.php';
  const path = [];
  const seen = new Set();
  async function goHome() { await open('location.php?mod=fastway&lway=9', 5000); } // не нужен, заглушка

  await open('location.php');
  const start = await name();
  out.push(`старт: ${start}`);
  for (const d1 of DIRS) {
    await open('location.php');
    let ls = await links();
    let hit = ls.find((l) => l.t === d1);
    if (!hit) continue;
    await open(hit.h, 900);
    const n1 = await name();
    const l1 = await links();
    const q1 = l1.find((l) => /Ущель|Камено/i.test(l.t));
    out.push(`\n${d1} -> ${n1}${q1 ? `  *** ${q1.t} ***` : ''}`);
    out.push(`   ходы: ${l1.filter((l) => /Идти|Ущель|Камено|Осмотр/i.test(l.t)).map((l) => l.t).join(' | ')}`);
    if (q1) break;
    for (const d2 of DIRS) {
      const h2 = (await links()).find((l) => l.t === d2);
      if (!h2) continue;
      const back = page.url();
      await open(h2.h, 900);
      const n2 = await name();
      const l2 = await links();
      const q2 = l2.find((l) => /Ущель|Камено/i.test(l.t));
      out.push(`   ${d1} + ${d2} -> ${n2}${q2 ? `  *** ${q2.t} ***` : ''}`);
      if (q2) { out.push(`   НАШЁЛ: ${q2.t} -> ${q2.h}`); }
      await open(back, 600);
    }
  }
  require('fs').writeFileSync(process.argv[2], out.join('\n'), 'utf8');
  await ctx.close();
})().catch((e) => { require('fs').writeFileSync(process.argv[2], `ОШИБКА: ${e.stack}\n${out.join('\n')}`, 'utf8'); process.exit(1); });
