const { chromium } = require('playwright');
const { getBodyText } = require('./module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  const open = async (label, url, lim = 2500) => {
    await page.goto('http://lbast.ru/' + url, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    await sleep(700);
    console.log(`\n=== ${label} (${url}) ===\n` + (await getBodyText(page).catch(()=>'')).replace(/[ \t]+/g,' ').slice(0, lim));
  };
  await open('ПЕРЕДАЧИ (наши предложения)', 'inv.php?mod=peredachi', 1800);
  await open('ЛОГ ПЕРЕДАЧ', 'inv.php?mod=logpered', 1500);
  // что лежит у казны клана
  await page.goto('http://lbast.ru/log_infa.php?mod=who&blogin=Bogi_vojny', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  await sleep(700);
  const veshi = await page.evaluate(() => {
    const a = Array.from(document.querySelectorAll('a')).find((x) => /Вещи/i.test((x.textContent||'').trim()));
    return a ? a.getAttribute('href') : null;
  });
  console.log('\nссылка [Вещи] казны: ' + veshi);
  if (veshi) {
    for (const suf of ['', '&cpage=2', '&cpage=3']) {
      await page.goto(new URL(veshi + suf, 'http://lbast.ru/').href, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
      await sleep(600);
      const t = (await getBodyText(page).catch(()=>'')).replace(/[ \t]+/g,' ');
      console.log(`\n--- ВЕЩИ КАЗНЫ${suf} ---\n` + t.slice(0, 2200));
    }
  }
  await ctx.close();
})();
