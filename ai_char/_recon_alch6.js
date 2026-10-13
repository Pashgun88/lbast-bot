// Только чтение: обход окрестностей Эвилгарда (глубина 2) в поисках Гильдии травников.
const { chromium } = require('playwright');
const m = require('./module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = [];
const DIR = /^(Идти |Пойти |Вернуться на)/i;
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  const open = async (u, w = 900) => { await page.goto(new URL(u, 'http://lbast.ru/').href, { waitUntil: 'domcontentloaded', timeout: 60000 }); await sleep(w); };
  const txt = async () => (await m.getBodyText(page).catch(() => '')).replace(/\s+/g, ' ');
  const links = () => page.evaluate(() => Array.from(document.querySelectorAll('a')).map((a) => ({ t: (a.innerText || '').trim(), h: a.getAttribute('href') || '' })).filter((x) => x.t && x.h));
  const home = async () => { await open('location.php?mod=konj&lway=2', 2200); await open('location.php', 900); };
  const report = async (path) => {
    const t = await txt();
    const ls = await links();
    const place = t.split('D3').pop().slice(0, 220);
    const objs = ls.filter((l) => /loc\.php\?.*obj=/.test(l.h)).map((l) => `${l.t} [${l.h.replace(/r=\d+&?/, '')}]`);
    const dirs = ls.filter((l) => DIR.test(l.t)).map((l) => l.t);
    out.push(`\n--- ${path} ---\n${place}\nОБЪЕКТЫ: ${objs.join(' | ') || '-'}\nНАПРАВЛЕНИЯ: ${dirs.join(' | ') || '-'}`);
    return dirs;
  };
  const step = async (name) => {
    const ls = await links();
    const hit = ls.find((l) => l.t === name);
    if (!hit) return false;
    await open(hit.h, 900);
    return true;
  };
  await home();
  const d0 = await report('Эвилгард');
  for (const d1 of d0) {
    await home();
    if (!(await step(d1))) continue;
    const d2 = await report(`> ${d1}`);
    for (const d2n of d2) {
      if (/Вернуться/i.test(d2n)) continue;
      await home();
      if (!(await step(d1))) continue;
      if (!(await step(d2n))) continue;
      await report(`> ${d1} > ${d2n}`);
    }
  }
  require('fs').writeFileSync(process.argv[2], out.join('\n'), 'utf8');
  await ctx.close();
})().catch((e) => { require('fs').writeFileSync(process.argv[2], `ОШИБКА: ${e.stack}\n${out.join('\n')}`, 'utf8'); process.exit(1); });
