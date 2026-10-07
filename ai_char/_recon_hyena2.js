// Доходим до гиен: телепорт lway=17 -> Идти на юг -> Идти на запад -> ищем «Выслеживать гиен».
const { chromium } = require('playwright');
const m = require('./module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = [];
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  const links = () => page.evaluate(() => Array.from(document.querySelectorAll('a'))
    .map((a) => ({ t: (a.innerText || '').trim(), h: a.getAttribute('href') || '' }))
    .filter((x) => x.t && x.h));
  const open = async (u, w = 1200) => { await page.goto(new URL(u, 'http://lbast.ru/').href, { waitUntil: 'domcontentloaded', timeout: 60000 }); await sleep(w); };
  const dump = async (title) => {
    const t = (await m.getBodyText(page)).replace(/\s+/g, ' ').slice(0, 500);
    const ls = await links();
    const nav = ls.filter((l) => /идти|выслеж|охот|напасть|юг|запад|север|восток/i.test(l.t));
    out.push(`\n===== ${title} =====\nТЕКСТ: ${t}\nХОДЫ: ${nav.map((l) => `${l.t} -> ${l.h}`).join(' | ')}`);
    return ls;
  };
  await open('/location.php?mod=fastway&lway=17');
  let ls = await dump('Таверна «Три поросенка» (телепорт)');
  const go = async (re, title) => {
    const hit = ls.find((l) => re.test(l.t));
    if (!hit) { out.push(`\nНЕ НАШЁЛ ход ${re}`); return false; }
    out.push(`\n-> жму «${hit.t}»`);
    await open(hit.h);
    ls = await dump(title);
    return true;
  };
  if (await go(/^Идти на юг$/i, 'после «Идти на юг»')) {
    await go(/^Идти на запад$/i, 'после «Идти на запад»');
  }
  require('fs').writeFileSync(process.argv[2], out.join('\n'), 'utf8');
  await ctx.close();
})().catch((e) => { require('fs').writeFileSync(process.argv[2], `ОШИБКА: ${e.stack}`, 'utf8'); process.exit(1); });
