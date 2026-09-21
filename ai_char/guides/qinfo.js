// Разведка: открыть [инфо] квеста из меню Q и показать экран; дальше - клики из argv.
const { chromium } = require('playwright');
const m = require('../module');
const links = (page) => page.evaluate(() => Array.from(document.querySelectorAll('a')).map((a) => ({ t: (a.innerText || '').trim().replace(/\s+/g, ' '), h: a.getAttribute('href') || '' })).filter((x) => x.t && !/statuenull/.test(x.h)));
(async () => {
  const [quest, ...clicks] = process.argv.slice(2);
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  try {
    await page.goto('http://lbast.ru/location.php', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await require('../lib/quest_menu').openQuestsMenu(page);
    await m.clickInfoForQuest(page, quest);
    await page.waitForTimeout(800);
    for (const c of clicks) {
      const x = (await links(page)).find((y) => y.t.toLowerCase().startsWith(c.toLowerCase()));
      if (!x) { console.log('НЕТ ССЫЛКИ:', c); break; }
      console.log('клик:', x.t);
      await page.goto(new URL(x.h, page.url()).href, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForTimeout(1000);
      for (let i = 0; i < 20 && /В пути/.test(await m.getBodyText(page)); i++) {
        await page.waitForTimeout(3000);
        const v = (await links(page)).find((y) => /^В пути/.test(y.t));
        if (v) await page.goto(new URL(v.h, page.url()).href, { waitUntil: 'domcontentloaded', timeout: 60000 });
      }
    }
    console.log((await m.getBodyText(page)).replace(/\n\s*\n+/g, '\n').slice(0, 1500));
    console.log('LINKS: ' + (await links(page)).map((x) => `${x.t} [${x.h.replace(/r=\d+&?/, '')}]`).join(' | '));
  } finally { await ctx.close(); }
})();
