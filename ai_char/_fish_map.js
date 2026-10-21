// Карта «сколько жать -> какая рыба». Прогон по списку N на оставшиеся попытки дня.
const { chromium } = require('playwright');
const { getBodyText } = require('./module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PLAN = (process.argv[2] || '5,7,9,11').split(',').map(Number);
// Пауза между нажатиями: проверяем догадку Паши про частоту нажатий. При 150 мс игра дважды
// ответила «Ошибка записи данных» - значит частота ей не всё равно.
const GAP = Number(process.argv[3] || 150);
const read = async (page) => {
  const t = (await getBodyText(page).catch(()=>'')).replace(/[ \t]+/g,' ');
  const n = (t.match(/(\d+)\.\s*Шанс поклевки:\s*([^\n]+)/) || []);
  const links = await page.$$eval('a', (as) => as.map((a) => `${(a.innerText||'').trim()}=>${a.getAttribute('href')}`));
  return { t, step: n[1] ? Number(n[1]) : null, chance: (n[2]||'').trim(), links };
};
const go = async (page, link) => {
  await page.goto(new URL(link.split('=>')[1], page.url()).href, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(GAP);
};
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  const rows = [];
  for (const N of PLAN) {
    await page.goto('http://lbast.ru/loc.php?obj=5229&go=1', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(200);
    const head = (await getBodyText(page).catch(()=>'')).replace(/[ \t]+/g,' ');
    const used = (head.match(/Рыбалка:\s*(\d+)\s*из\s*(\d+)/) || []);
    if (used[1] && used[2] && Number(used[1]) >= Number(used[2])) { console.log('попытки на сегодня кончились'); break; }
    await page.goto('http://lbast.ru/loc.php?obj=5229&go=2', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(150);
    let s = await read(page);
    let chanceAt = {};
    let escaped = false;
    for (let i = 1; i <= N; i++) {
      const bite = s.links.find((l) => /^Поклевка=>/i.test(l));
      if (!bite) { escaped = true; break; }
      await go(page, bite);
      s = await read(page);
      if (s.step === null) { escaped = true; break; }
      chanceAt[s.step] = s.chance;
    }
    let result = (s.t.split('ЖУРМА')[1] || '').replace(/\s+/g, ' ').trim();
    if (!escaped) {
      const pull = s.links.find((l) => /^Подсекать=>/i.test(l));
      if (pull) { await go(page, pull); s = await read(page); result = (s.t.split('ЖУРМА')[1] || '').replace(/\s+/g, ' ').trim(); }
    }
    const kg = (result.match(/Улов:\s*([\d.]+)\s*кг/) || [])[1];
    const fish = (result.match(/вытягиваете\s+([а-яё]+)/i) || result.match(/вытащили на берег[^.]*?([а-яё]+)\./i) || [])[1];
    rows.push({ N, escaped, fish: fish || '?', kg: kg ? Number(kg) : null, chance: chanceAt[N] || chanceAt[Object.keys(chanceAt).pop()] || '?' });
    console.log(`N=${N}: ${escaped ? 'СОШЛА' : 'вытащил'} ${fish || '?'} ${kg || '?'} кг (шанс на последнем шаге «${chanceAt[N] || '?'}») | ${result.slice(0, 120)}`);
  }
  await page.goto('http://lbast.ru/loc.php?obj=5229&go=1', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(300);
  const t = (await getBodyText(page).catch(()=>'')).replace(/[ \t]+/g,' ');
  console.log('\nИТОГ ДНЯ: ' + (t.match(/Рыбалка:\s*\d+\s*из\s*\d+/)||[''])[0] + ' | ' + (t.match(/Общий улов:\s*[\d.]+\s*кг/)||[''])[0]);
  console.log('таблица: ' + JSON.stringify(rows));
  await ctx.close();
})();
