// Разведка экрана для написания .steps: node look.js [действие ...]
//   url:<путь>   открыть страницу (location.php, pers.php, ...)
//   city:<N>     быстрый путь в город N (как @city в guide_run)
//   <текст>      клик по ссылке, текст которой начинается с этого
// После всех действий печатает экран и ссылки. Драйвер должен быть остановлен (один профиль).
const { chromium } = require('playwright');
const m = require('../module');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const norm = (s) => String(s || '').replace(/^[\s\-–—*•]+/, '').replace(/[«»"'.,!?…:;()]/g, '').replace(/ё/g, 'е').replace(/\s+/g, ' ').trim().toLowerCase();
const links = (page) => page.evaluate(() => Array.from(document.querySelectorAll('a')).map((a) => ({ t: (a.innerText || '').trim().replace(/\s+/g, ' '), h: a.getAttribute('href') || '' })).filter((x) => x.t)).catch(() => []);

(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  try {
    const acts = process.argv.slice(2);
    if (!acts.length || !acts[0].startsWith('url:')) acts.unshift('url:location.php');
    for (const a of acts) {
      if (a.startsWith('url:')) {
        await page.goto('http://lbast.ru/' + a.slice(4), { waitUntil: 'domcontentloaded', timeout: 60000 });
      } else if (a.startsWith('city:')) {
        await page.goto(`http://lbast.ru/location.php?mod=fastway&lway=${a.slice(5)}`, { waitUntil: "domcontentloaded", timeout: 60000 }); await sleep(6000); await page.goto("http://lbast.ru/location.php", { waitUntil: "domcontentloaded", timeout: 60000 });
      } else {
        const l = await links(page);
        const hit = l.find((x) => norm(x.t).startsWith(norm(a)));
        if (!hit) { console.log(`НЕТ ССЫЛКИ: ${a}`); continue; }
        console.log(`клик: ${hit.t}`);
        await page.goto(new URL(hit.h, page.url()).href, { waitUntil: 'domcontentloaded', timeout: 60000 });
      }
      await sleep(800);
    }
    const t = await m.getBodyText(page);
    const l = await links(page);
    console.log(t.replace(/\n\s*\n+/g, '\n').slice(0, 2500));
    console.log('LINKS: ' + l.map((x) => x.t).join(' | '));
  } finally { await ctx.close(); }
})();
