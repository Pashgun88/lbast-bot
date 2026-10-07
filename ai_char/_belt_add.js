// Кладём на пояс («Избранное») свиток и яд: форма «id вещи» принимает id предмета,
// он же oid магазина (свиток 1026, зелье отравления 1038; у эликсира лечения было 1005).
// Чужую строку пояса не трогаем - правило Паши про «не удалять то, чего не создавал».
const { chromium } = require('playwright');
const m = require('./module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = [];
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  const open = async (u, w = 900) => { await page.goto(new URL(u, 'http://lbast.ru/').href, { waitUntil: 'domcontentloaded', timeout: 60000 }); await sleep(w); };
  await open('inv.php?mod=starred&edit=1');
  out.push(`ФОРМЫ ПОЯСА: ${JSON.stringify(await page.evaluate(() => Array.from(document.querySelectorAll('form')).map((f) => ({
    action: f.getAttribute('action') || '', method: f.getAttribute('method') || '',
    fields: Array.from(f.querySelectorAll('input,select,button')).map((e) => `${e.tagName}[type=${e.getAttribute('type') || ''}] name=${e.getAttribute('name') || ''} value=${e.getAttribute('value') || ''}`),
  }))))}`);
  for (const [id, name] of [[1026, 'Свиток ледяного удара'], [1038, 'Зелье отравления']]) {
    await open('inv.php?mod=starred&edit=1');
    const res = await page.evaluate((itemId) => {
      const f = document.querySelector('form');
      if (!f) return 'формы нет';
      const txt = Array.from(f.querySelectorAll('input')).find((i) => (i.getAttribute('type') || 'text') === 'text');
      if (!txt) return 'текстового поля нет';
      txt.value = String(itemId);
      const sub = Array.from(f.querySelectorAll('input[type=submit],button'))[0];
      if (sub) { sub.click(); return `нажал «${sub.value || sub.textContent}»`; }
      f.submit(); return 'отправил форму';
    }, id);
    await sleep(1400);
    out.push(`${name} (id ${id}): ${res} -> ${(await m.getBodyText(page)).replace(/\s+/g, ' ').slice(0, 300)}`);
  }
  await open('inv.php?mod=starred');
  out.push(`\n===== ПОЯС ПОСЛЕ =====\n${(await m.getBodyText(page)).replace(/\s+/g, ' ').slice(0, 600)}`);
  require('fs').writeFileSync(process.argv[2], out.join('\n'), 'utf8');
  await ctx.close();
})().catch((e) => { require('fs').writeFileSync(process.argv[2], `ОШИБКА: ${e.stack}\n${out.join('\n')}`, 'utf8'); process.exit(1); });
