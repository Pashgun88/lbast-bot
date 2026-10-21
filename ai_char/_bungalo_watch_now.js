const { chromium } = require('playwright');
const m = require('./module');
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  await page.goto('http://lbast.ru/pers.php', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(()=>{});
  const t = (await m.getBodyText(page).catch(()=>'')).replace(/[ \t]+/g,' ');
  console.log('шапка: ' + (t.split('\n').find((l)=>/AI__/.test(l)) || '?'));
  console.log('бой висит: ' + /Бой с|Ваш ход|Атаковать/i.test(t));
  const { watchBungaloTasksIfDue } = require('./guides/bungalo_watch');
  console.log('--- дозор ---');
  console.log('результат: ' + await watchBungaloTasksIfDue(page));
  await ctx.close();
})();
