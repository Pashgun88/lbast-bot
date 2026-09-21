// Полив винограда и Статуя Славы.
// Выделено из ai_char/module.js (там только сборка экспорта). Изменяемое состояние - S из ./state.

// Экспорт стоит ДО require: файлы lib/ вызывают друг друга по кругу, а объявления функций
// всплывают (hoisting), поэтому к моменту любого встречного require все функции уже здесь.
module.exports = {
  runVinogradTask, isStatueOfGloryDue, scheduleNextStatueOfGlory, runStatueOfGloryTask,
  runStatueOfGloryIfDue,
};

const {
  S, persistDailyQuestState, STATUE_MAX_INTERVAL_MINUTES, STATUE_MIN_INTERVAL_MINUTES,
} = require('./state');
const { getBodyText, randomInt } = require('./core');
const { tryPerformStepOptional } = require('./hp');
const { clickByTexts, clickByTextsForced, performStep } = require('./ui');

async function runVinogradTask(page) {
  console.log('Виноград: начинаю маршрут Конь -> Эльтауэр -> В пути -> В город (север) -> Виноградники -> Полить виноград -> В игру');

  const HORSE    = 'Конь';
  const ELTAUER  = 'Эльтауэр';
  const V_PUTI   = 'В пути';
  const V_PUTI_E = 'В пути еще';
  const V_PUTI_Y = 'В пути ещё';
  const NORTH    = 'В город (север)';
  const VINO     = 'Виноградники';
  const WATER    = 'Полить виноград';
  const V_IGRU   = 'В игру';

  await performStep(page, {
    stepName: HORSE,
    currentTexts: [HORSE, HORSE.toLowerCase()],
    nextTexts: [ELTAUER, ELTAUER.toLowerCase()],
    retries: 3,
  });

  // После выбора Эльтауэра нужно 7 сек — затем появляется "В пути" или сразу "В пути еще"
  await performStep(page, {
    stepName: ELTAUER,
    currentTexts: [ELTAUER, ELTAUER.toLowerCase()],
    waitAfterClickMs: 7000,
    nextTexts: [
      V_PUTI, V_PUTI.toLowerCase(),
      V_PUTI_E, V_PUTI_E.toLowerCase(),
      V_PUTI_Y, V_PUTI_Y.toLowerCase(),
      NORTH, NORTH.toLowerCase(),
    ],
    retries: 3,
  });

  // Кликаем "В пути" (подтверждение) и ждём до 30 сек пока появится "В город (север)"
  await tryPerformStepOptional(page, {
    stepName: V_PUTI,
    currentTexts: [
      V_PUTI_E, V_PUTI_E.toLowerCase(),
      V_PUTI_Y, V_PUTI_Y.toLowerCase(),
      V_PUTI, V_PUTI.toLowerCase(),
    ],
    nextTexts: [NORTH, NORTH.toLowerCase()],
    waitForNextMs: 30000,
  });

  await performStep(page, {
    stepName: NORTH,
    currentTexts: [NORTH, NORTH.toLowerCase(), 'в город север', 'В город север'],
    nextTexts: [VINO, VINO.toLowerCase()],
    retries: 3,
  });

  // Sometimes "В город (север)" already lands directly on the vineyard page
  // (recognizable by "Посадить семя винограда"/"Сделать вино"), so the "Виноградники"
  // link isn't there to click — skip straight to checking for the water option.
  const preVinoText = await getBodyText(page);
  const alreadyOnVineyardPage =
    /Посадить семя винограда/i.test(preVinoText) || /Сделать вино/i.test(preVinoText);

  if (!alreadyOnVineyardPage) {
    // "Посадить семя винограда"/"Сделать вино" are always on the vineyard page, watering or
    // not — treat arriving there as success even if "Полить виноград" itself isn't offered.
    await performStep(page, {
      stepName: VINO,
      currentTexts: [VINO, VINO.toLowerCase()],
      nextTexts: [
        WATER, WATER.toLowerCase(),
        'Посадить семя винограда', 'посадить семя винограда',
        'Сделать вино', 'сделать вино',
      ],
      retries: 3,
    });
  }

  // Watering can be unavailable (e.g. "Сделать вино (квестзапрет 6ч)" shown instead) —
  // that's a normal state, not an error. Just bail out; VINOGRAD_INTERVAL_MS handles retiming.
  const vineyardText = await getBodyText(page);
  if (!/Полить виноград/i.test(vineyardText)) {
    console.log('Виноград: полить сейчас нельзя (не готово/квестзапрет) — это нормально, следующая попытка через 8 часов');
    await clickByTexts(page, [V_IGRU, V_IGRU.toLowerCase()], V_IGRU).catch(() => {});
    return;
  }

  await performStep(page, {
    stepName: WATER,
    currentTexts: [WATER, WATER.toLowerCase()],
    nextTexts: [V_IGRU, V_IGRU.toLowerCase()],
    retries: 3,
    skipIfNextVisible: false,
  });

  await performStep(page, {
    stepName: V_IGRU,
    currentTexts: [V_IGRU, V_IGRU.toLowerCase()],
    nextTexts: [],
    retries: 3,
  });
}

