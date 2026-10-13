// Только чтение: обход карты вокруг Эвилгарда до глубины 3, ищем Гильдию травников.
const { chromium } = require('playwright');
const m = require('./module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = [];
const DIR = /^(Идти|Пойти|Войти|Зайти|Выйти|В центральный|Спуститься|Подняться|Перейти|Двигаться)/i;
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  const open = async (u, w = 800) => { await page.goto(new URL(u, 'http://lbast.ru/').href, { waitUntil: 'domcontentloaded', timeout: 60000 }); await sleep(w); };
  const txt = async () => (await m.getBodyText(page).catch(() => '')).replace(/\s+/g, ' ');
  const links = () => page.evaluate(() => Array.from(document.querySelectorAll('a')).map((a) => ({ t: (a.innerText || '').trim(), h: a.getAttribute('href') || '' })).filter((x) => x.t && x.h));
  const place = async () => {
    const t = await txt();
    const after = t.split(/D\d+ /).pop() || t;
    return after.slice(0, 60).trim();
  };
  const home = async () => {
    await open('location.php?mod=konj&lway=2', 2000);
    for (let i = 0; i < 6; i++) {
      await open('location.php', 700);
      const ls = await links();
      if (ls.some((l) => l.t === 'Идти на восток - в город')) return true;
      await sleep(1200);
    }
    return false;
  };
  const step = async (name) => {
    for (let i = 0; i < 3; i++) {
      const ls = await links();
      const h = ls.find((l) => l.t === name);
      if (h) { await open(h.h, 800); return true; }
      await sleep(900); await open('location.php', 600);
    }
    return false;
  };
  const replay = async (path) => { if (!(await home())) return false; for (const s of path) if (!(await step(s))) return false; return true; };

  const seen = new Set();
  const queue = [[]];
  let visits = 0;
  while (queue.length && visits < 150) {
    const path = queue.shift();
    if (!(await replay(path))) { out.push(`!! не дошёл: ${path.join(' > ')}`); continue; }
    visits++;
    const name = await place();
    if (seen.has(name)) continue;
    seen.add(name);
    const ls = await links();
    const objs = ls.filter((l) => /loc\.php\?.*obj=/.test(l.h)).map((l) => `${l.t} [${l.h.replace(/r=\d+&?/, '')}]`);
    const dirs = ls.filter((l) => DIR.test(l.t)).map((l) => l.t);
    out.push(`\n[${path.join(' > ') || 'Предместья'}] ${name}\n  ОБЪЕКТЫ: ${objs.join(' | ') || '-'}\n  ХОДЫ: ${dirs.join(' | ')}`);
    require('fs').writeFileSync(process.argv[2], out.join('\n'), 'utf8');
    if (path.length < 5) for (const d of dirs) if (!/Выйти из города/.test(d)) queue.push(path.concat([d]));
  }
  out.push(`\nвсего посещений: ${visits}, локаций: ${seen.size}`);
  require('fs').writeFileSync(process.argv[2], out.join('\n'), 'utf8');
  await ctx.close();
})().catch((e) => { require('fs').writeFileSync(process.argv[2], `ОШИБКА: ${e.stack}\n${out.join('\n')}`, 'utf8'); process.exit(1); });
