// Диспетчер дневных квестов (runDailyQuests), проверки "можно ли сейчас", hasPendingFightQuests.
// Выделено из ai_char/module.js (там только сборка экспорта). Изменяемое состояние - S из ./state.

// Экспорт стоит ДО require: файлы lib/ вызывают друг друга по кругу, а объявления функций
// всплывают (hoisting), поэтому к моменту любого встречного require все функции уже здесь.
module.exports = {
  hasPendingFightQuests, runDailyQuests, canRunLifeTreeNow, syncFishEyeDayState,
  syncDrabasDayState, canRunDrabasNow, syncFishingDayState, canRunFishingNow,
  canRunFishEyeFightNow, canRunFishEyeRewardNow, runNonQQuestSafe,
};

const {
  S, ASSASSIN_MERCHANT_MAX_ATTEMPTS_PER_DAY, DRABAS_DAILY_LIMIT, DRABAS_INTERVAL_MS,
  FISH_EYE_DAILY_FIGHT_LIMIT, FISH_EYE_INTERVAL_MS, FISH_RESTAURANT_ENABLED,
  FISHING_ATTEMPT_COOLDOWN_MS, FISHING_DAILY_CATCH_LIMIT, getDayKeyNow, LIFE_TREE_DAILY_LIMIT,
  getFightMode, CHAIN_FIGHT_QUESTS,
  LIFE_TREE_INTERVAL_MS,
} = require('./state');
const { appendDebugSnapshot, checkExclusiveQuestTimeouts, getBodyText, pause } = require('./core');
const { lowHpBeforeFightQuest, noteHpFromPageText, runQuestStepSafe } = require('./hp');
const {
  isQuestInMenu, openQuestsMenu, parseQuestNamesFromQMenuText, resetToQuestMenu,
} = require('./quest_menu');
const {
  progressCaravanRobberyQuest, progressFisherFoodQuest, progressLifeTreeQuest,
  progressRumaForgeQuest, runDrabasQuest,
} = require('./quests_basic');
const { recoverToCity } = require('./recovery');
const { progressShtolniQuest } = require('./shtolni');
const { progressTavernQuest } = require('./tavern');

// Паша, 21.09.2026: «руму отключи». «Кузница Рума» каждую попытку платит 15 дин за лодку на
// остров Глинбаг и упирается в fight_not_reached (20.09 это кончилось КО на -22/400). Пока
// маршрут не починен, квест не запускаем и ферму он не держит.
const RUMA_FORGE_ENABLED = false;

// Квесты, которые мы РЕАЛЬНО умеем проходить и в которых есть бои. Нужны, чтобы решать, можно
// ли сейчас тратить HP на ферму. Штольни СОЗНАТЕЛЬНО не включены: квест выключен
// (SHTOLNI_ENABLED_FOR_AI = false) и висит в Q-меню всегда - иначе ферма выключилась бы навсегда.
const IMPLEMENTED_FIGHT_QUESTS = [
  'Харчевня',
  'Камни Драбаса',
  'Грабим корованы',
  'Кузница Рума',
  'Еда для рыбака',
  'Рыбный ресторан',
  'Трактир «Рыбий глаз»',
  // Асассины ферму не держат: они идут в цикле раньше фермы сами (снова включены 21.09.2026).
  'Ордо экзекуторс: Уничтожить главаря банды',
  'Ордо экзекуторс: Уничтожить банду',
];

