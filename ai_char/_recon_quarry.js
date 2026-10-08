// Только чтение: ищем «Ущелье призраков» в списке коня/амулета и доходим до Каменоломни
// по подсказке Tsunami: Ущелье призраков -> запад -> восток -> юг -> Каменоломня.
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

  await open('location.php');
  out.push(`ГДЕ СТОИМ: ${await txt(300)}`);
  // список коня
  const l0 = await links();
  const konj = l0.find((l) => /konj/.test(l.h));
  if (!konj) { out.push('ссылки «Конь» нет'); }
  else {
    await open(konj.h);
    const ls = await links();
    out.push(`\nКОНЬ: ${ls.map((l) => l.t).join(' | ').slice(0, 900)}`);
    const u = ls.find((l) => /ущель/i.test(l.t));
    if (!u) out.push('«Ущелье призраков» в списке коня не нашёл');
    else {
      out.push(`\nЕДУ: ${u.t} -> ${u.h}`);
      await open(u.h, 8000);
      await open('location.php');
      out.push(`\nПРИЕХАЛ: ${await txt(600)}`);
      // идём по подсказке
      for (const step of ['Идти на запад', 'Идти на восток', 'Идти на юг']) {
        const ls2 = await links();
        const hit = ls2.find((l) => l.t === step);
        if (!hit) { out.push(`\nшага «${step}» на экране нет; есть: ${ls2.filter((x)=>/Идти|Камено/i.test(x.t)).map((x)=>x.t).join(' | ')}`); break; }
        await open(hit.h, 1200);
        out.push(`\nпосле «${step}»: ${await txt(420)}`);
      }
      const ls3 = await links();
      const q = ls3.find((l) => /камено/i.test(l.t));
      out.push(`\nКАМЕНОЛОМНЯ: ${q ? `${q.t} -> ${q.h}` : 'ссылки нет'}`);
      if (q) { await open(q.h, 1200); out.push(`\nВ КАМЕНОЛОМНЕ: ${await txt(900)}`);
        out.push(`ССЫЛКИ: ${(await links()).map((l) => l.t).join(' | ').slice(0, 600)}`); }
    }
  }
  require('fs').writeFileSync(process.argv[2], out.join('\n'), 'utf8');
  await ctx.close();
})().catch((e) => { require('fs').writeFileSync(process.argv[2], `ОШИБКА: ${e.stack}\n${out.join('\n')}`, 'utf8'); process.exit(1); });
