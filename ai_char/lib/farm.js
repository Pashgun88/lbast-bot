// Фарм: подвалы, гарпия, бизон, кабан.
// Выделено из ai_char/module.js (там только сборка экспорта). Изменяемое состояние - S из ./state.

// Экспорт стоит ДО require: файлы lib/ вызывают друг друга по кругу, а объявления функций
// всплывают (hoisting), поэтому к моменту любого встречного require все функции уже здесь.
module.exports = {
  enterPodvaly, runPodvalyFarmRound, isHarpyLocation, goRouteToHarpy, openHarpyFight,
  runHarpyFarmRound, isBisonLocation, goRouteToBison, openBisonFight, runBisonFarmRound,
  isBoarLocation, goRouteToBoar, openBoarFight, runBoarFarmRound,
};

const {
  S, DEMON_LAKE_FASTWAY_URL, getWeekday, HARPY_HUNT_WEEKDAY, HARPY_HUNTS_PER_DAY,
  HP_FLOOR_WITH_BUFF, parseCooldownError, persistDailyQuestState, resetHuntStateIfNewDay,
} = require('./state');
const { waitOutHorseTravel } = require('./assassins');
const { getBodyText, parseStats, pause } = require('./core');
const { fightLoop } = require('./fight');
const { tryPerformStepOptional } = require('./hp');
const { clickByTexts, existsAnyText, performStep } = require('./ui');

// ===================================================================================
// "Подвалы" (Южные ворота Стоунгарда) — альтернативная фарм-точка для AI__ (крысы/слизняки),
// найдена и задокументирована 14.09.2026 в LESSONS_AI_CHAR.md. В отличие от Fish Eye/гильдии
// это НЕ уникальный игровой механизм, а обычный repeat-farm объект — используется просто как
// "чем заняться, когда с квестами/Fish Eye на этот цикл всё сделано".
// ===================================================================================
// 15.09.2026, Паша: "не нравится что при не сделаных квестах АИ бежит фармить подвалы" —
// живой случай: вошли в Подвалы на HP>=50%, один бой (даже с сработавшим эликсиром) снёс
// HP до 34/340 (10%) - после этого ассасин(70%)/Рыбный ресторан/Рыбий глаз(50%) блокировались
// много циклов подряд, пока HP медленно (16/мин) восстанавливалось - выглядело как "бот
// бросил квесты и фармит", хотя на самом деле сам фарм и съел HP, нужный квестам. Подняли
// порог до 0.7 (тот же вывод, что и для банкира/Рыбьего глаза) и срезали число боёв за
// раунд до 1, чтобы Подвалы не могли утащить HP ниже уровня, нужного реальным квестам.
const PODVALY_HP_SAFETY_FRACTION = 0.7; // не начинать новый бой ниже этой доли от макс. HP
const PODVALY_MAX_FIGHTS_PER_ROUND = 1; // не более N боёв за один вызов из driver.js
// "Штольни" требуют SHTOLNI_MIN_HP_FRACTION=0.99 - если Подвалы фармят всё, что выше 70%,
// они постоянно сбивают HP обратно вниз и не дают дойти до 99%, из-за чего Штольни для
// AI__ фактически никогда не запускались. Верхний потолок резервирует "почти полное" HP
// именно для таких требовательных квестов вместо того, чтобы тратить его на обычный фарм.
const PODVALY_HP_CEILING_FRACTION = 0.9; // не фармить выше этой доли - беречь HP для Штолен

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
    console.log('Podvaly farm: "В подвалы" не найдено на этой клетке.');
    return false;
  }

  await clickByTexts(page, ['В подвалы'], 'В подвалы');
  await pause(page, 800, 1400);
  return true;
}

