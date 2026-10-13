const { chromium } = require('playwright');
const m = require('./module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = [];
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  const open = async (u, w = 900) => { await page.goto(new URL(u, 'http://lbast.ru/').href, { waitUntil: 'domcontentloaded', timeout: 60000 }); await sleep(w); };
  const txt = async () => (await m.getBodyText(page).catch(() => '')).replace(/\s+/g, ' ');
  for (const mv of [159, 112]) {
    await open('map.php?mv=' + mv, 1400);
    out.push(`\n===== map mv=${mv} =====\n${(await txt()).slice(0, 2200)}`);
    const ls = await page.evaluate(() => Array.from(document.querySelectorAll('a')).map((a) => `${(a.innerText || '').trim()} -> ${a.getAttribute('href') || ''}`).filter((s) => s.length > 3));
    out.push(`ССЫЛКИ: ${ls.join(' | ').slice(0, 1500)}`);
  }
  require('fs').writeFileSync(process.argv[2], out.join('\n'), 'utf8');
  await ctx.close();
})().catch((e) => { require('fs').writeFileSync(process.argv[2], `ОШИБКА: ${e.stack}\n${out.join('\n')}`, 'utf8'); process.exit(1); });