// Паша, 17.09.2026: "квесты важнее фарма". Одного порога HP мало: живой замер показал, что
// ОДИН бой с бизоном снимает 186 HP (49% от максимума 380). То есть даже стартовав с 70%,
// после фарма персонаж оказывается на ~29% и ни один квест с боем уже не проходит.
// Поэтому ферма ждёт, пока сегодняшние квесты с боями не будут закрыты.
function hasPendingFightQuests() {
  // null = Q-меню в этом процессе ещё ни разу не видели. Считаем, что квесты есть: пропустить
  // один круг фарма дешевле, чем сточить HP и потерять дейлик, который пропадёт вместе с днём.
  if (S.lastListedQuestNames === null) return true;
  // 18.09.2026, Паша: "почему сейчас не фармит?" - ферма стояла на 354/380, "сберегая HP" под
  // торговца, на которого дневные попытки уже кончились. Такой квест сегодня не пойдёт, и
  // держать ради него ферму бессмысленно.
  // И второе: при 380/380 ферма стояла ради торговца, которого только что не застали на
  // клетке. Ждать HP под квест, который сейчас сделать нельзя, - значит не делать ничего.
  // 30 минут после "каравана нет" торговец ферму не держит (сам он пробуется каждый цикл).
  const merchantOut = S.assassinMerchantAttemptsToday >= ASSASSIN_MERCHANT_MAX_ATTEMPTS_PER_DAY
    || Date.now() - S.assassinMerchantNoCaravanAt < 30 * 60 * 1000;
  // Ещё два квеста висят в Q ВСЕГДА и потому держали ферму вечно: выключенный Рыбный
  // ресторан (FISH_RESTAURANT_ENABLED) и Рыбий глаз - он повторяется каждые 25 минут и в
  // цикле всё равно идёт РАНЬШЕ фермы, когда подходит его очередь.
  // 20.09.2026: в режиме одиночных боёв ферма стояла, «берегу HP под квесты», а те квесты - цепочки,
  // которые в этом режиме и не запускаются (Ордо, Штольни). Ждать их бессмысленно.
  const mode = getFightMode();
  if (mode === 'none') return false; // боёв нет вовсе - ферме ждать нечего (бизон идёт всегда)
  const blockedByMode = (q) => mode === 'single'
    && (CHAIN_FIGHT_QUESTS.has(q) || /Рыбный ресторан/i.test(q)); // Ордо - одиночные бои (21.09)
  const skip = (q) => blockedByMode(q) || (merchantOut && /торгов/i.test(q))
    || (!FISH_RESTAURANT_ENABLED && q === 'Рыбный ресторан')
    || (!RUMA_FORGE_ENABLED && q === 'Кузница Рума')
    // Драбас висит в Q весь день; без питомца или на кулдауне (2 раза в сутки, раз в 3-4 ч) держать
    // ради него ферму - значит не фармить весь день.
    || (q === 'Камни Драбаса' && !canRunDrabasNow())
    || (q === 'Трактир «Рыбий глаз»' && !canRunFishEyeFightNow());
  return IMPLEMENTED_FIGHT_QUESTS
    .filter((q) => !skip(q))
    .some((q) => isQuestInMenu(S.lastListedQuestNames, q));
}

