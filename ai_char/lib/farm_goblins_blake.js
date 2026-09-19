// Фарм гоблинов и Блейка (маршруты и вход в бой).
// Выделено из ai_char/module.js (там только сборка экспорта). Изменяемое состояние - S из ./state.

// Экспорт стоит ДО require: файлы lib/ вызывают друг друга по кругу, а объявления функций
// всплывают (hoisting), поэтому к моменту любого встречного require все функции уже здесь.
module.exports = {
  isGoblinsLocation, goRouteToGoblins, openGoblinFight, ensureGoblinFightScreen, goRouteToBlake,
  openBlakeFight, isBlakeLocation, ensureBlakeFightScreen, shouldFightFarmByStats, isFarmLocation,
  ensureFarmFightScreen,
};

const { FARM_TARGET } = require('./state');
const { getBodyText, pause } = require('./core');
const { tryPerformStepOptional } = require('./hp');
const { shouldFightBlakeByStats, shouldFightByStats } = require('./stats_decisions');
const { clickByTexts, existsAnyText, performStep } = require('./ui');

function isGoblinsLocation(text) {
  return /Осмотреть шахты/i.test(String(text || '')) || /Горы Дарии/i.test(String(text || ''));
}

async function goRouteToGoblins(page) {
  const HORSE = '\u041a\u043e\u043d\u044c';
  const DARIA = '\u0413\u043e\u0440\u044b \u0414\u0430\u0440\u0438\u0438';
  const V_PUTI = '\u0412 \u043f\u0443\u0442\u0438';
  const V_PUTI_ESHE = '\u0412 \u043f\u0443\u0442\u0438 \u0435\u0449\u0435';
  const V_PUTI_ESHYO = '\u0412 \u043f\u0443\u0442\u0438 \u0435\u0449\u0451';
  const NORTH = '\u0418\u0434\u0442\u0438 \u043d\u0430 \u0441\u0435\u0432\u0435\u0440';
  const MINES = '\u041e\u0441\u043c\u043e\u0442\u0440\u0435\u0442\u044c \u0448\u0430\u0445\u0442\u044b';
  const UDAR = '\u0423\u0434\u0430\u0440\u0438\u0442\u044c';
  const DONE = '\u0411\u043e\u0439 \u0437\u0430\u0432\u0435\u0440\u0448\u0435\u043d!';

  await performStep(page, {
    stepName: HORSE,
    currentTexts: [HORSE, HORSE.toLowerCase()],
    nextTexts: [DARIA, DARIA.toLowerCase()],
    retries: 3,
  });

  await performStep(page, {
    stepName: DARIA,
    currentTexts: [DARIA, DARIA.toLowerCase()],
    waitAfterClickMs: 7000,
    nextTexts: [
      V_PUTI,
      V_PUTI.toLowerCase(),
      V_PUTI_ESHE,
      V_PUTI_ESHE.toLowerCase(),
      V_PUTI_ESHYO,
      V_PUTI_ESHYO.toLowerCase(),
      NORTH,
      NORTH.toLowerCase(),
      MINES,
      MINES.toLowerCase(),
      UDAR,
      UDAR.toLowerCase(),
      DONE,
    ],
    retries: 3,
  });

  await tryPerformStepOptional(page, {
    stepName: V_PUTI,
    currentTexts: [
      V_PUTI_ESHE,
      V_PUTI_ESHE.toLowerCase(),
      V_PUTI_ESHYO,
      V_PUTI_ESHYO.toLowerCase(),
      V_PUTI,
      V_PUTI.toLowerCase(),
    ],
    nextTexts: [NORTH, NORTH.toLowerCase(), MINES, MINES.toLowerCase(), UDAR, UDAR.toLowerCase(), DONE],
  });

  await tryPerformStepOptional(page, {
    stepName: NORTH,
    currentTexts: [NORTH, NORTH.toLowerCase()],
    nextTexts: [MINES, MINES.toLowerCase(), UDAR, UDAR.toLowerCase(), DONE],
  });

  await pause(page, 800, 1600);
}