function isStatueOfGloryDue() {
  if (!S.lastStatueRunAt || !S.nextStatueDueAt) {
    return true;
  }
  return Date.now() >= S.nextStatueDueAt;
}

function scheduleNextStatueOfGlory() {
  S.lastStatueRunAt = Date.now();
  const minutes = randomInt(STATUE_MIN_INTERVAL_MINUTES, STATUE_MAX_INTERVAL_MINUTES);
  S.nextStatueDueAt = S.lastStatueRunAt + minutes * 60 * 1000;
  persistDailyQuestState();
}

async function runStatueOfGloryTask(page) {
  console.log('Статуя славы: начинаю маршрут Конь -> Клановый замок -> Идти к замку -> Статуя славы -> В игру');

  const HORSE       = 'Конь';
  const CLAN_CASTLE = 'Клановый замок';
  const V_PUTI      = 'В пути';
  const V_PUTI_E    = 'В пути еще';
  const V_PUTI_Y    = 'В пути ещё';
  const TO_CASTLE   = 'Идти к замку';
  // На странице замка кнопка называется "Статуя Cлавы", где "C" — ЛАТИНСКАЯ буква (U+0043), а
  // не кириллическая "С", плюс вторая буква заглавная. Поэтому ищем по первому слову "Статуя"
  // (чистая кириллица, однозначное) — оно уникально на странице замка и матчится как подстрока.
  const STATUE      = 'Статуя';
  // Confirmed real success message — "В игру" is always in the top nav (present even before the
  // click), so it can't be used to tell whether the click actually worked.
  const STATUE_DONE = 'Мощь статуи будет поддерживать вас в бою';
  const V_IGRU      = 'В игру';

  await performStep(page, {
    stepName: HORSE,
    currentTexts: [HORSE, HORSE.toLowerCase()],
    nextTexts: [CLAN_CASTLE, CLAN_CASTLE.toLowerCase()],
    retries: 3,
  });

  // После выбора клановый замок нужно 7 сек — затем появляется экран поездки
  // ("В пути"/"В пути еще"), и только после подтверждения — "Идти к замку".
  await performStep(page, {
    stepName: CLAN_CASTLE,
    currentTexts: [CLAN_CASTLE, CLAN_CASTLE.toLowerCase()],
    waitAfterClickMs: 7000,
    nextTexts: [
      V_PUTI, V_PUTI.toLowerCase(),
      V_PUTI_E, V_PUTI_E.toLowerCase(),
      V_PUTI_Y, V_PUTI_Y.toLowerCase(),
      TO_CASTLE, TO_CASTLE.toLowerCase(),
    ],
    retries: 3,
  });

  // Кликаем "В пути" (подтверждение) и ждём до 30 сек пока появится "Идти к замку".
  await tryPerformStepOptional(page, {
    stepName: V_PUTI,
    currentTexts: [
      V_PUTI_E, V_PUTI_E.toLowerCase(),
      V_PUTI_Y, V_PUTI_Y.toLowerCase(),
      V_PUTI, V_PUTI.toLowerCase(),
    ],
    nextTexts: [TO_CASTLE, TO_CASTLE.toLowerCase()],
    waitForNextMs: 30000,
  });

  await performStep(page, {
    stepName: TO_CASTLE,
    currentTexts: [TO_CASTLE, TO_CASTLE.toLowerCase()],
    nextTexts: [STATUE, STATUE.toLowerCase()],
    retries: 3,
  });

  await performStep(page, {
    stepName: STATUE,
    currentTexts: [STATUE, STATUE.toLowerCase()],
    nextTexts: [STATUE_DONE, STATUE_DONE.toLowerCase()],
    retries: 3,
    skipIfNextVisible: false,
    // The button isn't a plain a/button/input element, and clickByTextsLoose's "must be the only
    // match" safety check was still refusing to click it — force through as a last resort.
    clickFn: clickByTextsForced,
  });

  await performStep(page, {
    stepName: V_IGRU,
    currentTexts: [V_IGRU, V_IGRU.toLowerCase()],
    nextTexts: [],
    retries: 3,
  });
}

// 16.09.2026, Паша: "у Цунами есть как использовать статую... раз в 12 часов". Логика
// runStatueOfGloryTask/isStatueOfGloryDue/scheduleNextStatueOfGlory уже существовала в этом
// файле (видимо, портирована раньше вместе с остальным кодом Цунами), но жила только внутри
// doScenario() - функции, которую driver.js для AI__ НИКОГДА не вызывает (у него свой
// собственный цикл шагов). Получается, статуя не работала для AI__ ни разу, пока не вступили
// в клан и её вообще не заметили. Обёртка ниже - тонкий адаптер для прямого вызова из
// driver.js, без изменения самой логики маршрута/интервала.
async function runStatueOfGloryIfDue(page) {
  if (!isStatueOfGloryDue()) {
    return false;
  }
  console.log('Статуя славы: подошёл интервал 12-14 часов, выполняю маршрут');
  try {
    await runStatueOfGloryTask(page);
  } catch (e) {
    console.log(`Статуя славы: не удалось (${e.message}) -> пропускаю, продолжаю цикл`);
    await page.goto('http://lbast.ru/location.php', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  }
  scheduleNextStatueOfGlory();
  return true;
}