async function runPodvalyFarmRound(page) {
  // A prior dispatcher (Demon Lake, Shipwreck, ...) may have left us on location.php?mod=quests,
  // whose header doesn't render the "Name (HP/HPMax)" tuple parseStats expects — reading stats
  // straight off whatever page we inherited silently returns null/null and skips farming for the
  // whole cycle. Found 14.09.2026 after AI__ stood idle for over an hour with full HP available.
  await page.goto('http://lbast.ru/location.php', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  const stats0 = parseStats(await getBodyText(page));
  if (
    typeof stats0.hpCurrent !== 'number' ||
    typeof stats0.hpMax !== 'number' ||
    stats0.hpCurrent <= 0 ||
    stats0.hpCurrent < stats0.hpMax * PODVALY_HP_SAFETY_FRACTION
  ) {
    return false;
  }
  if (stats0.hpCurrent >= stats0.hpMax * PODVALY_HP_CEILING_FRACTION) {
    console.log(`Podvaly farm: HP ${stats0.hpCurrent}/${stats0.hpMax} уже близко к максимуму - берегу для Штолен, не фармлю.`);
    return false;
  }

  const entered = await enterPodvaly(page);
  if (!entered) return false;

  let didAnything = false;
  for (let i = 0; i < PODVALY_MAX_FIGHTS_PER_ROUND; i++) {
    const stats = parseStats(await getBodyText(page));
    if (typeof stats.hpCurrent !== 'number' || typeof stats.hpMax !== 'number') break;
    if (stats.hpCurrent <= 0) break;
    if (stats.hpCurrent < stats.hpMax * PODVALY_HP_SAFETY_FRACTION) break;

    const okOsmotret = await clickByTexts(page, ['Осмотреть подвалы'], 'Осмотреть подвалы');
    if (!okOsmotret) break;
    await pause(page, 700, 1200);

    const okAttack = await clickByTexts(page, ['Атаковать'], 'Атаковать');
    if (!okAttack) {
      await pause(page, 800, 1400);
      continue;
    }

    const won = await fightLoop(page).catch((e) => {
      console.log('Podvaly farm: fightLoop error:', e.message);
      return null;
    });
    console.log('Podvaly farm: fightLoop result:', won);
    didAnything = true;
    await pause(page, 800, 1400);
  }

  return didAnything;
}

// ===================================================================================
// Гарпия — новая фарм-точка вместо Подвалов (15.09.2026, Паша: "меняем точку фарма, вместо
// подвала - гарпия"). Маршрут продиктован Пашей: Конь -> Горы Дарии -> Запад -> Гнёзда гарпии.
// "Горы Дарии" - тот же перекрёсток, что и в goRouteToGoblins выше, только оттуда нужно на
// запад, а не на север. Бой ни разу не проверен вживую -> держим консервативный floor (как
// у Подвалов), пока не увидим реальный урон. НЕТ ceiling-гейта: тот был нужен только чтобы
// беречь HP для Штолен, а Штольни отложены (SHTOLNI_ENABLED_FOR_AI=false, см. Пашу
// 15.09.2026 "штольни мы отложили на потом, их пока не делаем") - резервировать HP для
// квеста, который не запускается, только мешает нормально фармить. Если Штольни когда-то
// включат обратно, вернуть ceiling здесь тогда же.
// ===================================================================================
// Снижено 0.7->0.55 (15.09.2026, прямая просьба Паши после замера урона ниже). Риск
// осознан и явно проговорён: при входе на 55% (187/340) и повторении уже виденного удара
// в 172 останется ~15 HP (4%) - почти без запаса. Решение всё равно принято сознательно,
// не менять обратно без явной новой просьбы.
const HARPY_HP_SAFETY_FRACTION = 0.55;
// Замерено вживую 15.09.2026 (Паша просил прикинуть "оптимальный отдых"): 2 боя подряд
// дали урон 12 и 172 (!) - разброс огромный, 172 - это больше половины макс. HP (340) за
// ОДИН бой, при входе на честных 70%. Фиксированного "оптимального числа боёв подряд" не
// существует - урон гарпии слишком нестабилен (тот же паттерн бёрст-урона, что уже ломал
// 50%- и 70%-гейты у Fish Eye/ассасинов, см. память). Единственная реальная защита -
// floor (сейчас 0.55) проверяется ПЕРЕД каждым боем, а не только один раз на весь раунд.
// Число боёв в день теперь берётся из HARPY_HUNTS_PER_DAY (см. выше в файле, порт с
// Цунами commit fb9dea7, 16.09.2026) вместо фиксированного числа за раунд.

function isHarpyLocation(text) {
  // Real location name is "Кровавый пик" (confirmed live 15.09.2026), which has a
  // "Гнезда гарпий" link - NOT "Гнёзда гарпии"/"Гнезда гарпии" as first guessed from
  // Pasha's spoken route, which caused the first live attempt to fail with
  // fight_not_reached (route walked fine up to here, then found no matching link/fight).
  return /Кровавый пик/i.test(String(text || '')) || /Гнезда гарпий/i.test(String(text || ''));
}

async function goRouteToHarpy(page) {
  const HORSE = 'Конь';
  const DARIA = 'Горы Дарии';
  const V_PUTI = 'В пути';
  const V_PUTI_ESHE = 'В пути еще';
  const V_PUTI_ESHYO = 'В пути ещё';
  const WEST = 'Идти на запад';
  const NESTS = 'Гнезда гарпий';
  const UDAR = 'Ударить';
  const DONE = 'Бой завершен!';

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
      V_PUTI, V_PUTI.toLowerCase(),
      V_PUTI_ESHE, V_PUTI_ESHE.toLowerCase(),
      V_PUTI_ESHYO, V_PUTI_ESHYO.toLowerCase(),
      WEST, WEST.toLowerCase(),
      NESTS, NESTS.toLowerCase(),
      UDAR, UDAR.toLowerCase(),
      DONE,
    ],
    retries: 3,
  });

  await tryPerformStepOptional(page, {
    stepName: V_PUTI,
    currentTexts: [
      V_PUTI_ESHE, V_PUTI_ESHE.toLowerCase(),
      V_PUTI_ESHYO, V_PUTI_ESHYO.toLowerCase(),
      V_PUTI, V_PUTI.toLowerCase(),
    ],
    nextTexts: [WEST, WEST.toLowerCase(), NESTS, NESTS.toLowerCase(), UDAR, UDAR.toLowerCase(), DONE],
  });

  await tryPerformStepOptional(page, {
    stepName: WEST,
    currentTexts: [WEST, WEST.toLowerCase()],
    nextTexts: [NESTS, NESTS.toLowerCase(), UDAR, UDAR.toLowerCase(), DONE],
  });

  await pause(page, 800, 1600);
}

