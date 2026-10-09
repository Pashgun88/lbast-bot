// Только чтение: как черепа выглядят на странице передачи и что отвечает форма.
const { chromium } = require('playwright');
const m = require('./module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = [];
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  const open = async (u, w = 900) => { await page.goto(new URL(u, 'http://lbast.ru/').href, { waitUntil: 'domcontentloaded', timeout: 60000 }); await sleep(w); };
  for (const u of ['inv.php?lgn=Bogi_vojny', 'inv.php?lgn=Bogi_vojny&cpage=2', 'inv.php?lgn=Bogi_vojny&cpage=3']) {
    await open(u);
    const rows = await page.evaluate(() => {
      const as = Array.from(document.querySelectorAll('a'));
      const res = [];
      for (let i = 0; i < as.length; i++) {
        if (!/^Череп$/i.test((as[i].textContent || '').trim())) continue;
        const near = [];
        for (let k = i + 1; k < Math.min(i + 5, as.length); k++) near.push(`${(as[k].textContent || '').trim()}->${as[k].getAttribute('href')}`);
        res.push(`Череп [${as[i].getAttribute('href')}]  ${near.join(' ; ')}`);
      }
      return res;
    });
    out.push(`\n===== ${u} =====\nстрок «Череп»: ${rows.length}\n  ${rows.join('\n  ')}`);
    const t = (await m.getBodyText(page)).replace(/\s+/g, ' ');
    const hits = t.match(/Череп[^|]{0,30}/g);
    out.push(`  текстом: ${hits ? hits.join(' | ') : 'нет'}`);
  }
  // посмотреть саму форму передачи у первой строки
  await open('inv.php?lgn=Bogi_vojny');
  const pered = await page.evaluate(() => {
    const as = Array.from(document.querySelectorAll('a'));
    for (let i = 0; i < as.length; i++) {
      if (!/^Череп$/i.test((as[i].textContent || '').trim())) continue;
      for (let k = i + 1; k < Math.min(i + 5, as.length); k++) if ((as[k].textContent || '').trim() === 'Передать') return as[k].getAttribute('href');
    }
    return null;
  });
  if (pered) {
    await open(pered, 1000);
    out.push(`\n===== ФОРМА ПЕРЕДАЧИ =====\n${(await m.getBodyText(page)).replace(/\s+/g, ' ').slice(0, 800)}`);
    out.push(JSON.stringify(await page.evaluate(() => Array.from(document.querySelectorAll('form')).map((f) => ({
      action: f.getAttribute('action'), fields: Array.from(f.querySelectorAll('input,select')).map((e) => `${e.tagName}[${e.getAttribute('type')}] ${e.getAttribute('name')}=${e.getAttribute('value')}`),
    })))));
  } else out.push('\nстрок «Череп» нет вовсе - видимо, всё уже отправлено');
  require('fs').writeFileSync(process.argv[2], out.join('\n'), 'utf8');
  await ctx.close();
})().catch((e) => { require('fs').writeFileSync(process.argv[2], `ОШИБКА: ${e.stack}\n${out.join('\n')}`, 'utf8'); process.exit(1); });