async function openGoblinFight(page) {
  const MINES = '\u041e\u0441\u043c\u043e\u0442\u0440\u0435\u0442\u044c \u0448\u0430\u0445\u0442\u044b';
  const V_BOY = '\u0412 \u0431\u043e\u0439!';
  const UDAR = '\u0423\u0434\u0430\u0440\u0438\u0442\u044c';
  const DONE = '\u0411\u043e\u0439 \u0437\u0430\u0432\u0435\u0440\u0448\u0435\u043d!';

  const text = await getBodyText(page);
  if (!new RegExp(UDAR, 'i').test(text) && !new RegExp(DONE, 'i').test(text)) {
    await tryPerformStepOptional(page, {
      stepName: MINES,
      currentTexts: [MINES, MINES.toLowerCase()],
      nextTexts: [V_BOY, V_BOY.toLowerCase(), '\u0412 \u0431\u043e\u0439', '\u0432 \u0431\u043e\u0439', UDAR, UDAR.toLowerCase(), DONE],
    });
  }

  const textAfterMines = await getBodyText(page);
  if ((/\u0412 \u0431\u043e\u0439!/i.test(textAfterMines) || /\u0412 \u0431\u043e\u0439\\b/i.test(textAfterMines)) && !new RegExp(UDAR, 'i').test(textAfterMines)) {
    await performStep(page, {
      stepName: V_BOY,
      currentTexts: [
        V_BOY,
        V_BOY.toLowerCase(),
        '\u0412 \u0431\u043e\u0439',
        '\u0432 \u0431\u043e\u0439',
        '\u0412\u0441\u0442\u0443\u043f\u0438\u0442\u044c \u0432 \u0431\u043e\u0439',
        '\u0432\u0441\u0442\u0443\u043f\u0438\u0442\u044c \u0432 \u0431\u043e\u0439',
        '\u041f\u0440\u0438\u043d\u044f\u0442\u044c \u0431\u043e\u0439',
        '\u043f\u0440\u0438\u043d\u044f\u0442\u044c \u0431\u043e\u0439',
      ],
      nextTexts: [UDAR, UDAR.toLowerCase(), DONE],
      retries: 4,
    });
  }

  await pause(page, 1000, 2000);
}

