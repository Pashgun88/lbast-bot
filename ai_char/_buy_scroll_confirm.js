// Докупаем свиток: экран покупки просит подтверждение с полем «Количество».
// Плюс смотрим форму пояса («id вещи») - её надо заполнить id предмета, а не названием.
const { chromium } = require('playwright');
const m = require('./module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = [];
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  const open = async (u, w = 900) => { await page.goto(new URL(u, 'http://lbast.ru/').href, { waitUntil: 'domcontentloaded', timeout: 60000 }); await sleep(w); };
  const goText = async (t) => {
    const h = await page.evaluate((txt) => {
      const a = Array.from(document.querySelectorAll('a')).find((x) => (x.innerText || '').trim() === txt);
      return a ? a.getAttribute('href') : null;
    }, t);
    if (!h) return false;
    await open(h);
    return true;
  };
  await open('shop.php');
  await goText('Свитки и эликсиры');
  const buyHref = await page.evaluate(() => {
    const a = Array.from(document.querySelectorAll('a')).find((x) => (x.getAttribute('href') || '').includes('shop_id=1026'));
    return a ? a.getAttribute('href') : null;
  });
  await open(buyHref);
  out.push(`ФОРМА ПОКУПКИ: ${JSON.stringify(await page.evaluate(() => Array.from(document.querySelectorAll('form')).map((f) => ({
    action: f.getAttribute('action') || '', method: f.getAttribute('method') || '',
    fields: Array.from(f.querySelectorAll('input,select,button')).map((e) => `${e.tagName}[type=${e.getAttribute('type') || ''}] name=${e.getAttribute('name') || ''} value=${e.getAttribute('value') || ''}`),
  }))))}`);
  // заполняем количество = 1 и отправляем
  const res = await page.evaluate(() => {
    const num = Array.from(document.querySelectorAll('input')).find((i) => /text|number/i.test(i.getAttribute('type') || 'text') && !/submit/i.test(i.getAttribute('type') || ''));
    if (num) num.value = '1';
    const sub = Array.from(document.querySelectorAll('input[type=submit],button')).find((b) => /купить|да|ок|подтвер/i.test(String(b.value || b.textContent || '')));
    if (sub) { sub.click(); return `нажал «${sub.value || sub.textContent}»`; }
    const f = document.querySelector('form');
    if (f) { f.submit(); return 'отправил форму'; }
    return 'ни кнопки, ни формы';
  });
  await sleep(1500);
  out.push(`ПОДТВЕРЖДЕНИЕ: ${res}\nОТВЕТ: ${(await m.getBodyText(page)).replace(/\s+/g, ' ').slice(0, 400)}`);

  await open('inv.php');
  const t = (await m.getBodyText(page)).replace(/\s+/g, ' ');
  out.push(`ДЕНЬГИ/ИНВЕНТАРЬ: ${(t.match(/У вас (\d+) дин/) || [])[0] || '?'} | ${(t.match(/(Свиток ледяного удара[^А-Я]{0,25}|Зелье отравления[^А-Я]{0,25})/g) || []).join(' | ')}`);
  require('fs').writeFileSync(process.argv[2], out.join('\n'), 'utf8');
  await ctx.close();
})().catch((e) => { require('fs').writeFileSync(process.argv[2], `ОШИБКА: ${e.stack}\n${out.join('\n')}`, 'utf8'); process.exit(1); });