async function runDailyQuests(page, stats) {
  const questCount = stats?.questsAvailable;
  console.log(`Daily quests detected: Q=${questCount}`);

  // AI__ driver.js calls runDailyQuests directly (not doScenario), so lastCycleStats — read by
  // progressShtolniQuest's HP/reserve gate — would otherwise stay null forever and the gate would
  // always fail with "hp=n/a". Set it here from the stats we were already given.
  S.lastCycleStats = stats;

  // Сброс флага "персонаж выбыл из строя" по СВЕЖИМ статам начала цикла (драйвер читает их сам
  // и передаёт сюда) - иначе флаг залипнет навсегда: при взведённом флаге runQuestStepSafe и
  // runNonQQuestSafe выходят раньше, чем успевают перечитать HP, и сами его не снимут.
  if (typeof stats?.hpCurrent === 'number') {
    S.characterDownDetected = stats.hpCurrent <= 0;
  }

  checkExclusiveQuestTimeouts();

  const reserveMinutes = typeof stats?.reserveMinutes === 'number' ? stats.reserveMinutes : stats?.cooldown;

  const opened = await openQuestsMenu(page, questCount);
  if (!opened) {
    console.log('Could not open quests menu (Q is present but no clickable entry found).');
    return { didAnything: false, hasAnyTargetQuest: false };
  }

  let didAnything = false;
  const menuText = await getBodyText(page);
  let listedQuests = parseQuestNamesFromQMenuText(menuText);
  console.log('Q menu quest names:', JSON.stringify(listedQuests));
  S.lastListedQuestNames = listedQuests; // кэш для решения "можно ли фармить" в следующем цикле
  if (listedQuests.length === 0) {
    appendDebugSnapshot('Q menu parse returned empty list', { label: 'q_menu_empty_parse', url: page.url(), text: menuText });
  }

  // Exclusive quests: while one of these is in progress, do not start any other Q-quests.
  const exclusiveInProgress = [];
  const now = Date.now();
  const tavernSuppressed = now < S.tavernSuppressedUntil;
  const shtolniSuppressed = now < S.shtolniSuppressedUntil;
  if (S.tavernTakenToday && !S.tavernDoneToday && !tavernSuppressed) exclusiveInProgress.push('Харчевня');
  if (S.shtolniTakenToday && !S.shtolniDoneToday && !shtolniSuppressed) exclusiveInProgress.push('Штольни');
  // Рыбного ресторана нет в TARGET_Q_QUESTS, поэтому пока он в фокусе, ни один Q-квест из
  // списка не стартует - именно этого и не хватало: драйвер уходил с недоделанного маршрута.
  if (S.fishRestaurantFocusStartedAt && !S.fishRestaurantDoneToday && now >= S.fishRestaurantSuppressedUntil) {
    exclusiveInProgress.push('Рыбный ресторан');
  }
  const isQQuestAllowed = (questName) => {
    if (exclusiveInProgress.length === 0) return true;
    return exclusiveInProgress.includes(questName);
  };

  const TARGET_Q_QUESTS = [
    'Харчевня',
    'Дерево жизни',
    'Штольни',
    'Камни Драбаса',
    ...(RUMA_FORGE_ENABLED ? ['Кузница Рума'] : []),
    'Еда для рыбака',
    'Грабим корованы',
  ];

  const hasAnyTargetQuest = TARGET_Q_QUESTS.some((q) => isQuestInMenu(listedQuests, q));

  if (!tavernSuppressed && isQQuestAllowed('Харчевня') && isQuestInMenu(listedQuests, 'Харчевня') && !(S.shtolniTakenToday && !S.shtolniDoneToday)) {
    if (await runQuestStepSafe(page, 'Харчевня', () => progressTavernQuest(page, { initialReserveMinutes: stats?.cooldown, questCount }))) {
      didAnything = true;
    }
    await resetToQuestMenu(page, questCount);
    listedQuests = parseQuestNamesFromQMenuText(await getBodyText(page));

    // If we started / are in progress with an exclusive quest, stop here.
    if (S.tavernTakenToday && !S.tavernDoneToday) {
      return { didAnything, hasAnyTargetQuest };
    }
  }

  if (isQQuestAllowed('Дерево жизни') && canRunLifeTreeNow()) {
    if (await runQuestStepSafe(page, 'Дерево жизни', () => progressLifeTreeQuest(page, { questCount }))) {
      didAnything = true;
    }
    await resetToQuestMenu(page, questCount);
    listedQuests = parseQuestNamesFromQMenuText(await getBodyText(page));
  }

  if (!shtolniSuppressed && isQQuestAllowed('Штольни') && isQuestInMenu(listedQuests, 'Штольни') && !(S.tavernTakenToday && !S.tavernDoneToday)) {
    // 14.09.2026 (Паша): "по резерву отмени правило, просто жди сколько нужно" — резерв
    // больше не пропускает попытку здесь; progressShtolniQuest сам активно ждёт нужный
    // резерв (waitForReserveAtLeast) после проверки HP-гейта.
    if (await runQuestStepSafe(page, 'Штольни', () => progressShtolniQuest(page))) {
      didAnything = true;
    }
    await resetToQuestMenu(page, questCount);
    listedQuests = parseQuestNamesFromQMenuText(await getBodyText(page));

    // If we started / are in progress with an exclusive quest, stop here.
    if (S.shtolniTakenToday && !S.shtolniDoneToday) {
      return { didAnything, hasAnyTargetQuest };
    }
  }

  if (isQQuestAllowed('Камни Драбаса') && isQuestInMenu(listedQuests, 'Камни Драбаса')) {
    if (await runQuestStepSafe(page, 'Камни Драбаса', () => runDrabasQuest(page))) {
      didAnything = true;
    }
    await resetToQuestMenu(page, questCount);
    listedQuests = parseQuestNamesFromQMenuText(await getBodyText(page));
  }

  if (RUMA_FORGE_ENABLED && isQQuestAllowed('Кузница Рума') && isQuestInMenu(listedQuests, 'Кузница Рума')) {
    if (await runQuestStepSafe(page, 'Кузница Рума', () => progressRumaForgeQuest(page, { questCount }))) {
      didAnything = true;
    }
    await resetToQuestMenu(page, questCount);
    listedQuests = parseQuestNamesFromQMenuText(await getBodyText(page));
  }

  if (isQQuestAllowed('Еда для рыбака') && isQuestInMenu(listedQuests, 'Еда для рыбака')) {
    if (typeof reserveMinutes !== 'number' || reserveMinutes < 10) {
      console.log(`Quest step skip: Еда для рыбака (need >=10 reserve minutes, have=${reserveMinutes ?? 'n/a'})`);
    } else {
      if (await runQuestStepSafe(page, 'Еда для рыбака', () => progressFisherFoodQuest(page, { questCount }))) {
        didAnything = true;
      }
    }
    await resetToQuestMenu(page, questCount);
    listedQuests = parseQuestNamesFromQMenuText(await getBodyText(page));
  }

  if (isQQuestAllowed('Грабим корованы') && isQuestInMenu(listedQuests, 'Грабим корованы')) {
    if (typeof reserveMinutes !== 'number' || reserveMinutes < 10) {
      console.log(`Quest step skip: Грабим корованы (need >=10 reserve minutes, have=${reserveMinutes ?? 'n/a'})`);
    } else {
      if (await runQuestStepSafe(page, 'Грабим корованы', () => progressCaravanRobberyQuest(page))) {
        didAnything = true;
      }
    }
    await resetToQuestMenu(page, questCount);
    listedQuests = parseQuestNamesFromQMenuText(await getBodyText(page));
  }

  try {
    await page.goto('http://lbast.ru/location.php', {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });
  } catch (e) {
    console.log('Could not return to location.php after quests menu.');
  }

  await pause(page, 800, 1600);
  return { didAnything, hasAnyTargetQuest };
}

