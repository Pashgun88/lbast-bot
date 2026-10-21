// Один заход рыбалки в форте Жжёного листа, с полным протоколом: что на экране, какие ссылки,
// сколько прошло времени. Ничего не тянем «на удачу»: смотрим устройство.
const { chromium } = require('playwright');
const { getBodyText } = require('./module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const t0 = Date.now();
const ms = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;
const snap = async (page, label) => {
  const t = (await getBodyText(page).catch(()=>'')).replace(/[ \t]+/g,' ').replace(/\n{2,}/g,'\n').trim();
  const links = await page.$$eval('a', (as) => as.map((a) => `${(a.innerText||'').trim()}=>${a.getAttribute('href')}`));
  const useful = links.filter((l)=>!/^(Обновить|Чат|В игру|Выход|Размер текста|Амулет|Конь|Карта|Кланы|ЖГ|Форум|Галерея|Кто здесь\?)=>/.test(l));
  console.log(`\n[${ms()}] --- ${label} ---\n${t.slice(0, 900)}\nССЫЛКИ: ${useful.join(' | ')}`);
  return { t, links: useful };
};
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  await page.goto('http://lbast.ru/loc.php?obj=5229&go=1', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(400);
  let s = await snap(page, 'РЫБАЧИТЬ (go=1)');
  // если есть ссылка заброса - жмём и смотрим, что происходит дальше, ничего не вытягивая
  for (let step = 1; step <= 6; step++) {
    const next = s.links.find((l) => /заброс|закин|начать|играть|удочк|блесн/i.test(l));
    if (!next) break;
    const href = next.split('=>')[1];
    await page.goto(new URL(href, page.url()).href, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(300);
    s = await snap(page, `после «${next.split('=>')[0]}»`);
  }
  // ждём и смотрим, меняется ли страница сама
  for (const w of [2000, 3000, 5000]) {
    await sleep(w);
    await page.reload({ waitUntil: 'domcontentloaded' }).catch(()=>{});
    await snap(page, `обновил через ${w}мс`);
  }
  await ctx.close();
})();
