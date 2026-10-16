// Фарм: подвалы, гарпия, бизон, кабан.
// Выделено из ai_char/module.js (там только сборка экспорта). Изменяемое состояние - S из ./state.

// Экспорт стоит ДО require: файлы lib/ вызывают друг друга по кругу, а объявления функций
// всплывают (hoisting), поэтому к моменту любого встречного require все функции уже здесь.
module.exports = {
  enterPodvaly, runPodvalyFarmRound, isHarpyLocation, goRouteToHarpy, openHarpyFight,
  runHarpyFarmRound, isBisonLocation, goRouteToBison, openBisonFight, runBisonFarmRound,
  isBoarLocation, goRouteToBoar, openBoarFight, runBoarFarmRound, runSawmillGuardRound,
  isMolegLocation, goRouteToMoleg, runMolegFarmRound,
  isGargoyleLocation, goRouteToGargoyle, runGargoyleFarmRound,
  farmFloorFor,
};

const {
  S, DEMON_LAKE_FASTWAY_URL, getWeekday, HARPY_HUNT_WEEKDAY, HARPY_HUNTS_PER_DAY,
  HP_FLOOR_WITH_BUFF, parseCooldownError, persistDailyQuestState, resetHuntStateIfNewDay, getDayKeyNow,
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
// Кулдаун, который назвала игра, запоминаем в S: драйвер ждёт ровно столько, сколько сказано,
// вместо того чтобы спрашивать раз в минуту (03.10.2026, Паша: «ты каждые 5 минут фармишь?»).
// Держим БЛИЖАЙШИЙ срок из всех целей - освободится первая, круг сессии пойдёт снова.
function noteFarmCooldown(waitMinutes) {
  const t = Date.now() + Math.max(1, Number(waitMinutes) || 1) * 60_000;
  S.farmCooldownUntil = S.farmCooldownUntil && S.farmCooldownUntil > Date.now() ? Math.min(S.farmCooldownUntil, t) : t;
}

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
// ===================================================================================
// МОЛЕГ, Гора Вейлия. Паша, 04.10.2026: «давай сменим точку фарма на молега», «зайти в пещеру».
// Где он - я не знал: в маршрутах его нет, в справке только дроп («Молег - Череп 50%»), а клан
// третий раз посылал «на молегов» без дороги. Нашёл слоем «Боты» на карте мира
// (map.php?mv=0&go=showBot): «№149 - Молег -> Гора Вейлия».
//
// Дорога: Конь -> Гора Вейлия (lway=20), «Зайти в пещеру» = location_boi.php (это и есть экран
// охоты локации), затем «Встретить опасность» (go=1) и обычный бой.
//
// Живой проверочный бой 04.10.2026: выигран, HP 460 -> 229, то есть 231 за бой - ровно половина
// запаса. Поэтому порог 0.9: начав ниже, можно не дожить до конца боя.
//
// ВАЖНО про лечение: на Горе Вейлия анкета показывает 18 hp/мин, а в Кулаке Хаоса с 50-метровым
// домом - 26. Бонус дома действует только в своей локации, поэтому лечиться надо дома, а на гору
// возвращаться на коне (так и работает: драйвер лечится в Кулаке, а раунд сам доедет обратно).
// ===================================================================================
const MOLEG_HP_SAFETY_FRACTION = 0.9; // бой снимает ~231 из 460
const MOLEG_KONJ_URL = 'http://lbast.ru/location.php?mod=konj&lway=20';

function isMolegLocation(text) {
  return /Гора Вейлия|ПЕЩЕРА/i.test(String(text || ''));
}

// Паша, 04.10.2026: «на бой и на дом ты можешь возвращаться последним порталом в амулете, после
// того как первый раз сходишь и туда и туда». Пробуем сначала портал - он мгновенный, конь едет
// несколько секунд. Но портал ведёт на ПРЕДЫДУЩИЙ прыжок, а амулетом пользуются ещё и квестовые
// маршруты: проверено 04.10 - портал увёл в «Городские кварталы», потому что перед этим драйвер
// прыгал в город по квесту. Поэтому после портала обязательно смотрим, где оказались, и если не на
// горе - едем конём. Промах портала ничего не стоит: конь работает из любого места.
const MOLEG_PORTAL_URL = 'http://lbast.ru/location.php?mod=fastway&lway=1';

async function goRouteToMoleg(page) {
  await page.goto(MOLEG_PORTAL_URL, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  await pause(page, 600, 1200);
  await page.goto('http://lbast.ru/location.php', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  if (isMolegLocation(await getBodyText(page))) {
    console.log('Moleg farm: вернулся последним порталом, конь не понадобился.');
    return;
  }
  await page.goto(MOLEG_KONJ_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await pause(page, 900, 1500);
  await waitOutHorseTravel(page, 'http://lbast.ru/location.php');
  await page.goto('http://lbast.ru/location.php', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
}

// Нокаут на точке фарма: считаем и пишем, но фарм НЕ останавливаем. Паша, 13.10.2026: «фарм на
// молеге продолжай. Бывают иногда проигрыши, не страшно».
//
// Почему автозапрет пришлось убрать совсем, а не поправить порог: он сравнивал «урон за бой» с
// запасом HP, а при поражении игра роняет HP глубоко в минус (замер 13.10.2026: 930 -> -3367,
// «урон» 4297). Ни один выживший бой столько не стоит, то есть сработать запрет мог ТОЛЬКО на
// нокауте - на том самом случае, который Паша считает нормальным. Запрет на действие, которое
// разрешено, - это просто остановленный фарм; его и получили: файл wait_for_gear.flag выключил
// бои целиком, и вместе с фармом встали квестовые бои и дейлик на гарпий.
function noteFarmKnockout(spot, delta, hpMax) {
  const day = getDayKeyNow();
  if (S.farmKoDayKey !== day) { S.farmKoDayKey = day; S.farmKoCount = {}; }
  S.farmKoCount[spot] = (S.farmKoCount[spot] || 0) + 1;
  try { persistDailyQuestState(); } catch (e) { /* не критично */ }
  console.log(`Фарм: нокаут на ${spot} (HP ушло в минус, «урон» ${delta} при запасе ${hpMax}).`
    + ` За сутки это ${S.farmKoCount[spot]}-й раз. Фарм продолжаю - проигрыши разрешены.`);
}

// Порог точки фарма наружу: драйверу он нужен, чтобы не гнать персонажа лечиться до 95%, когда
// следующий бой по силам уже сейчас.
function farmFloorFor(spot) {
  if (spot === 'gargoyle') return GARGOYLE_HP_SAFETY_FRACTION;
  if (spot === 'moleg') return MOLEG_HP_SAFETY_FRACTION;
  return 0.7;
}

async function runMolegFarmRound(page, buffed = false) {
  const floor = buffed ? Math.min(MOLEG_HP_SAFETY_FRACTION, HP_FLOOR_WITH_BUFF) : MOLEG_HP_SAFETY_FRACTION;

  await page.goto('http://lbast.ru/location.php', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  let stats = parseStats(await getBodyText(page));
  const low = (st) => typeof st.hpCurrent !== 'number' || typeof st.hpMax !== 'number'
    || st.hpCurrent <= 0 || st.hpCurrent < st.hpMax * floor;
  // Порог проверяем ДО дороги: гонять коня туда-обратно при низком HP бессмысленно.
  // 16.10.2026: этот отказ был МОЛЧАЛИВЫМ, и в логе оставалось только «moleg недоступен» - я искал
  // причину в игре и даже предположил, что бот не возрождается. Паша: «боты не возрождаются в этой
  // игре... они всегда есть». Причина была здесь: порог молега 0.9 против 0.6 у горгульи, то есть
  // почти всегда после горгульего боя молег сам себе запрещён. Теперь отказ называет себя.
  if (low(stats)) {
    console.log(`Moleg farm: HP ${stats.hpCurrent}/${stats.hpMax} ниже порога ${Math.round(floor * 100)}% - круг молега пропускаю.`);
    return false;
  }

  if (!isMolegLocation(await getBodyText(page))) {
    await goRouteToMoleg(page).catch((e) => console.log('Moleg farm: дорога не пройдена:', e.message));
  }
  if (!isMolegLocation(await getBodyText(page))) {
    console.log('Moleg farm: на Гору Вейлия не попал - пропускаю круг.');
    return false;
  }
  stats = parseStats(await getBodyText(page));
  if (low(stats)) return false;

  // Пещера = экран охоты. Пока не отдохнули, она отвечает «Вы слишком устали, приходите через N мин».
  await page.goto('http://lbast.ru/location_boi.php', { waitUntil: 'domcontentloaded', timeout: 60000 });
  const caveText = await getBodyText(page);
  const tired = caveText.match(/приходите через\s+(\d+)\s*мин/i);
  if (tired) {
    console.log(`Moleg farm: ещё не отдохнул (${tired[1]} мин) -> попробую в следующем круге`);
    noteFarmCooldown(Number(tired[1]));
    return false;
  }

  const hpBefore = stats.hpCurrent;
  await page.goto('http://lbast.ru/location_boi.php?go=1', { waitUntil: 'domcontentloaded', timeout: 60000 });
  let won;
  try {
    won = await fightLoop(page);
  } catch (e) {
    const waitMinutes = parseCooldownError(e);
    if (waitMinutes !== null) {
      console.log(`Moleg farm: молег ещё на кулдауне (${waitMinutes} мин) -> попробую в следующем круге`);
      noteFarmCooldown(waitMinutes);
      return false;
    }
    console.log('Moleg farm: fightLoop error:', e.message);
    won = null;
  }

  const statsAfter = parseStats(await getBodyText(page));
  const hpAfter = typeof statsAfter.hpCurrent === 'number' ? statsAfter.hpCurrent : null;
  const delta = hpAfter !== null ? hpBefore - hpAfter : null;
  console.log(`Moleg farm: fight result=${won} HP ${hpBefore}->${hpAfter} (урон за бой: ${delta})`);
  // Замер вместо надежды на чей-то глаз. 10.10.2026: после взятия 9 уровня Молег снял за один бой
  // 2180 HP при запасе 500 - персонаж улетел в -1680 и лежал два часа. На 8 уровне тот же бой стоил
  // ~231: сила бота растёт вместе с нашим уровнем, а шмот остался прежний. Заметил это Паша, а не я,
  // хотя цифра всё время была в журнале. Теперь бой, который стоит больше ПОЛОВИНЫ запаса HP, сам
  // ставит точку фарма под запрет и зовёт Пашу: решение по шмоту и целям всё равно его.
  // Порог - ВЕСЬ запас HP, а не половина: обычный бой с молегом на 8 уровне стоил 231 из 460, то
  // есть половину, и его Паша выбрал сознательно. Под запрет попадает только бой, который снял
  // больше, чем у нас было вообще - то есть нокаут с запасом (проверил на числах из журнала).
  const hpMax = typeof statsAfter.hpMax === 'number' ? statsAfter.hpMax : null;
  if (hpAfter !== null && hpAfter <= 0) noteFarmKnockout('молеге', delta, hpMax);
  return true;
}

// ===================================================================================
// ГОРГУЛЬЯ, Маяк на южном побережье. Паша, 12.10.2026: «раздели фарм пополам на горгулью и
// молега. Горгулью поищи, я не помню где она».
//
// Где она: слой «Боты» карты мира даёт «№36 - Маяк: Горгулья -> Западный тракт». Это тот самый
// маяк, через который проходит доставка еды рыбаку: «Построенный несколько веков назад маяк давно
// уже не работает. Его облюбовали каменные горгульи, существа чудовищной силы и непробиваемой
// брони». Поиск по карте работает ТОЛЬКО отправкой формы (map.php?mv=0&go=search, поле look),
// GET с look= в адресе всегда отвечает «Ничего не найдено».
//
// Дорога: Конь -> Ивовое озеро (lway=23) -> «Идти на запад» -> «Идти на юг» три раза.
// Экран охоты тот же, что у Молега: ссылка «Осмотреть маяк» ведёт на location_boi.php, дальше
// go=1 и обычный бой.
//
// Сила боя НЕ ЗАМЕРЕНА - первый живой бой и покажет. Поэтому порог входа тот же, что у Молега
// (0.9), а защита от «бой дороже всего запаса HP» стоит ниже, как и у Молега: это она поймала
// 2180 урона после взятия 9 уровня. Зуб горгульи, кстати, нужен для эликсира каменного голема
// в гильдии Травников - дроп пригодится.
// ===================================================================================
// Порог поставлен по ЗАМЕРАМ, а не на глаз. 13.10.2026, четыре боя подряд: 140, 173, 191, 288 HP
// при запасе 930 - худший из них 31% запаса. Прежние 0.9 были осторожной догадкой первого дня, и
// из-за них фарм выглядел «один бой и всё»: горгулья снимала 19%, а сессия после каждого боя
// уходила лечиться до 95%. 0.6 оставляет после худшего известного удара ещё 270 HP, то есть
// переживает и двойной выброс. Молегу порог не меняю: он сегодня бил на 899 и 906 из 930.
const GARGOYLE_HP_SAFETY_FRACTION = 0.6;
const GARGOYLE_KONJ_URL = 'http://lbast.ru/location.php?mod=konj&lway=23';

// Проверяем по ССЫЛКЕ, а не по слову «Маяк» в тексте: у соседних локаций юга в описаниях тоже
// попадается море и берег, а однажды проверка по тексту уже заперла персонажа на соседней клетке
// (каменоломня, 09.10.2026).
async function isGargoyleLocation(page) {
  const links = await page.evaluate(() => Array.from(document.querySelectorAll('a'))
    .map((a) => (a.innerText || '').trim())).catch(() => []);
  return links.some((t) => /^Осмотреть маяк$/i.test(t));
}

async function goRouteToGargoyle(page) {
  await page.goto(GARGOYLE_KONJ_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await pause(page, 900, 1500);
  await waitOutHorseTravel(page, 'http://lbast.ru/location.php');
  await page.goto('http://lbast.ru/location.php', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  const step = async (re, label) => {
    const links = await page.evaluate(() => Array.from(document.querySelectorAll('a'))
      .map((a) => ({ t: (a.innerText || '').trim(), h: a.getAttribute('href') || '' }))).catch(() => []);
    const hit = links.find((l) => re.test(l.t));
    if (!hit) { console.log(`Gargoyle farm: не нашёл «${label}». Экран: ${links.map((l) => l.t).join(' | ').slice(0, 200)}`); return false; }
    await page.goto(new URL(hit.h, 'http://lbast.ru/').href, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await pause(page, 600, 1100);
    return true;
  };
  if (!(await step(/^Идти на запад$/, 'Идти на запад'))) return;
  for (let i = 1; i <= 3; i++) if (!(await step(/^Идти на юг$/, `Идти на юг (${i}/3)`))) return;
}

async function runGargoyleFarmRound(page, buffed = false) {
  const floor = buffed ? Math.min(GARGOYLE_HP_SAFETY_FRACTION, HP_FLOOR_WITH_BUFF) : GARGOYLE_HP_SAFETY_FRACTION;

  await page.goto('http://lbast.ru/location.php', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  let stats = parseStats(await getBodyText(page));
  const low = (st) => typeof st.hpCurrent !== 'number' || typeof st.hpMax !== 'number'
    || st.hpCurrent <= 0 || st.hpCurrent < st.hpMax * floor;
  if (low(stats)) return false;

  if (!(await isGargoyleLocation(page))) {
    await goRouteToGargoyle(page).catch((e) => console.log('Gargoyle farm: дорога не пройдена:', e.message));
  }
  if (!(await isGargoyleLocation(page))) {
    console.log('Gargoyle farm: до маяка не добрался - пропускаю круг.');
    return false;
  }
  stats = parseStats(await getBodyText(page));
  if (low(stats)) return false;

  await page.goto('http://lbast.ru/location_boi.php', { waitUntil: 'domcontentloaded', timeout: 60000 });
  const screen = await getBodyText(page);
  const tired = screen.match(/приходите через\s+(\d+)\s*мин/i);
  if (tired) {
    console.log(`Gargoyle farm: ещё не отдохнул (${tired[1]} мин) -> попробую в следующем круге`);
    noteFarmCooldown(Number(tired[1]));
    return false;
  }

  const hpBefore = stats.hpCurrent;
  await page.goto('http://lbast.ru/location_boi.php?go=1', { waitUntil: 'domcontentloaded', timeout: 60000 });
  let won;
  try {
    won = await fightLoop(page);
  } catch (e) {
    const waitMinutes = parseCooldownError(e);
    if (waitMinutes !== null) {
      console.log(`Gargoyle farm: горгулья на кулдауне (${waitMinutes} мин) -> попробую в следующем круге`);
      noteFarmCooldown(waitMinutes);
      return false;
    }
    console.log('Gargoyle farm: fightLoop error:', e.message);
    won = null;
  }

  const statsAfter = parseStats(await getBodyText(page));
  const hpAfter = typeof statsAfter.hpCurrent === 'number' ? statsAfter.hpCurrent : null;
  const delta = hpAfter !== null ? hpBefore - hpAfter : null;
  console.log(`Gargoyle farm: fight result=${won} HP ${hpBefore}->${hpAfter} (урон за бой: ${delta})`);
  const hpMax = typeof statsAfter.hpMax === 'number' ? statsAfter.hpMax : null;
  if (hpAfter !== null && hpAfter <= 0) noteFarmKnockout('горгулье', delta, hpMax);
  return true;
}

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
      noteFarmCooldown(waitMinutes);
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
      noteFarmCooldown(waitMinutes);
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

// ===================================================================================
// Сторож лесопилки (Леса Эльсены) - доски на бунгало. Паша, 21.09.2026: «встроить сторожа в
// ферму». Для постройки бунгало на Дауэрти нужно 3 «Обрезные доски»; падают со сторожа с шансом
// 10% (справка игры), поэтому бьём его как бизона и кабана, пока досок меньше трёх.
// Маршрут пройден вживую 21.09.2026: Конь -> Леса Эльсены -> (В пути) -> Опушка -> «Идти на север
// к лесопилке» -> «Лесопилка» -> «Воровать доски» -> «Напасть на сторожа» -> «В бой!».
// Сторож [3], 410 HP, урон 205 за бой у AI__ 6 ур. (21.09: 458 -> 163, 500 -> 295), без сбора
// лута - доска сама падает в инвентарь.
// ===================================================================================
const SAWMILL_BOARDS_NEEDED = 3;
const SAWMILL_HP_FLOOR = 0.85; // бой снимает 200-300 из 500
let sawmillBoardsCache = { at: 0, count: null };

async function countSawmillBoards(page) {
  if (Date.now() - sawmillBoardsCache.at < 20 * 60 * 1000 && sawmillBoardsCache.count !== null) return sawmillBoardsCache.count;
  await page.goto('http://lbast.ru/inv.php', { waitUntil: 'domcontentloaded', timeout: 60000 });
  const m = (await getBodyText(page)).match(/Обрезная доска[ \t]*(\d+)?/i);
  const count = m ? (m[1] ? Number(m[1]) : 1) : 0;
  sawmillBoardsCache = { at: Date.now(), count };
  return count;
}

// 22.09.2026: бунгало построено (ушло 2 доски) - доски больше не нужны, сторож выключен.
const SAWMILL_ENABLED = false;

async function runSawmillGuardRound(page) {
  if (!SAWMILL_ENABLED) return false;
  const boards = await countSawmillBoards(page);
  if (boards >= SAWMILL_BOARDS_NEEDED) return false;

  await page.goto('http://lbast.ru/location.php', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  const stats0 = parseStats(await getBodyText(page));
  if (typeof stats0.hpCurrent !== 'number' || typeof stats0.hpMax !== 'number'
    || stats0.hpCurrent < stats0.hpMax * SAWMILL_HP_FLOOR) return false;

  let text = await getBodyText(page);
  if (!/Лесопилка/i.test(text)) {
    if (!/Идти на север к лесопилке/i.test(text)) {
      await performStep(page, { stepName: 'Конь', currentTexts: ['Конь'], nextTexts: ['Леса Эльсены'], retries: 3 });
      await performStep(page, { stepName: 'Леса Эльсены', currentTexts: ['Леса Эльсены'], waitAfterClickMs: 7000, retries: 3 });
      for (let i = 0; i < 15 && /В пути/i.test(await getBodyText(page)); i++) {
        await clickByTexts(page, ['В пути еще', 'В пути ещё', 'В пути'], 'В пути').catch(() => {});
        await pause(page, 1800, 2600);
      }
    }
    await performStep(page, { stepName: 'Идти на север к лесопилке', currentTexts: ['Идти на север к лесопилке'], retries: 3 });
  }
  await performStep(page, { stepName: 'Лесопилка', currentTexts: ['Лесопилка'], nextTexts: ['Воровать доски'], retries: 3, skipIfNextVisible: false });
  await performStep(page, { stepName: 'Воровать доски', currentTexts: ['Воровать доски'], nextTexts: ['Напасть на сторожа'], retries: 3 });
  await performStep(page, { stepName: 'Напасть на сторожа', currentTexts: ['Напасть на сторожа'], retries: 3 });
  if (await existsAnyText(page, ['В бой!', 'В бой'])) {
    await performStep(page, { stepName: 'В бой!', currentTexts: ['В бой!', 'В бой'], retries: 3 });
  }
  const hpBefore = stats0.hpCurrent;
  const won = await fightLoop(page).catch((e) => { console.log('Sawmill guard: fightLoop error:', e.message); return null; });
  const hpAfter = parseStats(await getBodyText(page)).hpCurrent;
  sawmillBoardsCache.at = 0; // перечитать инвентарь
  const now = await countSawmillBoards(page);
  console.log(`Sawmill guard: fight result=${won} HP ${hpBefore}->${hpAfter}; досок ${now}/${SAWMILL_BOARDS_NEEDED}${now > boards ? ' (выпала доска!)' : ''}`);
  if (now >= SAWMILL_BOARDS_NEEDED) console.log('Доски для бунгало собраны: 3 шт. - можно строить бунгало на Дауэрти.');
  await page.goto('http://lbast.ru/location.php', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  return true;
}
