// Только чтение: обход окрестностей Эвилгарда в поисках Гильдии травников.
const { chromium } = require('playwright');
const m = require('./module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = [];
const DIR = /^(Идти на |Идти в |На |Пойти )/i;
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  const open = async (u, w = 900) => { await page.goto(new URL(u, 'http://lbast.ru/').href, { waitUntil: 'domcontentloaded', timeout: 60000 }); await sleep(w); };
  const txt = async () => (await m.getBodyText(page).catch(() => '')).replace(/\s+/g, ' ');
  const links = () => page.evaluate(() => Array.from(document.querySelectorAll('a')).map((a) => ({ t: (a.innerText || '').trim(), h: a.getAttribute('href') || '' })).filter((x) => x.t && x.h));

  const KONJ = 'location.php?mod=konj&lway=2';
  const seen = new Set();
  const report = async (path) => {
    const t = await txt();
    const ls = await links();
    const place = t.slice(0, 260);
    const objs = ls.filter((l) => /loc\.php\?obj=/.test(l.h)).map((l) => `${l.t} [${l.h}]`);
    const dirs = ls.filter((l) => DIR.test(l.t)).map((l) => l.t);
    out.push(`\n--- ${path} ---\n${place}\nОБЪЕКТЫ: ${objs.join(' | ') || '-'}\nНАПРАВЛЕНИЯ: ${dirs.join(' | ') || '-'}`);
    return dirs;
  };
  await open(KONJ, 1200);
  const d0 = await report('Эвилгард');
  for (const d1 of d0) {
    await open(KONJ, 1000);
    let ls = await links();
    let hit = ls.find((l) => l.t === d1);
    if (!hit) continue;
    await open(hit.h, 1000);
    const d2 = await report(`Эвилгард > ${d1}`);
    for (const d2n of d2) {
      await open(KONJ, 900);
      ls = await links(); hit = ls.find((l) => l.t === d1);
      if (!hit) continue;
      await open(hit.h, 900);
      ls = await links(); const h2 = ls.find((l) => l.t === d2n);
      if (!h2) continue;
      await open(h2.h, 900);
      await report(`Эвилгард > ${d1} > ${d2n}`);
    }
  }
  require('fs').writeFileSync(process.argv[2], out.join('\n'), 'utf8');
  await ctx.close();
})().catch((e) => { require('fs').writeFileSync(process.argv[2], `ОШИБКА: ${e.stack}\n${out.join('\n')}`, 'utf8'); process.exit(1); });
