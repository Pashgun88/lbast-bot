// Разведка аукциона: что на странице, какие ссылки и формы, что отдаёт каждая.
const { chromium } = require('playwright');
const { getBodyText } = require('./module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  const click = async (re) => {
    const h = await page.evaluate((src) => {
      const r = new RegExp(src, 'i');
      const a = Array.from(document.querySelectorAll('a')).find((x) => r.test((x.innerText||'').trim()));
      return a ? a.getAttribute('href') : null;
    }, re.source).catch(()=>null);
    if (!h) return false;
    await page.goto(new URL(h, 'http://lbast.ru/').href, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(600);
    return true;
  };
  // мы уже в Городе Мастеров после утреннего захода? проверим
  await page.goto('http://lbast.ru/location.php', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(500);
  if (!(await click(/^Городская ратуша$/))) {
    await page.goto('http://lbast.ru/location.php?mod=fastway&lway=2', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(7000);
    await page.goto('http://lbast.ru/location.php', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(500);
    await click(/Северные ворота/); await click(/^Идти на север/);
    for (let i=0;i<5;i++){ const w=await page.evaluate(()=>Array.from(document.querySelectorAll('a')).some(a=>/^Идти на запад/i.test((a.innerText||'').trim()))); if(w)break; await click(/^Идти на север/);}
    for (let i=0;i<3;i++){ await click(/^Идти на запад/); if (await page.evaluate(()=>Array.from(document.querySelectorAll('a')).some(a=>/^Городская ратуша$/i.test((a.innerText||'').trim())))) break; }
    await click(/^Городская ратуша$/);
  }
  await click(/^Аукцион$/);
  const t = (await getBodyText(page).catch(()=>'')).replace(/[ \t]+/g,' ');
  console.log('=== АУКЦИОН: текст ===\n' + t.slice(0, 2000));
  const links = await page.$$eval('a', (as) => as.map((a) => `«${(a.innerText||'').trim()}» -> ${a.getAttribute('href')}`));
  console.log('\n--- ссылки ---\n' + links.join('\n'));
  const forms = await page.$$eval('form', (fs) => fs.map((f) => ({ action: f.getAttribute('action'), method: f.getAttribute('method'),
    fields: Array.from(f.querySelectorAll('input,select,textarea')).map((i) => `${i.name||'-'}:${i.type||i.tagName}:${i.value||''}`) })));
  console.log('--- формы: ' + JSON.stringify(forms));
  const url = page.url();
  console.log('--- URL доски: ' + url);
  // что отдают соседние go= на этом объекте
  for (const go of [1,2,3,4,6,7]) {
    const u = url.replace(/mod=auction.*$/, 'mod=auction&go=' + go);
    await page.goto(u, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(()=>{});
    await sleep(400);
    const txt = (await getBodyText(page).catch(()=>'')).replace(/\s+/g,' ');
    console.log(`go=${go}: ` + txt.slice(0, 200));
  }
  await ctx.close();
})();
