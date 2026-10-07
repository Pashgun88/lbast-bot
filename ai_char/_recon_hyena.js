// Только чтение: почему маршрут на гиен ломается на шаге «Юг».
// Гипотеза: телепорт из амулета ставит персонажа ВНУТРЬ таверны «У старого тролля», а шаг
// «Юг» ждёт улицу. Смотрим, что на каждом экране, и ищем выход наружу.
const { chromium } = require('playwright');
const m = require('./module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = [];
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  const links = () => page.evaluate(() => Array.from(document.querySelectorAll('a'))
    .map((a) => ({ t: (a.innerText || '').trim(), h: a.getAttribute('href') || '' }))
    .filter((x) => x.t && x.h));
  const dump = async (title) => {
    const t = (await m.getBodyText(page)).replace(/\s+/g, ' ').slice(0, 700);
    const ls = await links();
    out.push(`\n===== ${title} =====\nURL: ${page.url()}\nТЕКСТ: ${t}\nССЫЛКИ: ${ls.map((l) => `${l.t} -> ${l.h}`).join('\n  ')}`);
    return ls;
  };
  const open = async (u, w = 900) => { await page.goto(new URL(u, 'http://lbast.ru/').href, { waitUntil: 'domcontentloaded', timeout: 60000 }); await sleep(w); };

  await open('location.php');
  let ls = await dump('локация, где стоим');

  // Амулет: по href, не по тексту (в тексте бывает латинская A).
  const am = ls.find((l) => /амулет/i.test(l.t) || /\bA?мулет/i.test(l.t));
  if (!am) { out.push('АМУЛЕТ: ссылки не нашёл'); }
  else {
    await open(am.h);
    ls = await dump('список амулета');
    const tav = ls.find((l) => /тролл/i.test(l.t)) || ls.find((l) => /таверн/i.test(l.t));
    if (!tav) out.push('ТАВЕРНА: в списке амулета нет ни «тролл», ни «таверн»');
    else {
      out.push(`\nТЕЛЕПОРТ ВЫБРАН: ${tav.t} -> ${tav.h}`);
      await open(tav.h, 1500);
      ls = await dump('после телепорта');
      // что похоже на выход наружу
      const outs = ls.filter((l) => /(выйти|наружу|на улицу|уйти|покинуть|юг|север|запад|восток|в игру)/i.test(l.t));
      out.push(`\nПОХОЖЕ НА ВЫХОД: ${outs.map((l) => `${l.t} -> ${l.h}`).join(' | ') || 'ничего'}`);
    }
  }
  require('fs').writeFileSync(process.argv[2], out.join('\n'), 'utf8');
  await ctx.close();
})().catch((e) => { require('fs').writeFileSync(process.argv[2], `ОШИБКА: ${e.stack}`, 'utf8'); process.exit(1); });
