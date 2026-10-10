const { chromium } = require('playwright');
const m = require('./module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  const txt = async () => (await m.getBodyText(page)).replace(/\s+/g, ' ');
  // анкета игрока по нику
  for (const nick of ['Zlata', 'Злата']) {
    await page.goto(`http://lbast.ru/pers.php?mod=anketa&lgn=${encodeURIComponent(nick)}`, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    await sleep(800);
    const t = await txt();
    console.log(`--- анкета «${nick}» ---\n${t.slice(0, 700)}`);
    const links = await page.evaluate(() => Array.from(document.querySelectorAll('a')).map((a) => (a.innerText || '').trim()).filter(Boolean));
    console.log('ссылки:', links.join(' | ').slice(0, 400));
  }
  await ctx.close();
})();
