const { chromium } = require('playwright');
const m = require('./module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = [];
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  const open = async (u, w = 900) => { await page.goto(new URL(u, 'http://lbast.ru/').href, { waitUntil: 'domcontentloaded', timeout: 60000 }); await sleep(w); };
  const txt = async () => (await m.getBodyText(page).catch(() => '')).replace(/\s+/g, ' ');
  for (const qid of [5146]) { await open('pers.php?mod=questinfo&qid=' + qid, 1000); out.push(`ИНФО ${qid}: ${(await txt()).slice(0, 1500)}`); }
  await open('pers.php', 900);
  const t = await txt();
  out.push(`\nСЛОТ: ${(t.match(/Текущее задание:[^»]{0,90}/) || ['-'])[0]} | ${(t.match(/Деньги:\s*\d+/) || ['-'])[0]}`);
  require('fs').writeFileSync(process.argv[2], out.join('\n'), 'utf8');
  await ctx.close();
})().catch((e) => { require('fs').writeFileSync(process.argv[2], 'ОШИБКА: ' + e.message, 'utf8'); process.exit(1); });
