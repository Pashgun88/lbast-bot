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
  await open('pers.php?mod=questinfo&qid=2001', 1000);
  out.push(`ИНФО 2001: ${(await txt()).slice(0, 1500)}`);
  // дневник: что писали последние записи
  await open('log_infa.php?mod=dnevnik', 1000).catch(() => {});
  out.push(`\nДНЕВНИК: ${(await txt()).slice(0, 1200)}`);
  // башня Ордо: доехать и посмотреть, что говорит про задание
  await open('location.php?mod=fastway&lway=2', 2000);
  for (let i = 0; i < 6; i++) { await open('location.php', 800); if (/Стоунгард/.test(await txt())) break; await sleep(1200); }
  const step = async (name) => { for (let i = 0; i < 3; i++) { const ls = await links(); const h = ls.find((l) => l.t === name); if (h) { await open(h.h, 800); return true; } await sleep(900); await open('location.php', 600); } return false; };
  for (const s of ['Южные ворота', 'Идти на юг', 'Идти на восток', 'Башня Ордо Экзекуторс']) out.push(`${s}: ${await step(s)}`);
  out.push(`\nБАШНЯ: ${(await txt()).slice(0, 1200)}`);
  out.push(`ССЫЛКИ: ${(await links()).map((l) => l.t + ' -> ' + l.h.replace(/r=\d+&?/, '')).join(' | ').slice(0, 1200)}`);
  require('fs').writeFileSync(process.argv[2], out.join('\n'), 'utf8');
  await ctx.close();
})().catch((e) => { require('fs').writeFileSync(process.argv[2], `ОШИБКА: ${e.stack}\n${out.join('\n')}`, 'utf8'); process.exit(1); });
