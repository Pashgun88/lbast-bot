const { chromium } = require('playwright');
const { getBodyText } = require('./module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  // 1) что в слоте
  await page.goto('http://lbast.ru/pers.php', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(600);
  let t = (await getBodyText(page).catch(()=>'')).replace(/[ \t]+/g,' ');
  console.log('слот до: ' + ((t.match(/Текущее задание:[^\n]*/)||[])[0] || 'пусто'));
  // 2) отказ: владелец по нашим записям - «Неожиданная встреча», игра сказала «через 6 дн.»
  const { dropAssignmentByOrder, forgetSlotOwner } = require('./lib/task_slot');
  const ok = await dropAssignmentByOrder(page, 'Неожиданная встреча: игра говорит «приходите через 6 дн.», слот нужен Штольням и остальным');
  forgetSlotOwner();
  await page.goto('http://lbast.ru/pers.php', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(600);
  t = (await getBodyText(page).catch(()=>'')).replace(/[ \t]+/g,' ');
  console.log(`отказ: ${ok ? 'выполнен' : 'НЕ выполнен'}; слот после: ` + ((t.match(/Текущее задание:[^\n]*/)||[])[0] || 'пусто'));
  // 3) травы и эликсиры в сумке
  const want = /молодиц|змеевик|вишн|краст|арайя|пустолист|травии|прере|хмел|кактус|эликсир исцеления/i;
  for (const u of ['inv.php','inv.php?cpage=2','inv.php?cpage=3','inv.php?cpage=4']) {
    await page.goto('http://lbast.ru/' + u, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(()=>{});
    await sleep(500);
    const txt = (await getBodyText(page).catch(()=>'')).replace(/[ \t]+/g,' ');
    const hits = txt.split('\n').filter((l) => want.test(l));
    if (hits.length) console.log(`[${u}] ` + hits.join(' ; '));
  }
  await ctx.close();
})();
