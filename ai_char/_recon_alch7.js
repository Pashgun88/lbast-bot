// Только чтение: кварталы Эвилгарда и объекты в них; плюс юг от предместий.
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
  const SKIP = /^(Амулет|Aмулет|Конь|Чат|Форум|ЖГ|Карта|Кланы|Бои|Выход|Галерея|Размер текста|Кто здесь\?|AI__|Q\d+|D\d+)/i;
  const home = async () => { await open('location.php?mod=konj&lway=2', 2200); await open('location.php', 900); };
  const step = async (name) => { const ls = await links(); const h = ls.find((l) => l.t === name); if (!h) return false; await open(h.h, 900); return true; };
  const report = async (path) => {
    const t = await txt(); const ls = await links();
    const inner = ls.filter((l) => !SKIP.test(l.t) && /location\.php|loc\.php|goroda\.php/.test(l.h));
    out.push(`\n--- ${path} ---\n${t.split('D3').pop().slice(0, 260)}\nССЫЛКИ: ${inner.map((l) => l.t + ' [' + l.h.replace(/r=\d+&?/, '') + ']').join(' | ')}`);
    return inner.map((l) => l.t);
  };
  // юг от предместий
  await home(); if (await step('Идти на юг')) await report('юг');
  // город
  await home(); await step('Идти на восток - в город');
  const q = await report('Эвилгард город');
  for (const name of q) {
    if (/Выйти из города|Академия/.test(name)) continue;
    await home(); if (!(await step('Идти на восток - в город'))) continue;
    if (!(await step(name))) continue;
    await report(`город > ${name}`);
  }
  require('fs').writeFileSync(process.argv[2], out.join('\n'), 'utf8');
  await ctx.close();
})().catch((e) => { require('fs').writeFileSync(process.argv[2], `ОШИБКА: ${e.stack}\n${out.join('\n')}`, 'utf8'); process.exit(1); });
