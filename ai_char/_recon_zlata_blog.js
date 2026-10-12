const { chromium } = require('playwright');
const m = require('./module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  const nav = async () => {
    const xs = await page.$$eval('a', (as) => as.map((a) => ({ t: (a.textContent || '').trim().replace(/\s+/g, ' '), h: a.getAttribute('href') || '' }))).catch(() => []);
    return xs.filter((a) => a.t);
  };
  // анкета zlata -> ссылка на её ЖГ
  await page.goto('http://lbast.ru/log_infa.php?mod=who&blogin=zlata', { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
  await sleep(1100);
  const l = await nav();
  const zhg = l.find((a) => /ЖГ|живой|журнал|блог/i.test(a.t) || /zhg_web|zhg\.php/.test(a.h));
  console.log('ссылка на ЖГ: ' + JSON.stringify(zhg));
  if (!zhg) {
    console.log('анкета, ссылки: ' + l.map((a) => '«' + a.t + '»->' + a.h).join(' | ').slice(0, 900));
    return ctx.close();
  }
  await page.goto(new URL(zhg.h, 'http://lbast.ru/').href, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await sleep(1200);
  const t = (await m.getBodyText(page).catch(() => '')).replace(/[ \t]+/g, ' ');
  console.log('\n=== ЖГ ZLATA ===\n' + t.slice(0, 4000));
  await ctx.close();
})();
