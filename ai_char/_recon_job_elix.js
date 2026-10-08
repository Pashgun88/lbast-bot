// Только чтение: 1) профессия/работа гражданина в анкете, 2) что за эликсир дало дерево.
const { chromium } = require('playwright');
const m = require('./module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = [];
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  const open = async (u, w = 800) => { await page.goto(new URL(u, 'http://lbast.ru/').href, { waitUntil: 'domcontentloaded', timeout: 60000 }); await sleep(w); };
  const txt = async (n = 2000) => (await m.getBodyText(page)).replace(/\s+/g, ' ').slice(0, n);
  const links = () => page.evaluate(() => Array.from(document.querySelectorAll('a'))
    .map((a) => `${(a.innerText || '').trim()} -> ${a.getAttribute('href') || ''}`));

  await open('pers.php');
  out.push(`===== АНКЕТА =====\n${await txt(2500)}`);
  out.push(`ССЫЛКИ АНКЕТЫ: ${(await links()).join(' | ').slice(0, 1200)}`);

  // эликсир с дерева
  await open('inv.php?cpage=2');
  const el = await page.evaluate(() => {
    const as = Array.from(document.querySelectorAll('a'));
    for (let i = 0; i < as.length; i++) {
      const t = (as[i].innerText || '').trim();
      if (/Эликсир регенерации/i.test(t)) {
        const near = [];
        for (let j = i + 1; j < Math.min(i + 5, as.length); j++) near.push(`${(as[j].innerText || '').trim()} -> ${as[j].getAttribute('href')}`);
        return { href: as[i].getAttribute('href'), near };
      }
    }
    return null;
  });
  out.push(`\n===== ЭЛИКСИР РЕГЕНЕРАЦИИ =====\n${el ? `${el.href}\n  ${el.near.join('\n  ')}` : 'в инвентаре не нашёл'}`);
  if (el) { await open(el.href, 900); out.push(`ОПИСАНИЕ: ${await txt(900)}`); }
  require('fs').writeFileSync(process.argv[2], out.join('\n'), 'utf8');
  await ctx.close();
})().catch((e) => { require('fs').writeFileSync(process.argv[2], `ОШИБКА: ${e.stack}`, 'utf8'); process.exit(1); });
