// Только чтение: структура покупки в клановом магазине и в «Свитках и эликсирах».
const { chromium } = require('playwright');
const m = require('./module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = [];
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  const open = async (u, w = 800) => { await page.goto(new URL(u, 'http://lbast.ru/').href, { waitUntil: 'domcontentloaded', timeout: 60000 }); await sleep(w); };
  const goText = async (t) => {
    const h = await page.evaluate((txt) => {
      const a = Array.from(document.querySelectorAll('a')).find((x) => (x.innerText || '').trim() === txt);
      return a ? a.getAttribute('href') : null;
    }, t);
    if (!h) return false;
    await open(h);
    return true;
  };
  const anchors = () => page.evaluate(() => Array.from(document.querySelectorAll('a'))
    .map((a, i) => `${i}: "${(a.innerText || '').trim()}" -> ${a.getAttribute('href') || ''}`));
  const forms = () => page.evaluate(() => Array.from(document.querySelectorAll('form')).map((f) => ({
    action: f.getAttribute('action') || '', method: f.getAttribute('method') || '',
    fields: Array.from(f.querySelectorAll('input,select,option,button')).map((e) => `${e.tagName}:${e.getAttribute('name') || ''}=${e.getAttribute('value') || e.textContent || ''}`).slice(0, 25),
  })));

  await open('shop.php');
  await goText('Клановый магазин');
  out.push(`===== КЛАНОВЫЙ МАГАЗИН =====\nURL: ${page.url()}\nТЕКСТ: ${(await m.getBodyText(page)).replace(/\s+/g, ' ').slice(0, 1200)}`);
  out.push(`ССЫЛКИ:\n  ${(await anchors()).join('\n  ').slice(0, 2000)}`);
  out.push(`ФОРМЫ: ${JSON.stringify(await forms(), null, 1).slice(0, 1500)}`);

  await open('shop.php');
  await goText('Свитки и эликсиры');
  out.push(`\n===== СВИТКИ И ЭЛИКСИРЫ =====\nURL: ${page.url()}`);
  out.push(`ССЫЛКИ (первые 30):\n  ${(await anchors()).slice(0, 30).join('\n  ').slice(0, 2000)}`);
  require('fs').writeFileSync(process.argv[2], out.join('\n'), 'utf8');
  await ctx.close();
})().catch((e) => { require('fs').writeFileSync(process.argv[2], `ОШИБКА: ${e.stack}`, 'utf8'); process.exit(1); });
