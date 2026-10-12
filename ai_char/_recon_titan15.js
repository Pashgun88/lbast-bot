const { chromium } = require('playwright');
const m = require('./module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  for (const w of ['Дари', 'школа', 'титанов']) {
    for (const mv of [0, 1, 2]) {
      await page.goto('http://lbast.ru/map.php?mv=' + mv + '&go=search&look=' + encodeURIComponent(w), { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
      await sleep(600);
      const t = (await m.getBodyText(page).catch(() => '')).replace(/[ \t]+/g, ' ');
      const body = (t.split('Замки NPC Всё').pop() || '').split('1. Введите')[0].replace(/\s+/g, ' ').trim();
      console.log(`[${w} mv=${mv}] ` + (body.slice(0, 900) || '-'));
      const ll = await page.$$eval('a', (as) => as.map((a) => (a.textContent || '').trim() + ' -> ' + (a.getAttribute('href') || '')));
      const hit = ll.filter((s) => /итан|Дари|школ/i.test(s));
      if (hit.length) console.log('   ССЫЛКИ: ' + hit.join(' | ').slice(0, 800));
    }
  }
  await ctx.close();
})();
