const { chromium } = require('playwright');
const m = require('./module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  const urls = ['map.php', 'help.php', 'info.php', 'location.php?mod=map', 'zamok.php', 'pers.php?mod=skills'];
  for (const u of urls) {
    try {
      await page.goto('http://lbast.ru/' + u, { waitUntil: 'domcontentloaded', timeout: 45000 });
    } catch (e) { console.log(u + ' ERR ' + e.message); continue; }
    await sleep(600);
    const t = (await m.getBodyText(page).catch(() => '')).replace(/[ \t]+/g, ' ');
    const links = await page.$$eval('a', (as) => as.map((a) => (a.textContent || '').trim() + ' -> ' + (a.getAttribute('href') || '')));
    const hit = links.filter((s) => /итан/i.test(s));
    console.log('\n=== ' + u + ' === (' + t.length + ' симв.)' + (/итан/i.test(t) ? '  <<< ТЕКСТ СОДЕРЖИТ ТИТАН' : ''));
    console.log(t.slice(0, 900));
    if (hit.length) console.log('*** ССЫЛКИ: ' + hit.join(' | '));
  }
  await ctx.close();
})();
