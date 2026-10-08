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
  await open('location.php');
  const konj = (await links()).find((l) => /konj/.test(l.h));
  await open(konj.h);
  const dar = (await links()).find((l) => /Горы Дарии/i.test(l.t));
  out.push(`еду: ${dar.t}`);
  await open(dar.h, 9000);
  await open('location.php');
  out.push(`ГОРЫ ДАРИИ: ${(await m.getBodyText(page)).replace(/\s+/g, ' ').slice(0, 700)}`);
  out.push(`ХОДЫ: ${(await links()).filter((l) => /Идти|Ущель|Камено|Спуст|Осмотр/i.test(l.t)).map((l) => l.t).join(' | ')}`);
  require('fs').writeFileSync(process.argv[2], out.join('\n'), 'utf8');
  await ctx.close();
})().catch((e) => { require('fs').writeFileSync(process.argv[2], `ОШИБКА: ${e.stack}\n${out.join('\n')}`, 'utf8'); process.exit(1); });
