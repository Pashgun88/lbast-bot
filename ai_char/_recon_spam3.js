const { chromium } = require('playwright');
const { getBodyText } = require('./module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  await page.goto('http://lbast.ru/letters.php?mod=clan_spam&go=create', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(900);
  const t = (await getBodyText(page).catch(()=>'')).replace(/[ \t]+/g,' ').replace(/(\n\s*\d+)+/g, ' [список уровней] ');
  console.log('=== ДАТЬ СПАМ ===\n' + t.slice(0, 2000));
  const sel = await page.$$eval('select', (ss) => ss.map((s) => ({ name: s.name, value: s.value, opts: s.options.length })));
  console.log('селекты: ' + JSON.stringify(sel));
  const inp = await page.$$eval('input', (is) => is.map((i) => `${i.name||'-'}:${i.type}:${i.value||''}:${i.checked?'checked':''}`));
  console.log('поля: ' + JSON.stringify(inp));
  const html = await page.content();
  const i = html.indexOf('clan_spam&go=create');
  console.log('--- форма в html ---\n' + html.slice(Math.max(0,i-200), i+1200));
  await ctx.close();
})();