async function openHarpyFight(page) {
  const NESTS = 'Гнезда гарпий';
  const V_BOY = 'В бой!';
  const UDAR = 'Ударить';
  const DONE = 'Бой завершен!';

  const text = await getBodyText(page);
  if (!new RegExp(UDAR, 'i').test(text) && !new RegExp(DONE, 'i').test(text)) {
    await tryPerformStepOptional(page, {
      stepName: NESTS,
      currentTexts: [NESTS, NESTS.toLowerCase()],
      nextTexts: [V_BOY, V_BOY.toLowerCase(), 'В бой', 'в бой', UDAR, UDAR.toLowerCase(), DONE],
    });
  }

  const textAfter = await getBodyText(page);
  if ((/В бой!/i.test(textAfter) || /В бой\b/i.test(textAfter)) && !new RegExp(UDAR, 'i').test(textAfter)) {
    await performStep(page, {
      stepName: V_BOY,
      currentTexts: [
        V_BOY, V_BOY.toLowerCase(),
        'В бой', 'в бой',
        'Вступить в бой', 'вступить в бой',
        'Принять бой', 'принять бой',
      ],
      nextTexts: [UDAR, UDAR.toLowerCase(), DONE],
      retries: 4,
    });
  }

  await pause(page, 1000, 2000);
}

