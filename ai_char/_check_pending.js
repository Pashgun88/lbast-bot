const { chromium } = require('playwright');
const m = require('./module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  await page.goto('http://lbast.ru/location.php', { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
  await sleep(900);
  const t = (await m.getBodyText(page).catch(() => '')).replace(/\s+/g, ' ');
  const links = await page.$$eval('a', (as) => as.map((a) => ({ t: (a.textContent || '').trim(), h: a.getAttribute('href') || '' }))).catch(() => []);
  const boj = links.filter((a) => /boj=/.test(a.h) || /^В бой/.test(a.t));
  console.log('локация: ' + t.slice(0, 220));
  console.log('\nпризнаки висящего боя: ' + (boj.length ? JSON.stringify(boj) : 'нет'));
  const st = require('./lib/core').parseStats(await m.getBodyText(page));
  console.log('статы читаются: ' + JSON.stringify(st));
  await ctx.close();
})();
