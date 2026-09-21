// Разовый прогон цепочки гайд-квестов в своём окне браузера — тем же кодом, каким это делает
// основной бот (guides/quests.js -> guide_run.js). Отличие одно: бой берётся из
// fight_standalone.js, потому что daily_quests_piraty.js свой fightLoop не экспортирует.
//
//   node guides/run_once.js                 # обычная проверка (квест должен быть в меню Q)
//   node guides/run_once.js --force         # не проверять меню Q (сцена уже начата)
//
// Сценарий/менеджер на это время должны быть остановлены: профиль Chrome один на всех.
const { chromium } = require('playwright');
const path = require('path');
const { browserLaunchArgs, getBodyText, goto, links } = require('./lib');
const { fightLoop } = require('./fight_standalone');
const { runGuideQuestsIfDue } = require('./quests');

const PROFILE = path.join(__dirname, '..', 'chrome-profile');

(async () => {
  const force = process.argv.includes('--force');
  const ctx = await chromium.launchPersistentContext(PROFILE, {
    headless: false,
    viewport: null,
    args: await browserLaunchArgs(),
  });
  const page = ctx.pages()[0] || (await ctx.newPage());

  try {
    await goto(page, 'location.php');
    const statsText = await getBodyText(page);
    const reserve = statsText.match(/\(\d+\/\d+\)\s*\((-?\d+)\)/);
    const reserveMinutes = reserve ? Number(reserve[1]) : null;
    console.log(`run_once: резерв=${reserveMinutes ?? 'n/a'} мин, force=${force}`);

    // Меню Q: список доступных заданий. Ссылка называется "Q<число>", адрес у неё динамический,
    // поэтому берём href со страницы, а не угадываем URL.
    let menuText = '';
    if (!force) {
      const qLink = (await links(page)).find((x) => /^Q\d+$/i.test(x.t));
      if (!qLink) {
        console.log('run_once: ссылки Q на странице нет — доступных заданий нет.');
        return;
      }
      await goto(page, qLink.h);
      menuText = await getBodyText(page);
      console.log('run_once: меню Q =', menuText.replace(/\n+/g, ' | ').slice(0, 300));
      await goto(page, 'location.php');
    }

    const did = await runGuideQuestsIfDue(page, {
      fightLoop,
      reserveMinutes: force ? 999 : reserveMinutes,
      isInMenu: (name) => (force ? true : menuText.includes(name)),
    });
    console.log('run_once: did =', did);
  } finally {
    await ctx.close();
  }
})();