function canRunLifeTreeNow() {
  const key = getDayKeyNow();
  if (S.lifeTreeDayKey !== key) {
    S.lifeTreeDayKey = key;
    S.lifeTreeRunsToday = 0;
  }

  if (S.lifeTreeRunsToday >= LIFE_TREE_DAILY_LIMIT) {
    return false;
  }

  if (!S.lastLifeTreeRunAt) return true;
  return Date.now() - S.lastLifeTreeRunAt >= LIFE_TREE_INTERVAL_MS;
}

function syncFishEyeDayState() {
  const key = getDayKeyNow();
  if (S.fishEyeDayKey !== key) {
    S.fishEyeDayKey = key;
    S.fishEyeFightsToday = 0;
    S.fishEyeRewardClaimedToday = false;
  }
}

function syncDrabasDayState() {
  const key = getDayKeyNow();
  if (S.drabasDayKey !== key) {
    S.drabasDayKey = key;
    S.drabasRunsToday = 0;
  }
}

function canRunDrabasNow() {
  syncDrabasDayState();

  // Нет питомца - камни игра не даёт («Пока что вам эти камни ни к чему»), см. S.drabasNoPetUntil.
  if (Date.now() < S.drabasNoPetUntil) return false;

  if (S.drabasRunsToday >= DRABAS_DAILY_LIMIT) {
    return false;
  }

  if (!S.lastDrabasRunAt) return true;
  return Date.now() - S.lastDrabasRunAt >= DRABAS_INTERVAL_MS;
}

function syncFishingDayState() {
  const key = getDayKeyNow();
  if (S.fishingDayKey !== key) {
    S.fishingDayKey = key;
    S.fishingCatchesToday = 0;
  }
}

function canRunFishingNow() {
  syncFishingDayState();
  if (S.fishingCatchesToday >= FISHING_DAILY_CATCH_LIMIT) return false;
  if (!S.lastFishingAttemptAt) return true;
  return Date.now() - S.lastFishingAttemptAt >= FISHING_ATTEMPT_COOLDOWN_MS;
}

function canRunFishEyeFightNow() {
  syncFishEyeDayState();

  if (S.fishEyeFightsToday >= FISH_EYE_DAILY_FIGHT_LIMIT) {
    return false;
  }

  if (!S.lastFishEyeRunAt) return true;
  return Date.now() - S.lastFishEyeRunAt >= FISH_EYE_INTERVAL_MS;
}

function canRunFishEyeRewardNow() {
  syncFishEyeDayState();
  return S.fishEyeFightsToday >= FISH_EYE_DAILY_FIGHT_LIMIT && !S.fishEyeRewardClaimedToday;
}

async function runNonQQuestSafe(page, label, fn) {
  if (S.characterDownDetected) {
    console.log(`${label}: пропускаю, персонаж выбыл из строя.`);
    return false;
  }
  if (await lowHpBeforeFightQuest(page, label)) return false;
  try {
    const result = await fn();
    noteHpFromPageText(await getBodyText(page), label);
    return result;
  } catch (e) {
    console.log(`${label} error: ${e.message}`);
    noteHpFromPageText(e.message, label);
    await recoverToCity(page, `${label}: ${e.message}`);
    noteHpFromPageText(await getBodyText(page), label);
    return null; // indicates recovery happened
  }
}
