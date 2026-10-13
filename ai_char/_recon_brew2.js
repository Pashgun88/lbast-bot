// Дойти до гильдии и сварить ОДИН эликсир отравления; записать ответы игры.
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
  const step = async (name) => { for (let i = 0; i < 3; i++) { const ls = await links(); const h = ls.find((l) => l.t === name); if (h) { await open(h.h, 800); return true; } await sleep(900); await open('location.php', 600); } return false; };
  await open('location.php?mod=fastway&lway=9', 1800);
  for (let i = 0; i < 5; i++) { await open('location.php', 700); if (/Дорожный крест/.test(await txt())) break; await sleep(1000); }
  out.push(`крест: ${(await txt()).slice(0, 120)}`);
  out.push(`юг1: ${await step('Идти на юг')}`);
  out.push(`юг2: ${await step('Идти на юг')}`);
  out.push(`здесь: ${(await txt()).slice(0, 180)}`);
  out.push(`в гильдию: ${await step('Гильдия травников')}`);
  await open('loc.php?obj=5134&go=5', 1000);
  out.push(`\nСПИСОК: ${(await txt()).slice(0, 900)}`);
  const ls = await links();
  const hit = ls.find((l) => /el_id=1038/.test(l.h));
  if (!hit) out.push('нет ссылки на отравление');
  else {
    await open(hit.h, 1300);
    out.push(`\nПОСЛЕ КЛИКА: ${(await txt()).slice(0, 1200)}`);
    out.push(`ССЫЛКИ: ${(await links()).map((l) => l.t + ' -> ' + l.h.replace(/r=\d+&?/, '')).join(' | ').slice(0, 1000)}`);
  }
  require('fs').writeFileSync(process.argv[2], out.join('\n'), 'utf8');
  await ctx.close();
})().catch((e) => { require('fs').writeFileSync(process.argv[2], `ОШИБКА: ${e.stack}\n${out.join('\n')}`, 'utf8'); process.exit(1); });
