const { chromium } = require('playwright');
const m = require('./module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  const body = async () => (await m.getBodyText(page).catch(() => '')).replace(/[ \t]+/g, ' ');
  for (const u of ['zhg.php?blogin=zlata&bid=46884&c=1', 'zhg_web.php?bid=46884', 'zhg.php?bid=46884&mod=last&c=1']) {
    await page.goto('http://lbast.ru/' + u, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
    await sleep(1000);
    const t = await body();
    const hit = /аренд|прода|цена|дин|уровень|ур\./i.test(t);
    console.log(`\n[${u}] торговое похоже: ${hit}\n` + t.slice(0, 1500));
  }
  await ctx.close();
})();
