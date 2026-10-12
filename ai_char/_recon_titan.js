const { chromium } = require('playwright');
const m = require('./module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  const show = async (label, url) => {
    await page.goto('http://lbast.ru/' + url, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch((e) => console.log(label + ' NAV ERR ' + e.message));
    await sleep(800);
    const t = (await m.getBodyText(page).catch(() => '')).replace(/[ \t]+/g, ' ');
    console.log('\n=== ' + label + ' (' + url + ') ===\n' + t.slice(0, 2500));
    const links = await page.$$eval('a', (as) => as.map((a) => (a.textContent || '').trim() + ' -> ' + (a.getAttribute('href') || '')).filter((s) => s.length > 3));
    const hit = links.filter((s) => /итан/i.test(s));
    if (hit.length) console.log('*** ССЫЛКИ С «ТИТАН»: ' + hit.join(' | '));
  };
  await show('Q-МЕНЮ', 'location.php?mod=quests');
  await show('ЛОКАЦИЯ', 'location.php');
  await show('АНКЕТА', 'pers.php');
  await ctx.close();
})();
