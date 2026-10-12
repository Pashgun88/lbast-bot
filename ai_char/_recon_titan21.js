const { chromium } = require('playwright');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  await page.goto('http://lbast.ru/map.php?mv=0&go=showBuildings', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(1200);
  const html = await page.content();
  console.log('html len ' + html.length + ', есть титан: ' + /итан/i.test(html));
  // вытащим таблицу секторов
  const cells = await page.$$eval('td', (ts) => ts.map((td) => ({ txt: (td.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60), title: td.getAttribute('title') || td.getAttribute('alt') || '', html: (td.innerHTML || '').slice(0, 120) })));
  console.log('ячеек: ' + cells.length);
  const hit = cells.map((c, i) => ({ i, ...c })).filter((c) => /итан|\b43\b/.test(c.txt + c.title + c.html));
  console.log(JSON.stringify(hit, null, 1).slice(0, 2000));
  // ищем в html подсказки с номерами секторов
  const m43 = html.match(/.{200}43.{200}/g);
  if (m43) console.log('\n--- контексты «43» ---\n' + m43.slice(0, 5).join('\n...\n'));
  await ctx.close();
})();
