const { chromium } = require('playwright');
const m = require('./module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  const txt = async () => (await m.getBodyText(page)).replace(/\s+/g, ' ');
  for (const u of ['zhg.php?mod=last', 'zhg_web.php']) {
    await page.goto('http://lbast.ru/' + u, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    await sleep(900);
    console.log(`--- ${u} ---\n` + (await txt()).slice(0, 600));
    const all = await page.evaluate(() => {
      const a = Array.from(document.querySelectorAll('a')).find((x) => /Все блоги/i.test((x.innerText || '').trim()));
      return a ? a.getAttribute('href') : null;
    });
    if (all) {
      await page.goto(new URL(all, 'http://lbast.ru/').href, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await sleep(1000);
      const t = await txt();
      console.log('--- Все блоги ---\n' + t.slice(0, 500));
      const z = await page.evaluate(() => Array.from(document.querySelectorAll('a'))
        .filter((x) => /zlata/i.test((x.innerText || '') + (x.getAttribute('href') || '')))
        .map((x) => `${(x.innerText || '').trim()} [${x.getAttribute('href')}]`));
      console.log('zlata в списке блогов:', z.join(' | ') || 'нет на этой странице');
      break;
    }
  }
  await ctx.close();
})();
