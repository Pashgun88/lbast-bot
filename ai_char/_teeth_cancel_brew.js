// Паша поправил: «ты сначала сам свари все что можешь а остаток ханку кинь по 250 каждый».
// Предложение Ханку ещё не принято - отменяем, варим, остаток отправляем заново.
const { chromium } = require('playwright');
const { getBodyText } = require('./module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  // 1) отмена предложения с зубами
  await page.goto('http://lbast.ru/inv.php?mod=offers', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(700);
  const href = await page.evaluate(() => {
    const all = Array.from(document.querySelectorAll('a'));
    for (let i = 0; i < all.length; i++) {
      if (!/^Зуб Горгульи$/i.test((all[i].textContent || '').trim())) continue;
      for (let k = i + 1; k < Math.min(i + 8, all.length); k++) {
        if (/^Отказаться$/i.test((all[k].textContent || '').trim())) return all[k].getAttribute('href');
      }
    }
    return null;
  });
  if (!href) { console.log('предложения с зубами в «Передачах» нет - возможно, Ханк уже принял.'); }
  else {
    await page.goto(new URL(href, 'http://lbast.ru/').href, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(700);
    const t = (await getBodyText(page).catch(()=>'')).replace(/\s+/g,' ');
    console.log('отмена: ' + (/Предложение отменено/i.test(t) ? 'ок' : t.slice(0, 150)));
  }
  // 2) варим всё, что можно
  const { S } = require('./lib/state');
  S.herbGuildAt = 0;
  const { runHerbGuildIfDue } = require('./lib/herb_guild');
  console.log('варка: ' + await runHerbGuildIfDue(page));
  // 3) что осталось
  for (const u of ['inv.php','inv.php?cpage=2','inv.php?cpage=3']) {
    await page.goto('http://lbast.ru/' + u, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(()=>{});
    await sleep(400);
    const t = (await getBodyText(page).catch(()=>'')).replace(/[ \t]+/g,' ');
    const hits = t.split('\n').filter((l) => /зуб горгул|лист змеевик|эликсир каменного голема/i.test(l));
    if (hits.length) console.log(`[${u}] ` + hits.join(' ; '));
  }
  await ctx.close();
})();