async function runHarpyFarmRound(page, buffed = false) {
  if (getWeekday() !== HARPY_HUNT_WEEKDAY) {
    return false; // сегодня не вторник - гарпии не дейлик, а не "уже сделано"
  }
  resetHuntStateIfNewDay();
  if (S.harpyHuntFightsToday >= HARPY_HUNTS_PER_DAY) {
    return false;
  }

  const floor = buffed ? HP_FLOOR_WITH_BUFF : HARPY_HP_SAFETY_FRACTION;

  await page.goto('http://lbast.ru/location.php', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  const stats0 = parseStats(await getBodyText(page));
  if (
    typeof stats0.hpCurrent !== 'number' ||
    typeof stats0.hpMax !== 'number' ||
    stats0.hpCurrent <= 0 ||
    stats0.hpCurrent < stats0.hpMax * floor
  ) {
    return false;
  }
  const text0 = await getBodyText(page);
  if (!isHarpyLocation(text0)) {
    await goRouteToHarpy(page).catch((e) => {
      console.log('Harpy farm: маршрут не пройден:', e.message);
    });
  }

  let didAnything = false;
  for (let i = S.harpyHuntFightsToday; i < HARPY_HUNTS_PER_DAY; i++) {
    const stats = parseStats(await getBodyText(page));
    if (typeof stats.hpCurrent !== 'number' || typeof stats.hpMax !== 'number') break;
    if (stats.hpCurrent <= 0) break;
    if (stats.hpCurrent < stats.hpMax * floor) break;

    const hpBefore = stats.hpCurrent;
    await openHarpyFight(page).catch((e) => {
      console.log('Harpy farm: не удалось начать бой:', e.message);
    });

    let won;
    try {
      won = await fightLoop(page);
    } catch (e) {
      const waitMinutes = parseCooldownError(e);
      if (waitMinutes !== null) {
        console.log(`Harpy farm: гарпии ещё на кулдауне (${waitMinutes} мин, сделано ${i}/${HARPY_HUNTS_PER_DAY}) -> отложу оставшиеся бои до следующего цикла`);
        S.harpyHuntFightsToday = i;
        persistDailyQuestState();
        return didAnything;
      }
      console.log('Harpy farm: fightLoop error:', e.message);
      won = null;
    }

    const statsAfter = parseStats(await getBodyText(page));
    const hpAfter = typeof statsAfter.hpCurrent === 'number' ? statsAfter.hpCurrent : null;
    const delta = hpAfter !== null ? hpBefore - hpAfter : null;
    console.log(`Harpy farm: fight #${i + 1}/${HARPY_HUNTS_PER_DAY} result=${won} HP ${hpBefore}->${hpAfter} (урон за бой: ${delta})`);
    didAnything = true;
    S.harpyHuntFightsToday = i + 1;
    persistDailyQuestState();
    await pause(page, 800, 1400);
  }

  return didAnything;
}

// ===================================================================================
// Бизон — новая фарм-точка вместо Гарпии (15.09.2026, Паша: "меняем точку фарма на
// бизона", маршрут: Амулет -> Дорожный крест -> Восток -> Восток -> Охотиться). Реальный
// текст проверен read-only диагностикой (тот же урок, что и с Гарпией - не доверять
// пересказу дословно без проверки): "Дорожный крест" -> "Идти на восток" -> "Дорога" ->
// "Идти на восток" -> "Поле" (описание про диких бизонов) -> "Охотиться". Клик "Амулет"
// не используется намеренно (известный баг с латинской "A", см. LESSONS/память) - вместо
// этого прямой fastway URL lway=9 (тот же, что уже был у Demon Lake - DEMON_LAKE_FASTWAY_URL).
// Урон бизона НЕ известен вообще (0 замеров) -> начинаем с консервативного floor 0.7, как
// начинали с Гарпией, пока не наберётся статистика.
// ===================================================================================
const BISON_HP_SAFETY_FRACTION = 0.7;
// Число боёв в день берётся из BISON_HUNTS_PER_DAY (см. выше в файле, порт с Цунами
// commit fb9dea7, 16.09.2026) вместо фиксированного числа за раунд.

function isBisonLocation(text) {
  return /Поле/i.test(String(text || '')) && /бизон/i.test(String(text || ''));
}

async function goRouteToBison(page) {
  await page.goto(DEMON_LAKE_FASTWAY_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await pause(page, 500, 900);

  // skipIfNextVisible:false обязателен здесь: и текущий, и следующий шаг называются
  // одинаково ("Идти на восток"), а этот текст уже виден на "Дорожный крест" ДО клика -
  // с дефолтным skipIfNextVisible=true шаг ложно считал себя уже пройденным и не кликал
  // вообще, оставляя маршрут на один хоп короче ("Дорога" вместо "Поле", fight_not_reached
  // при попытке "Охотиться"). Обнаружено вживую 16.09.2026.
  await performStep(page, {
    stepName: 'Идти на восток (1)',
    currentTexts: ['Идти на восток', 'идти на восток'],
    nextTexts: ['Охотиться', 'охотиться'],
    skipIfNextVisible: false,
    retries: 3,
  });

  await performStep(page, {
    stepName: 'Идти на восток (2)',
    currentTexts: ['Идти на восток', 'идти на восток'],
    nextTexts: ['Охотиться', 'охотиться'],
    retries: 3,
  });

  await pause(page, 800, 1600);
}

async function openBisonFight(page) {
  const HUNT = 'Охотиться';
  const V_BOY = 'В бой!';
  const UDAR = 'Ударить';
  const DONE = 'Бой завершен!';

  const text = await getBodyText(page);
  if (!new RegExp(UDAR, 'i').test(text) && !new RegExp(DONE, 'i').test(text)) {
    await tryPerformStepOptional(page, {
      stepName: HUNT,
      currentTexts: [HUNT, HUNT.toLowerCase()],
      nextTexts: [V_BOY, V_BOY.toLowerCase(), 'В бой', 'в бой', UDAR, UDAR.toLowerCase(), DONE],
    });
  }

  const textAfter = await getBodyText(page);
  if ((/В бой!/i.test(textAfter) || /В бой\b/i.test(textAfter)) && !new RegExp(UDAR, 'i').test(textAfter)) {
    await performStep(page, {
      stepName: V_BOY,
      currentTexts: [
        V_BOY, V_BOY.toLowerCase(),
        'В бой', 'в бой',
        'Вступить в бой', 'вступить в бой',
        'Принять бой', 'принять бой',
      ],
      nextTexts: [UDAR, UDAR.toLowerCase(), DONE],
      retries: 4,
    });
  }

  await pause(page, 1000, 2000);
}

// 16.09.2026, Паша (после ручного прохождения дневной нормы бизона): "продолжай фарм на
// бизоне и кабане (теперь это обычный фарм)" - за пределами дневного бонуса (среда x2/
// воскресенье x3, см. HARPY/BISON_HUNT_WEEKDAYS выше) бизон и кабан остаются обычными
// фармящимися мобами без ограничения по числу боёв - единственный реальный гейт это
// игровой кулдаун по цели (fight_target_cooldown, тот же механизм). Дневной счётчик/гейт
// по дню недели больше НЕ применяется к фарму - вызывается каждый цикл как обычный
// repeat-farm (1 бой за вызов, как Подвалы раньше).
async function runBisonFarmRound(page, buffed = false) {
  const floor = buffed ? HP_FLOOR_WITH_BUFF : BISON_HP_SAFETY_FRACTION;

  await page.goto('http://lbast.ru/location.php', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  const stats0 = parseStats(await getBodyText(page));
  if (
    typeof stats0.hpCurrent !== 'number' ||
    typeof stats0.hpMax !== 'number' ||
    stats0.hpCurrent <= 0 ||
    stats0.hpCurrent < stats0.hpMax * floor
  ) {
    return false;
  }

  const text0 = await getBodyText(page);
  if (!isBisonLocation(text0)) {
    await goRouteToBison(page).catch((e) => {
      console.log('Bison farm: маршрут не пройден:', e.message);
    });
  }

  const stats = parseStats(await getBodyText(page));
  if (
    typeof stats.hpCurrent !== 'number' ||
    typeof stats.hpMax !== 'number' ||
    stats.hpCurrent <= 0 ||
    stats.hpCurrent < stats.hpMax * floor
  ) {
    return false;
  }

  const hpBefore = stats.hpCurrent;
  await openBisonFight(page).catch((e) => {
    console.log('Bison farm: не удалось начать бой:', e.message);
  });

  let won;
  try {
    won = await fightLoop(page);
  } catch (e) {
    const waitMinutes = parseCooldownError(e);
    if (waitMinutes !== null) {
      console.log(`Bison farm: бизон ещё на кулдауне (${waitMinutes} мин) -> попробую в следующем цикле`);
      return false;
    }
    console.log('Bison farm: fightLoop error:', e.message);
    won = null;
  }

  const statsAfter = parseStats(await getBodyText(page));
  const hpAfter = typeof statsAfter.hpCurrent === 'number' ? statsAfter.hpCurrent : null;
  const delta = hpAfter !== null ? hpBefore - hpAfter : null;
  console.log(`Bison farm: fight result=${won} HP ${hpBefore}->${hpAfter} (урон за бой: ${delta})`);
  return true;
}

// Кабан (общий репит-фарм, 16.09.2026, порт маршрута с Цунами commit fb9dea7): Конь ->
// Леса Эльсены -> (В пути) -> Запад -> Юг -> Напасть на кабана. ВАЖНО: "Юг" ведёт к волчьей
// поляне и виден на промежуточной странице ДО клика "Запад" - skipIfNextVisible обязан
// быть false на шаге "Запад", иначе ложно пропустит клик и уведёт к волкам вместо кабана
// (тот же класс бага, что уже чинили для Бизона).
const BOAR_HP_SAFETY_FRACTION = 0.7; // урон не измерен - консервативно, как стартовые Гарпия/Бизон

function isBoarLocation(text) {
  return /Напасть на кабана/i.test(String(text || ''));
}

async function goRouteToBoar(page) {
  const HORSE = 'Конь';
  const ELSENA = 'Леса Эльсены';
  const V_PUTI = 'В пути';
  const V_PUTI_E = 'В пути еще';
  const V_PUTI_Y = 'В пути ещё';
  const WEST = 'Запад';
  const SOUTH = 'Юг';
  const ATTACK_BOAR = 'Напасть на кабана';

  await performStep(page, {
    stepName: HORSE,
    currentTexts: [HORSE, HORSE.toLowerCase()],
    nextTexts: [ELSENA, ELSENA.toLowerCase()],
    retries: 3,
  });

  await performStep(page, {
    stepName: ELSENA,
    currentTexts: [ELSENA, ELSENA.toLowerCase()],
    waitAfterClickMs: 7000,
    nextTexts: [
      V_PUTI, V_PUTI.toLowerCase(),
      V_PUTI_E, V_PUTI_E.toLowerCase(),
      V_PUTI_Y, V_PUTI_Y.toLowerCase(),
      WEST, WEST.toLowerCase(),
    ],
    retries: 3,
  });

  await tryPerformStepOptional(page, {
    stepName: V_PUTI,
    currentTexts: [
      V_PUTI_E, V_PUTI_E.toLowerCase(),
      V_PUTI_Y, V_PUTI_Y.toLowerCase(),
      V_PUTI, V_PUTI.toLowerCase(),
    ],
    nextTexts: [WEST, WEST.toLowerCase()],
  });

  await performStep(page, {
    stepName: WEST,
    currentTexts: [WEST, WEST.toLowerCase()],
    nextTexts: [SOUTH, SOUTH.toLowerCase()],
    retries: 3,
    skipIfNextVisible: false,
  });

  await performStep(page, {
    stepName: SOUTH,
    currentTexts: [SOUTH, SOUTH.toLowerCase()],
    nextTexts: [ATTACK_BOAR, ATTACK_BOAR.toLowerCase()],
    retries: 3,
  });

  await pause(page, 800, 1600);
}

async function openBoarFight(page) {
  const ATTACK_BOAR = 'Напасть на кабана';
  const V_BOY = 'В бой!';
  const UDAR = 'Ударить';
  const DONE = 'Бой завершен!';

  const text = await getBodyText(page);
  if (!new RegExp(UDAR, 'i').test(text) && !new RegExp(DONE, 'i').test(text)) {
    await tryPerformStepOptional(page, {
      stepName: ATTACK_BOAR,
      currentTexts: [ATTACK_BOAR, ATTACK_BOAR.toLowerCase()],
      nextTexts: [V_BOY, V_BOY.toLowerCase(), 'В бой', 'в бой', UDAR, UDAR.toLowerCase(), DONE],
    });
  }

  const textAfter = await getBodyText(page);
  if ((/В бой!/i.test(textAfter) || /В бой\b/i.test(textAfter)) && !new RegExp(UDAR, 'i').test(textAfter)) {
    await performStep(page, {
      stepName: V_BOY,
      currentTexts: [
        V_BOY, V_BOY.toLowerCase(),
        'В бой', 'в бой',
        'Вступить в бой', 'вступить в бой',
        'Принять бой', 'принять бой',
      ],
      nextTexts: [UDAR, UDAR.toLowerCase(), DONE],
      retries: 4,
    });
  }

  await pause(page, 1000, 2000);
}

async function runBoarFarmRound(page, buffed = false) {
  const floor = buffed ? HP_FLOOR_WITH_BUFF : BOAR_HP_SAFETY_FRACTION;

  await page.goto('http://lbast.ru/location.php', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  const stats0 = parseStats(await getBodyText(page));
  if (
    typeof stats0.hpCurrent !== 'number' ||
    typeof stats0.hpMax !== 'number' ||
    stats0.hpCurrent <= 0 ||
    stats0.hpCurrent < stats0.hpMax * floor
  ) {
    return false;
  }

  const text0 = await getBodyText(page);
  if (!isBoarLocation(text0)) {
    await goRouteToBoar(page).catch((e) => {
      console.log('Boar farm: маршрут не пройден:', e.message);
    });
  }

  const stats = parseStats(await getBodyText(page));
  if (
    typeof stats.hpCurrent !== 'number' ||
    typeof stats.hpMax !== 'number' ||
    stats.hpCurrent <= 0 ||
    stats.hpCurrent < stats.hpMax * floor
  ) {
    return false;
  }

  const hpBefore = stats.hpCurrent;
  await openBoarFight(page).catch((e) => {
    console.log('Boar farm: не удалось начать бой:', e.message);
  });

  let won;
  try {
    won = await fightLoop(page);
  } catch (e) {
    const waitMinutes = parseCooldownError(e);
    if (waitMinutes !== null) {
      console.log(`Boar farm: кабан ещё на кулдауне (${waitMinutes} мин) -> попробую в следующем цикле`);
      return false;
    }
    console.log('Boar farm: fightLoop error:', e.message);
    won = null;
  }

  const statsAfter = parseStats(await getBodyText(page));
  const hpAfter = typeof statsAfter.hpCurrent === 'number' ? statsAfter.hpCurrent : null;
  const delta = hpAfter !== null ? hpBefore - hpAfter : null;
  console.log(`Boar farm: fight result=${won} HP ${hpBefore}->${hpAfter} (урон за бой: ${delta})`);
  return true;
}
