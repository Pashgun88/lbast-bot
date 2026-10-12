// Статы под «Кольцо мастера Ордо» по ответу игры. Требования разбираем БЕЗ регулярок: текст вида
// «Сила: 26/16 Интуиция: 20/32» делится на слова, и пара «есть/надо» лежит сразу за названием.
// 12.10.2026: две попытки до этого собирали регулярку из строки (new RegExp(name + ':\s*...')),
// и обратные слеши не доживали до файла - шаблон превращался в «s*(d+)» и не совпадал ни с чем.
// Тот же класс ошибки, что в варке браги. Регулярка-литерал работает, собранная из строки - нет.
const { chromium } = require('playwright');
const m = require('./module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const RING_INVID = '71264454';
const ST = { 'Сила': 1, 'Интуиция': 2, 'Ловкость': 3, 'Выносливость': 4, 'Удача': 5, 'Интеллект': 6 };
function gapsFrom(flat) {
  const w = flat.split(' ');
  const out = [];
  for (let i = 0; i < w.length - 1; i++) {
    const name = w[i].replace(':', '');
    if (!(name in ST)) continue;
    const pair = w[i + 1].split('/');
    if (pair.length !== 2) continue;
    const have = Number(pair[0]);
    const need = Number(pair[1]);
    if (Number.isFinite(have) && Number.isFinite(need) && have < need) {
      out.push({ name, st: ST[name], add: need - have, have, need });
    }
  }
  return out;
}
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  const txt = async () => (await m.getBodyText(page)).replace(/\s+/g, ' ');
  const brief = async (label) => {
    await page.goto('http://lbast.ru/pers.php', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(700);
    const t = await txt();
    const g = (re) => (t.match(re) || [])[1] || '?';
    console.log(`${label}: Крит ${g(/Крит:\s*(\d+)/)} | Уворот ${g(/Уворот:\s*(\d+)/)} | Броня ${g(/Броня:\s*(\d+)/)} | Урон ${g(/Урон:\s*([\d-]+)/)}`);
  };
  const freeStats = async () => {
    await page.goto('http://lbast.ru/pers.php?mod=stats', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(600);
    return Number(((await txt()).match(/Доступно статов:\s*(\d+)/) || [])[1] || 0);
  };
  await brief('ДО');
  for (let attempt = 1; attempt <= 3; attempt++) {
    await page.goto(`http://lbast.ru/inv.php?mod=put_on&inv_id=${RING_INVID}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(900);
    const t = await txt();
    if (!/статов нехватает/i.test(t)) { console.log(`надевание: ${t.slice(0, 180)}`); break; }
    const gaps = gapsFrom(t);
    if (!gaps.length) { console.log('отказ без видимой нехватки, экран: ' + t.slice(0, 300)); break; }
    const free = await freeStats();
    const total = gaps.reduce((a, b) => a + b.add, 0);
    console.log(`нехватка: ${gaps.map((g) => `${g.name} ${g.have}->${g.need} (+${g.add})`).join(', ')}; свободных ${free}`);
    if (total > free) { console.log('СТОП: свободных статов меньше нехватки - не вкладываю.'); break; }
    for (const g of gaps) {
      for (let i = 0; i < g.add; i++) {
        await page.goto(`http://lbast.ru/pers.php?mod=stats&go=setOneStat&st=${g.st}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await sleep(300);
      }
      console.log(`вложил +${g.add} в ${g.name}`);
    }
  }
  await page.goto('http://lbast.ru/inv.php?mod=outfit', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(700);
  console.log('слот кольца:', ((await txt()).match(/Кольцо:[^»]{0,55}/) || ['?'])[0]);
  await brief('ПОСЛЕ');
  console.log('осталось свободных статов:', await freeStats());
  await ctx.close();
})();
