// Разведка риска: жмём «Поклевка» до упора и записываем, как меняется «шанс поклевки» и на каком
// шаге рыба сходит. Одна попытка (10 дин) за карту риска - дёшево.
const { chromium } = require('playwright');
const { getBodyText } = require('./module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MAX = Number(process.argv[2] || 40);
const read = async (page) => {
  const t = (await getBodyText(page).catch(()=>'')).replace(/[ \t]+/g,' ');
  const n = (t.match(/(\d+)\.\s*Шанс поклевки:\s*([^\n]+)/) || []);
  const links = await page.$$eval('a', (as) => as.map((a) => `${(a.innerText||'').trim()}=>${a.getAttribute('href')}`));
  return { t, step: n[1], chance: (n[2]||'').trim(), links };
};
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  await page.goto('http://lbast.ru/loc.php?obj=5229&go=2', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(200);
  let s = await read(page);
  console.log(`старт: шаг ${s.step}, шанс «${s.chance}»`);
  for (let i = 1; i <= MAX; i++) {
    const bite = s.links.find((l) => /^Поклевка=>/i.test(l));
    if (!bite) { console.log(`шаг ${i}: ссылки «Поклевка» нет -> ${s.t.split('ЖУРМА')[1] ? s.t.split('ЖУРМА')[1].replace(/\n/g,' ').slice(0,200) : ''}`); break; }
    await page.goto(new URL(bite.split('=>')[1], page.url()).href, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(150);
    s = await read(page);
    const tail = (s.t.split('ЖУРМА')[1] || '').replace(/\s+/g,' ').slice(0, 150);
    console.log(`жму ${i}: шаг ${s.step || '-'}, шанс «${s.chance || '-'}» | ${tail}`);
    if (!s.chance) break; // рыба сошла или экран сменился
  }
  console.log('\nфинальный экран: ' + (s.t.split('ЖУРМА')[1] || '').replace(/\s+/g,' ').slice(0, 300));
  await page.goto('http://lbast.ru/loc.php?obj=5229&go=1', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(300);
  const t = (await getBodyText(page).catch(()=>'')).replace(/[ \t]+/g,' ');
  console.log('ИТОГ: ' + (t.match(/Рыбалка:\s*\d+\s*из\s*\d+/)||[''])[0] + ' | ' + (t.match(/Общий улов:\s*[\d.]+\s*кг/)||[''])[0]);
  await ctx.close();
})();
