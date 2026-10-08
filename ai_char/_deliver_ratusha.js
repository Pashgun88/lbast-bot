// Сдача камней: Стоунгард -> Северные ворота -> север -> Магистратура -> Ратуша (подсказка Tsunami).
// Идём ПО ЭКРАНУ: на каждом шаге жмём первую подходящую ссылку из списка ожидаемых.
const { chromium } = require('playwright');
const m = require('./module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = [];
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  const open = async (u, w = 1000) => { await page.goto(new URL(u, 'http://lbast.ru/').href, { waitUntil: 'domcontentloaded', timeout: 60000 }); await sleep(w); };
  const links = () => page.evaluate(() => Array.from(document.querySelectorAll('a'))
    .map((a) => ({ t: (a.innerText || '').trim(), h: a.getAttribute('href') || '' })).filter((x) => x.t && x.h));
  const txt = async (n = 700) => (await m.getBodyText(page)).replace(/\s+/g, ' ').slice(0, n);
  const step = async (re, label) => {
    const hit = (await links()).find((l) => re.test(l.t));
    if (!hit) { out.push(`  нет шага «${label}»; на экране: ${(await links()).map((l) => l.t).join(' | ').slice(0, 400)}`); return false; }
    await open(hit.h, 1100);
    out.push(`→ ${hit.t}: ${await txt(360)}`);
    return true;
  };
  await open('location.php?mod=fastway&lway=2', 6500);
  await open('location.php');
  out.push(`СТОУНГАРД: ${await txt(260)}`);
  if (!(await step(/Северные ворота/, 'Северные ворота'))) throw new Error('нет северных ворот');
  for (let i = 1; i <= 3; i++) {
    const ls = await links();
    if (ls.some((l) => /Магистратура/i.test(l.t))) break;
    if (!(await step(/^Идти на север/i, `север ${i}`))) break;
  }
  if (await step(/Магистратура/, 'Магистратура')) {
    if (await step(/Ратуша/, 'Ратуша')) {
      out.push(`\n===== РАТУША =====\n${await txt(1400)}`);
      out.push(`ССЫЛКИ: ${(await links()).map((l) => `${l.t} -> ${l.h}`).join('\n  ').slice(0, 1200)}`);
    }
  }
  require('fs').writeFileSync(process.argv[2], out.join('\n'), 'utf8');
  await ctx.close();
})().catch((e) => { require('fs').writeFileSync(process.argv[2], `ОШИБКА: ${e.stack}\n${out.join('\n')}`, 'utf8'); process.exit(1); });
