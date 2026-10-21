// Заброс с управляемым числом «Поклевок»: node _fish_cast2.js <сколько раз жать «Поклевка»>
const { chromium } = require('playwright');
const { getBodyText } = require('./module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const N = Number(process.argv[2] || 1);
const snap = async (page, label) => {
  const t = (await getBodyText(page).catch(()=>'')).replace(/[ \t]+/g,' ').replace(/\n{2,}/g,'\n').trim();
  const links = await page.$$eval('a', (as) => as.map((a) => `${(a.innerText||'').trim()}=>${a.getAttribute('href')}`));
  const useful = links.filter((l)=>!/^(Обновить|Чат|В игру|Выход|Размер текста|Амулет|Конь|Карта|Кланы|ЖГ|Форум|Галерея|Кто здесь\?)=>/.test(l));
  const body = t.split('БЕРЕГ РЕКИ ЖУРМА')[1] || t;
  console.log(`--- ${label}: ${body.replace(/\n/g,' / ').slice(0, 260)}\n    ссылки: ${useful.map(l=>l.split('=>')[0]).join(' | ')}`);
  return { t, links: useful };
};
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  await page.goto('http://lbast.ru/loc.php?obj=5229&go=2', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(200);
  let s = await snap(page, 'заброс');
  for (let i = 1; i <= N; i++) {
    const bite = s.links.find((l) => /^Поклевка=>/i.test(l));
    if (!bite) { console.log('«Поклевка» больше нет'); break; }
    await page.goto(new URL(bite.split('=>')[1], page.url()).href, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(200);
    s = await snap(page, `поклевка ${i}`);
  }
  // чем вытаскиваем - любая ссылка, кроме «Поклевка», «Вернуться», «Уйти»
  const other = s.links.filter((l) => !/^(Поклевка|Вернуться|Уйти)=>/i.test(l));
  console.log('прочие ссылки на этом шаге: ' + (other.join(' | ') || 'нет'));
  if (other.length) {
    await page.goto(new URL(other[0].split('=>')[1], page.url()).href, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(200);
    await snap(page, `после «${other[0].split('=>')[0]}»`);
  }
  await page.goto('http://lbast.ru/loc.php?obj=5229&go=1', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(300);
  const t = (await getBodyText(page).catch(()=>'')).replace(/[ \t]+/g,' ');
  console.log('ИТОГ: ' + (t.match(/Рыбалка:\s*\d+\s*из\s*\d+/)||[''])[0] + ' | ' + (t.match(/Общий улов:\s*[\d.]+\s*кг/)||[''])[0]);
  await ctx.close();
})();
