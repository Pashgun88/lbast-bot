const { chromium } = require('playwright');
const { getBodyText } = require('./module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  await page.goto('http://lbast.ru/letters.php?mod=clan_spam', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(900);
  const t = (await getBodyText(page).catch(()=>'')).replace(/[ \t]+/g,' ');
  // убираем длинные списки чисел из селектов
  const clean = t.replace(/(\n\s*\d+)+/g, '\n[уровни]');
  console.log('=== ДОСКА СОБЫТИЙ (текст) ===\n' + clean.slice(0, 2500));
  const sel = await page.$$eval('select', (ss) => ss.map((s) => ({ name: s.name, value: s.value, first: s.options[0] && s.options[0].value, last: s.options[s.options.length-1] && s.options[s.options.length-1].value })));
  console.log('селекты: ' + JSON.stringify(sel));
  const sub = await page.$$eval('input[type=submit]', (is) => is.map((i) => i.value));
  console.log('кнопки: ' + JSON.stringify(sub));
  const links = await page.$$eval('a', (as) => as.map((a) => `«${(a.innerText||'').trim()}» -> ${a.getAttribute('href')}`));
  console.log('ссылки со словом спам: ' + links.filter((l)=>/спам/i.test(l)).join(' | '));
  await ctx.close();
})();
