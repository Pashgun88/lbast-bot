const { chromium } = require('playwright');
const { getBodyText } = require('./module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  const open = async (label, url) => {
    await page.goto('http://lbast.ru/' + url, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    await sleep(700);
    const t = (await getBodyText(page).catch(() => '')).replace(/[ \t]+/g, ' ');
    console.log(`\n=== ${label} (${url}) ===\n` + t.slice(0, 1800));
    const links = await page.$$eval('a', (as) => as.map((a) => `«${(a.textContent||'').trim()}» -> ${a.getAttribute('href')}`));
    console.log('--- ссылки: ' + links.filter((l) => /магаз|склад|казн|лавк|сдать|товар/i.test(l)).join(' | '));
  };
  await open('ЗАМОК', 'zamok.php');
  // строка эликсира каменного голема в сумке и её ссылки
  await page.goto('http://lbast.ru/inv.php?cpage=2', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(700);
  const rows = await page.evaluate(() => {
    const all = Array.from(document.querySelectorAll('a'));
    const out = [];
    all.forEach((a, i) => {
      if (!/эликсир каменного голема/i.test((a.textContent || '').trim())) return;
      const near = [];
      for (let k = i; k < Math.min(i + 6, all.length); k++) near.push(`«${(all[k].textContent||'').trim()}» -> ${all[k].getAttribute('href')}`);
      out.push(near.join('\n    '));
    });
    return out;
  });
  console.log('\n=== ЭЛИКСИР ГОЛЕМА в сумке ===\n' + rows.join('\n--\n'));
  await ctx.close();
})();
