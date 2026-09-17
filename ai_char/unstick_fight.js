// Развязать залипший бой БЕЗОПАСНО.
//
// Незавершённый бой блокирует игру целиком: location.php отдаёт голый "В бой!", Q-меню не
// открывается, parseStats даёт null/null. Выйти можно только пройдя бой. HP при этом
// читается из АНКЕТЫ (pers.php) - она работает даже в залипшем состоянии.
const { chromium } = require('playwright');
const path = require('path');
const { getBodyText, parseStats, fightLoop, clickByTexts, fixedPause } = require('./module');

const FLOOR = 0.7;
const MAX_WAIT_MS = 45 * 60 * 1000;

async function readHpFromAnketa(page) {
  await page.goto('http://lbast.ru/pers.php', { waitUntil: 'domcontentloaded', timeout: 60000 });
  const m = (await getBodyText(page)).match(/\((-?\d+)\s*\/\s*(\d+)\)/);
  return m ? { current: Number(m[1]), max: Number(m[2]) } : null;
}

(async () => {
  const ctx = await chromium.launchPersistentContext(path.join(process.cwd(), 'chrome-profile-ai-char'), {
    headless: false,
    viewport: null,
  });
  const page = ctx.pages()[0] || (await ctx.newPage());

  let hp = await readHpFromAnketa(page);
  if (!hp) {
    console.log('HP не читается даже из анкеты -> в бой не иду, нужна ручная проверка.');
    await ctx.close();
    return;
  }
  console.log(`HP из анкеты: ${hp.current}/${hp.max} (${Math.round((hp.current / hp.max) * 100)}%)`);

  const need = Math.ceil(hp.max * FLOOR);
  const deadline = Date.now() + MAX_WAIT_MS;
  while (hp.current < need && Date.now() < deadline) {
    console.log(`Жду восстановления: ${hp.current}/${hp.max}, нужно ${need}`);
    await fixedPause(page, 60_000);
    const next = await readHpFromAnketa(page);
    if (next) hp = next;
  }
  if (hp.current < need) {
    console.log(`HP не дотянуло (${hp.current}/${hp.max}) -> бой не начинаю.`);
    await ctx.close();
    return;
  }

  console.log(`HP в порядке (${hp.current}/${hp.max}) -> развязываю бой.`);
  await page.goto('http://lbast.ru/location.php', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await clickByTexts(page, ['В бой!', 'в бой!', 'В бой', 'в бой'], 'В бой! (развязать залипший бой)').catch(() => {});
  await fightLoop(page).catch((e) => console.log('fightLoop error:', e.message));

  await page.goto('http://lbast.ru/location.php', { waitUntil: 'domcontentloaded', timeout: 60000 });
  const after = parseStats(await getBodyText(page));
  console.log(`ПОСЛЕ БОЯ: HP ${after.hpCurrent}/${after.hpMax}`);
  console.log('Экран:', (await getBodyText(page)).slice(0, 300));

  await ctx.close();
})();
