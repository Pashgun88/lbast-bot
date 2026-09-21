// Разведка экрана для написания .steps: node guides/look.js [действие ...]
//   url:<путь>   открыть страницу (location.php, pers.php, zhg_web.php?st_id=..., ...)
//   city:<N>     быстрый путь в город N (как @city в guide_run)
//   <текст>      клик по ссылке, текст которой начинается с этого
// После всех действий печатает экран и ссылки.
// ВАЖНО: профиль браузера один на всех — сценарий (manager_bot "Стоп") и open_browser.js должны
// быть остановлены, иначе Chrome не отдаст профиль.
const { chromium } = require('playwright');
const path = require('path');
const { getBodyText, links, norm, sleep, goto, browserLaunchArgs } = require('./lib');

const PROFILE = path.join(__dirname, '..', 'chrome-profile');
const TEXT_LIMIT = Number(process.env.LOOK_TEXT_LIMIT || 2500);

(async () => {
  const ctx = await chromium.launchPersistentContext(PROFILE, {
    headless: false,
    viewport: null,
    args: await browserLaunchArgs(),
  });
  const page = ctx.pages()[0] || (await ctx.newPage());
  try {
    const acts = process.argv.slice(2);
    if (!acts.length || !acts[0].startsWith('url:')) acts.unshift('url:location.php');

    for (const a of acts) {
      if (a.startsWith('url:')) {
        await goto(page, a.slice(4));
      } else if (a.startsWith('city:')) {
        await goto(page, `location.php?mod=fastway&lway=${a.slice(5)}`);
        await sleep(6000);
        await goto(page, 'location.php');
      } else {
        const l = await links(page);
        const hit = l.find((x) => norm(x.t).startsWith(norm(a)));
        if (!hit) { console.log(`НЕТ ССЫЛКИ: ${a}`); continue; }
        console.log(`клик: ${hit.t}`);
        await goto(page, new URL(hit.h, page.url()).href);
      }
      await sleep(800);
    }

    const t = await getBodyText(page);
    const l = await links(page);
    console.log(t.replace(/\n\s*\n+/g, '\n').slice(0, TEXT_LIMIT));
    console.log('LINKS: ' + l.map((x) => x.t).join(' | '));
  } finally {
    await ctx.close();
  }
})();