async function ensureGoblinFightScreen(page) {
  const UDAR_RE = /\u0423\u0434\u0430\u0440\u0438\u0442\u044c/i;
  const DONE_RE = /\u0411\u043e\u0439\u0020\u0437\u0430\u0432\u0435\u0440\u0448\u0435\u043d!/i;
  const AMULET = '\u0410\u043c\u0443\u043b\u0435\u0442';
  const LAST_PORTAL = '\u041f\u043e\u0441\u043b\u0435\u0434\u043d\u0438\u0439 \u043f\u043e\u0440\u0442\u0430\u043b';

  const text = await getBodyText(page);
  if (UDAR_RE.test(text) || DONE_RE.test(text)) return;

  // If we accidentally landed on a fastway page (e.g. after clicking "Амулет"),
  // return back to the previous location before trying to click "Конь".
  if (/mod=fastway/i.test(page.url()) || /Последний портал/i.test(text)) {
    if (await clickByTexts(page, ['Вернуться', 'вернуться'], 'Вернуться')) {
      await pause(page, 800, 1600);
    }
  }

  if (isGoblinsLocation(text)) {
    await openGoblinFight(page);
    return;
  }

  // Preferred: Амулет -> Последний портал
  const amuletOk = await clickByTexts(page, [AMULET, AMULET.toLowerCase()], AMULET);
  if (amuletOk) {
    await pause(page, 800, 2000);
    const portalOk = await clickByTexts(page, [LAST_PORTAL, LAST_PORTAL.toLowerCase()], LAST_PORTAL);
    if (portalOk) {
      await pause(page, 800, 2000);
      const afterPortalText = await getBodyText(page);
      if (isGoblinsLocation(afterPortalText)) {
        await openGoblinFight(page);
        return;
      }
      console.log('Goblin last portal did not reach mines -> routing manually.');
    } else {
      await clickByTexts(page, ['Вернуться', 'вернуться'], 'Вернуться');
      await pause(page, 800, 1600);
    }
  }

  // Fallback: manual route.
  await page.goto('http://lbast.ru/location.php', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await pause(page, 1000, 2000);
  await goRouteToGoblins(page);
  await openGoblinFight(page);
}

// Blake farming route (ported from bleyk.js): Амулет -> Девтаун -> На восток, в ремесленный
// район -> Идти на восток -> портовый район -> Пристань -> лодка на остров Блейка -> Идти на
// север -> Зайти в хижину -> бой. The first leg is identical to the Fish Eye route.
async function goRouteToBlake(page) {
  console.log('Иду по маршруту к Блейку');

  const AMULET    = 'Амулет';
  const DEVTOWN   = 'Девтаун';
  const EAST_CRAFT = 'На восток, в ремесленный район';
  const GO_EAST   = 'Идти на восток';
  const PORT      = 'портовый район';
  const PIER      = 'Пристань';
  const BOAT      = 'Взять лодку до острова Блейка за 10 дин';
  const NEXT      = 'Далее';
  const NORTH     = 'Идти на север';
  const HUT       = 'Зайти в хижину';

  const amuletOk = await clickByTexts(page, [AMULET, AMULET.toLowerCase()], AMULET);
  if (amuletOk) await pause(page, 800, 1600);

  await performStep(page, {
    stepName: DEVTOWN,
    currentTexts: [DEVTOWN, DEVTOWN.toLowerCase()],
    nextTexts: [EAST_CRAFT, EAST_CRAFT.toLowerCase()],
    retries: 3,
  });

  await performStep(page, {
    stepName: EAST_CRAFT,
    currentTexts: [EAST_CRAFT, EAST_CRAFT.toLowerCase()],
    nextTexts: [GO_EAST, GO_EAST.toLowerCase()],
    retries: 3,
  });

  await performStep(page, {
    stepName: GO_EAST,
    currentTexts: [GO_EAST, GO_EAST.toLowerCase()],
    nextTexts: [PORT, PORT.toLowerCase(), PIER, PIER.toLowerCase()],
    retries: 4,
  });

  if (await existsAnyText(page, [PIER, PIER.toLowerCase()])) {
    console.log('После "Идти на восток" уже видна Пристань, шаг "портовый район" пропускаю');
  } else {
    await performStep(page, {
      stepName: PORT,
      currentTexts: [PORT, PORT.toLowerCase()],
      nextTexts: [PIER, PIER.toLowerCase()],
      retries: 4,
    });
  }

  await performStep(page, {
    stepName: PIER,
    currentTexts: [PIER, PIER.toLowerCase()],
    nextTexts: [BOAT, BOAT.toLowerCase()],
    retries: 4,
  });

  await performStep(page, {
    stepName: BOAT,
    currentTexts: [BOAT, BOAT.toLowerCase()],
    waitAfterClickMs: 7000,
    nextTexts: [NEXT, NEXT.toLowerCase(), NORTH, NORTH.toLowerCase()],
    retries: 3,
  });

  if (await existsAnyText(page, [NORTH, NORTH.toLowerCase()])) {
    console.log('После лодки уже доступен шаг "Идти на север", шаг "Далее" пропускаю');
  } else {
    await performStep(page, {
      stepName: NEXT,
      currentTexts: [NEXT, NEXT.toLowerCase()],
      nextTexts: [NORTH, NORTH.toLowerCase()],
      retries: 3,
    });
  }

  await performStep(page, {
    stepName: NORTH,
    currentTexts: [NORTH, NORTH.toLowerCase()],
    nextTexts: [HUT, HUT.toLowerCase()],
    retries: 3,
  });

  await performStep(page, {
    stepName: HUT,
    currentTexts: [HUT, HUT.toLowerCase()],
    nextTexts: ['Ударить', 'ударить', 'В бой', 'в бой', 'Бой завершен!'],
    retries: 3,
  });
}

async function openBlakeFight(page) {
  console.log('Открываю бой на Блейке');

  const HUT = 'Зайти в хижину';
  const UDAR_RE = /Ударить/i;
  const DONE_RE = /Бой завершен!/i;

  const text = await getBodyText(page);

  if (UDAR_RE.test(text) || DONE_RE.test(text)) {
    console.log('Экран боя уже открыт');
    return;
  }

  if (new RegExp(HUT, 'i').test(text)) {
    await performStep(page, {
      stepName: HUT,
      currentTexts: [HUT, HUT.toLowerCase()],
      nextTexts: ['В бой', 'в бой', 'Ударить', 'ударить', 'Бой завершен!'],
      retries: 3,
    });
    await pause(page, 800, 1600);
  }

  const refreshedText = await getBodyText(page);
  if (/В\s*бой/i.test(refreshedText) && !UDAR_RE.test(refreshedText)) {
    await performStep(page, {
      stepName: 'В бой',
      currentTexts: ['В бой', 'в бой'],
      nextTexts: ['Ударить', 'ударить', 'Бой завершен!'],
      retries: 3,
    });
    await pause(page, 1000, 2000);
  }
}

function isBlakeLocation(text) {
  return /Зайти в хижину/i.test(String(text || ''));
}

async function ensureBlakeFightScreen(page) {
  const UDAR_RE = /Ударить/i;
  const DONE_RE = /Бой завершен!/i;

  const text = await getBodyText(page);
  if (UDAR_RE.test(text) || DONE_RE.test(text)) return;

  if (isBlakeLocation(text) || /В\s*бой/i.test(text)) {
    await openBlakeFight(page);
    return;
  }

  await goRouteToBlake(page);
  await openBlakeFight(page);
}

// Farm-target-aware wrappers: pick Blake or goblins depending on FARM_TARGET so doScenario's
// farm loop stays generic. Goblins reach their spot via the same Амулет -> Последний портал
// shortcut, so the "stay put and resume next cycle" behaviour works for both.
function shouldFightFarmByStats(stats) {
  return FARM_TARGET === 'goblins' ? shouldFightByStats(stats) : shouldFightBlakeByStats(stats);
}

function isFarmLocation(text) {
  return FARM_TARGET === 'goblins' ? isGoblinsLocation(text) : isBlakeLocation(text);
}

async function ensureFarmFightScreen(page) {
  return FARM_TARGET === 'goblins' ? ensureGoblinFightScreen(page) : ensureBlakeFightScreen(page);
}
