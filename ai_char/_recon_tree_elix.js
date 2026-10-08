// Только чтение: какие эликсиры есть в инвентаре, что в подсумке, и что даёт Дерево жизни.
const { chromium } = require('playwright');
const m = require('./module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = [];
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  const open = async (u, w = 800) => { await page.goto(new URL(u, 'http://lbast.ru/').href, { waitUntil: 'domcontentloaded', timeout: 60000 }); await sleep(w); };
  await open('inv.php?mod=outfit');
  out.push(`ЭКИПИРОВКА: ${(await m.getBodyText(page)).replace(/\s+/g, ' ').slice(0, 1200)}`);
  for (const u of ['inv.php', 'inv.php?cpage=2', 'inv.php?cpage=3']) {
    await open(u);
    const t = (await m.getBodyText(page)).replace(/\s+/g, ' ');
    const hits = t.match(/(Эликсир|Зелье|Настой)[^»]{0,45}/g);
    out.push(`\n${u}: ${hits ? hits.join(' | ') : 'эликсиров нет'}`);
  }
  await open('inv.php?mod=starred');
  out.push(`\nИЗБРАННОЕ: ${(await m.getBodyText(page)).replace(/\s+/g, ' ').slice(0, 400)}`);
  await open('pers.php?mod=questinfo&qid=42');
  out.push(`\nДЕРЕВО ЖИЗНИ (инфо): ${(await m.getBodyText(page)).replace(/\s+/g, ' ').slice(0, 900)}`);
  require('fs').writeFileSync(process.argv[2], out.join('\n'), 'utf8');
  await ctx.close();
})().catch((e) => { require('fs').writeFileSync(process.argv[2], `ОШИБКА: ${e.stack}`, 'utf8'); process.exit(1); });
