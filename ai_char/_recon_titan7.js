const { chromium } = require('playwright');
const m = require('./module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  const go = async (u, label) => {
    try { await page.goto(u, { waitUntil: 'domcontentloaded', timeout: 45000 }); } catch (e) { console.log(label + ' ERR ' + e.message); return; }
    await sleep(600);
    const t = (await m.getBodyText(page).catch(() => '')).replace(/[ \t]+/g, ' ');
    console.log('\n=== ' + label + ' ===' + (/итан/i.test(t) ? ' <<< ТИТАН' : ''));
    console.log(t.slice(0, 1200));
    const forms = await page.$$eval('form', (fs) => fs.map((f) => f.getAttribute('action') + ' :: ' + Array.from(f.querySelectorAll('input,select')).map((i) => i.tagName + '[' + i.getAttribute('name') + ']').join(',')));
    if (forms.length) console.log('ФОРМЫ: ' + JSON.stringify(forms));
  };
  await go('http://lbast.ru/forum.php', 'ФОРУМ');
  await go('http://lbast.ru/zhg.php', 'ЖГ');
  await ctx.close();
})();
