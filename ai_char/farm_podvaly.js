// Постоянный фарм в "Подвалах" (Южные ворота Стоунгарда) для AI__.
// Отдельный от driver.js процесс: сюда просто фармим до низкого HP, ждём
// восстановления (реальная скорость регена читается из pers.php), и повторяем.
// Запуск: AI_LOGIN=... AI_PASS=... node ai_char/farm_podvaly.js
// Остановка: Ctrl+C / TaskStop.

const { chromium } = require('playwright');
const path = require('path');
const { getBodyText, parseStats, fightLoop, clickByTexts, existsAnyText } = require('./module');

const LOGIN = process.env.AI_LOGIN;
const PASS = process.env.AI_PASS;
const HP_SAFETY_FRACTION = 0.35; // прекращаем брать новый бой ниже этой доли от макс. HP
const MAX_ROUNDS = Number(process.env.PODVALY_MAX_ROUNDS || 100000);

async function waitOutHorseTravel(page, url, maxAttempts = 8) {
  for (let i = 0; i < maxAttempts; i++) {
    const text = await getBodyText(page);
    if (!/В\s*пути/i.test(text)) return;
    await new Promise((r) => setTimeout(r, 2500));
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  }
}

async function enterPodvaly(page) {
  const stoneUrl = 'http://lbast.ru/location.php?mod=konj&lway=1';
  await page.goto(stoneUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await waitOutHorseTravel(page, stoneUrl);

  let text = await getBodyText(page);
  if (!/подвал/i.test(text)) {
    await page.goto('http://lbast.ru/location.php?idem=1', { waitUntil: 'domcontentloaded', timeout: 60000 });
    text = await getBodyText(page);
  }

  if (!(await existsAnyText(page, ['В подвалы']))) {
    console.log('ERROR: "В подвалы" not found on this tile.');
    console.log(text.slice(0, 300));
    return false;
  }

  await clickByTexts(page, ['В подвалы'], 'В подвалы');
  await new Promise((r) => setTimeout(r, 1000));
  return true;
}

async function waitForHeal(page) {
  for (;;) {
    await page.goto('http://lbast.ru/pers.php', { waitUntil: 'domcontentloaded', timeout: 60000 });
    const text = await getBodyText(page);
    const stats = parseStats(text);
    const healMatch = text.match(/Лечение:\s*(\d+)\s*hp\/мин/i);
    const healRate = healMatch ? Number(healMatch[1]) : 16; // фолбэк на наблюдавшуюся ранее скорость

    if (typeof stats.hpCurrent !== 'number' || typeof stats.hpMax !== 'number') {
      console.log('Не смог прочитать HP для расчёта восстановления, жду 1 минуту и пробую снова.');
      await new Promise((r) => setTimeout(r, 60_000));
      continue;
    }

    if (stats.hpCurrent > stats.hpMax * HP_SAFETY_FRACTION) {
      console.log(`HP восстановилось: ${stats.hpCurrent}/${stats.hpMax} -> продолжаю фарм.`);
      return;
    }

    const targetHp = stats.hpMax * 0.9; // лечимся почти до полного, не впритык к порогу
    const needed = Math.max(0, targetHp - stats.hpCurrent);
    const waitMinutes = Math.max(1, Math.ceil(needed / Math.max(1, healRate)));
    console.log(
      `HP=${stats.hpCurrent}/${stats.hpMax} (лечение ${healRate} hp/мин) -> жду ~${waitMinutes} мин, браузер остаётся открытым.`
    );
    await new Promise((r) => setTimeout(r, waitMinutes * 60_000));
  }
}

(async () => {
  const userDataDir = path.join(__dirname, 'chrome-profile-ai-char');
  const context = await chromium.launchPersistentContext(userDataDir, { headless: false });
  const page = context.pages()[0] || (await context.newPage());

  await page.goto('http://lbast.ru/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  const loginInput = page.locator('input[name="login"]');
  if ((await loginInput.count().catch(() => 0)) > 0) {
    await loginInput.fill(LOGIN);
    await page.locator('input[name="password"]').fill(PASS);
    await page.locator('input[type="submit"]').first().click();
    await page.waitForLoadState('domcontentloaded').catch(() => {});
  }

  let totalFights = 0;

  for (let round = 1; round <= MAX_ROUNDS; round++) {
    console.log(`\n===== ROUND ${round} =====`);

    const entered = await enterPodvaly(page);
    if (!entered) {
      console.log('Не удалось зайти в Подвалы, жду 2 минуты и пробую снова.');
      await new Promise((r) => setTimeout(r, 120_000));
      continue;
    }

    for (;;) {
      const stats = parseStats(await getBodyText(page));
      console.log(`fight ${totalFights + 1} (round ${round}) -- HP=${stats.hpCurrent}/${stats.hpMax}`);

      if (typeof stats.hpCurrent === 'number' && typeof stats.hpMax === 'number') {
        if (stats.hpCurrent <= 0) {
          console.log('HP <= 0, персонаж выбыл из строя -> жду восстановления.');
          break;
        }
        if (stats.hpCurrent < stats.hpMax * HP_SAFETY_FRACTION) {
          console.log(`HP below ${HP_SAFETY_FRACTION * 100}% max -> жду восстановления перед следующим боем.`);
          break;
        }
      }

      const okOsmotret = await clickByTexts(page, ['Осмотреть подвалы'], 'Осмотреть подвалы');
      if (!okOsmotret) {
        console.log('Не нашёл "Осмотреть подвалы", выхожу из этого захода и пробую войти заново.');
        break;
      }
      await new Promise((r) => setTimeout(r, 800));

      const okAttack = await clickByTexts(page, ['Атаковать'], 'Атаковать');
      if (!okAttack) {
        console.log('Цели нет в этот раз, пробую ещё раз.');
        await new Promise((r) => setTimeout(r, 1000));
        continue;
      }

      const won = await fightLoop(page).catch((e) => {
        console.log('fightLoop error:', e.message);
        return null;
      });
      console.log('fightLoop result:', won);
      totalFights += 1;
      await new Promise((r) => setTimeout(r, 1000));
    }

    await waitForHeal(page);
  }

  console.log(`\nFINAL: totalFights=${totalFights}`);
  console.log('\nKEEP OPEN');
  await new Promise(() => {});
})();
