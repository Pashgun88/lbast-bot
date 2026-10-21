// Один заброс. Протокол каждого экрана и времени. Стратегия задаётся параметром:
//   node _fish_cast.js <сколько секунд ждать перед подсечкой>
const { chromium } = require('playwright');
const { getBodyText } = require('./module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const WAIT_S = Number(process.argv[2] || 0);
const t0 = Date.now();
const ms = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;
const snap = async (page, label) => {
  const t = (await getBodyText(page).catch(()=>'')).replace(/[ \t]+/g,' ').replace(/\n{2,}/g,'\n').trim();
  const links = await page.$$eval('a', (as) => as.map((a) => `${(a.innerText||'').trim()}=>${a.getAttribute('href')}`));
  const useful = links.filter((l)=>!/^(Обновить|Чат|В игру|Выход|Размер текста|Амулет|Конь|Карта|Кланы|ЖГ|Форум|Галерея|Кто здесь\?)=>/.test(l));
  console.log(`\n[${ms()}] --- ${label} ---\n${t.slice(0, 700)}\nССЫЛКИ: ${useful.join(' | ')}`);
  return { t, links: useful };
};
const follow = async (page, link) => {
  const href = link.split('=>')[1];
  await page.goto(new URL(href, page.url()).href, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(200);
};
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  await page.goto('http://lbast.ru/loc.php?obj=5229&go=2', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(200);
  let s = await snap(page, `ЗАБРОС (ждём ${WAIT_S}s перед подсечкой)`);
  if (WAIT_S > 0) {
    await sleep(WAIT_S * 1000);
    await page.reload({ waitUntil: 'domcontentloaded' }).catch(()=>{});
    s = await snap(page, `после ожидания ${WAIT_S}s`);
  }
  for (let i = 1; i <= 8; i++) {
    const pull = s.links.find((l) => /подсек|тянуть|тащ|вытащ|подсечь|дернуть|дёрнуть/i.test(l));
    if (!pull) { console.log('ссылки подсечки нет'); break; }
    await follow(page, pull);
    s = await snap(page, `после «${pull.split('=>')[0]}» (${i})`);
    if (/улов|поймал|ушла|сорвал|кг/i.test(s.t) && !s.links.some((l)=>/подсек|тянуть|тащ/i.test(l))) break;
  }
  await page.goto('http://lbast.ru/loc.php?obj=5229&go=1', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(300);
  const t = (await getBodyText(page).catch(()=>'')).replace(/[ \t]+/g,' ');
  console.log('\nИТОГ: ' + (t.match(/Рыбалка:\s*\d+\s*из\s*\d+/) || [''])[0] + ' | ' + (t.match(/Общий улов:\s*[\d.]+\s*кг/) || [''])[0]);
  await ctx.close();
})();
