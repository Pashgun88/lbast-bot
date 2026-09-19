// Простые дневные квесты: Дерево жизни, Рыбий глаз, Камни Драбаса, Кузница Рума, Еда для рыбака, Грабим корованы, Довольствие.
// Выделено из ai_char/module.js (там только сборка экспорта). Изменяемое состояние - S из ./state.

// Экспорт стоит ДО require: файлы lib/ вызывают друг друга по кругу, а объявления функций
// всплывают (hoisting), поэтому к моменту любого встречного require все функции уже здесь.
module.exports = {
  ensureLifeTreeJuiceCollected, progressLifeTreeQuest, runFishEyeRouteToArena, runFishEyeFight,
  tryClaimFishEyeReward, runDrabasQuest, progressRumaForgeQuest, progressFisherFoodQuest,
  progressCaravanRobberyQuest, runFishEyeIfDue, progressDovolstvieQuest, runDovolstvieIfAvailable,
};

const {
  S, DEVTOWN_FASTWAY_URL, DRABAS_DAILY_LIMIT, FISH_EYE_DAILY_FIGHT_LIMIT, FISH_EYE_INTERVAL_MS,
  getDayKeyNow, LIFE_TREE_DAILY_LIMIT, persistDailyQuestState, QUEST_FIGHT_HP_FLOOR,
} = require('./state');
const { getBodyText, pause } = require('./core');
const {
  canRunDrabasNow, canRunFishEyeFightNow, canRunFishEyeRewardNow, canRunLifeTreeNow,
  runNonQQuestSafe, syncDrabasDayState, syncFishEyeDayState,
} = require('./daily_quests');
const { fightLoop } = require('./fight');
const { preTripHpGate, questFightHpGate, tryPerformStepOptional } = require('./hp');
const {
  clickInfoForQuest, clickLinkNextToQuest, isQuestInMenu, parseQuestNamesFromQMenuText,
  resetToQuestMenu,
} = require('./quest_menu');
const { navigateFastway } = require('./recovery');
const { clickByTexts, existsAnyText, performStep } = require('./ui');

async function ensureLifeTreeJuiceCollected(page) {
  const QUEST_NAME = '\u0414\u0435\u0440\u0435\u0432\u043e \u0436\u0438\u0437\u043d\u0438';

  let opened = await clickInfoForQuest(page, QUEST_NAME);

  // On 2nd/3rd runs the quest may be absent from the "available quests" list, and is only accessible via "Все квесты".
  if (!opened) {
    const allOk = await clickByTexts(page, ['\u0412\u0441\u0435 \u043a\u0432\u0435\u0441\u0442\u044b', '\u0432\u0441\u0435 \u043a\u0432\u0435\u0441\u0442\u044b'], '\u0412\u0441\u0435 \u043a\u0432\u0435\u0441\u0442\u044b');
    if (!allOk) {
      console.log('Could not open "Все квесты" for Life Tree.');
      return false;
    }

    // "Дерево жизни [с 0 ур.]" -> click "с 0 ур." next to the quest.
    opened = await clickLinkNextToQuest(
      page,
      QUEST_NAME,
      ['\u0441 0 \u0443\u0440.', '\u0421 0 \u0443\u0440.', '0 \u0443\u0440.', '0 \u0443\u0440'],
      'Дерево жизни',
    );
  }

  // 19.09.2026: после «Все квесты» ссылка «с 0 ур.» не находилась (страница не успевала
  // открыться), и дерево делалось 1 раз в сутки вместо 3. Инфо квеста открывается напрямую по qid=42.
  if (!opened) {
    try {
      await page.goto('http://lbast.ru/pers.php?mod=questinfo&qid=42', { waitUntil: 'domcontentloaded', timeout: 60000 });
      await pause(page, 600, 1200);
      opened = await existsAnyText(page, ['К месту выполнения']);
      if (opened) console.log('OK: Дерево жизни -> инфо по qid=42');
    } catch (e) { /* ниже - отказ */ }
  }

  if (!opened) {
    console.log('Could not open Life Tree quest entry.');
    return false;
  }

  await performStep(page, {
    stepName: '\u041a \u043c\u0435\u0441\u0442\u0443 \u0432\u044b\u043f\u043e\u043b\u043d\u0435\u043d\u0438\u044f',
    currentTexts: [
      '\u041a \u043c\u0435\u0441\u0442\u0443 \u0432\u044b\u043f\u043e\u043b\u043d\u0435\u043d\u0438\u044f',
      '\u043a \u043c\u0435\u0441\u0442\u0443 \u0432\u044b\u043f\u043e\u043b\u043d\u0435\u043d\u0438\u044f',
    ],
    waitAfterClickMs: 7000,
    retries: 3,
  });

  if (await existsAnyText(page, ['\u0412 \u043f\u0443\u0442\u0438', '\u0432 \u043f\u0443\u0442\u0438'])) {
    await clickByTexts(page, ['\u0412 \u043f\u0443\u0442\u0438', '\u0432 \u043f\u0443\u0442\u0438'], '\u0412 \u043f\u0443\u0442\u0438');
    await pause(page, 800, 1600);
  }

  await performStep(page, {
    stepName: '\u041f\u043e\u0434\u043e\u0439\u0442\u0438 \u043a \u0434\u0435\u0440\u0435\u0432\u0443',
    currentTexts: ['\u041f\u043e\u0434\u043e\u0439\u0442\u0438 \u043a \u0434\u0435\u0440\u0435\u0432\u0443', '\u043f\u043e\u0434\u043e\u0439\u0442\u0438 \u043a \u0434\u0435\u0440\u0435\u0432\u0443'],
    retries: 4,
  });

  await performStep(page, {
    stepName: '\u0421\u043e\u0431\u0440\u0430\u0442\u044c \u0441\u043e\u043a',
    currentTexts: ['\u0421\u043e\u0431\u0440\u0430\u0442\u044c \u0441\u043e\u043a', '\u0441\u043e\u0431\u0440\u0430\u0442\u044c \u0441\u043e\u043a'],
    retries: 4,
  });

  await performStep(page, {
    stepName: '\u0423\u0439\u0442\u0438',
    currentTexts: ['\u0423\u0439\u0442\u0438', '\u0443\u0439\u0442\u0438'],
    retries: 4,
  });

  if (await existsAnyText(page, ['\u0412 \u0438\u0433\u0440\u0443', '\u0432 \u0438\u0433\u0440\u0443'])) {
    await clickByTexts(page, ['\u0412 \u0438\u0433\u0440\u0443', '\u0432 \u0438\u0433\u0440\u0443'], '\u0412 \u0438\u0433\u0440\u0443 (after Life Tree)');
    await pause(page, 800, 1600);
  }

  S.lastLifeTreeRunAt = Date.now();
  const key = getDayKeyNow();
  if (S.lifeTreeDayKey !== key) {
    S.lifeTreeDayKey = key;
    S.lifeTreeRunsToday = 0;
  }
  S.lifeTreeRunsToday += 1;
  persistDailyQuestState();

  console.log(`Life Tree quest: done (${S.lifeTreeRunsToday}/${LIFE_TREE_DAILY_LIMIT} today)`);
  return true;
}

async function progressLifeTreeQuest(page, { questCount } = {}) {
  if (!canRunLifeTreeNow()) {
    return false;
  }

  console.log('Life Tree quest: due, trying to run');
  try {
    if (!await resetToQuestMenu(page, questCount)) {
      return false;
    }
    return await ensureLifeTreeJuiceCollected(page);
  } catch (e) {
    console.log(`Life Tree quest failed: ${e.message}`);
    return false;
  }
}

async function runFishEyeRouteToArena(page) {
  // \u041c\u043e\u0436\u0435\u0442 \u0432\u044b\u0437\u044b\u0432\u0430\u0442\u044c\u0441\u044f \u043f\u043e\u0441\u043b\u0435 \u0445\u0435\u043d\u0434\u043b\u0435\u0440\u0430, \u043a\u043e\u0442\u043e\u0440\u044b\u0439 \u043e\u0441\u0442\u0430\u0432\u0438\u043b page \u043d\u0430 \u0434\u043e\u0441\u043a\u0435 \u043a\u0432\u0435\u0441\u0442\u043e\u0432/\u0434\u0440\u0443\u0433\u043e\u0439 \u0441\u0442\u0440\u0430\u043d\u0438\u0446\u0435
  // (\u043d\u0430\u043f\u0440\u0438\u043c\u0435\u0440, runDemonLakeQuestIfAvailable, \u043a\u043e\u0433\u0434\u0430 \u043a\u0432\u0435\u0441\u0442\u0430 \u043d\u0435\u0442 \u0432 \u0441\u043f\u0438\u0441\u043a\u0435) - "\u0410\u043c\u0443\u043b\u0435\u0442" \u0432\u0438\u0434\u0435\u043d
  // \u0442\u043e\u043b\u044c\u043a\u043e \u043d\u0430 location.php, \u043f\u043e\u044d\u0442\u043e\u043c\u0443 \u0441\u043d\u0430\u0447\u0430\u043b\u0430 \u044f\u0432\u043d\u043e \u0432\u043e\u0437\u0432\u0440\u0430\u0449\u0430\u0435\u043c\u0441\u044f \u0442\u0443\u0434\u0430 (\u0442\u043e\u0442 \u0436\u0435 \u043a\u043b\u0430\u0441\u0441 \u0431\u0430\u0433\u0430,
  // \u0447\u0442\u043e \u0447\u0438\u043d\u0438\u043b\u0438 \u0432 runPodvalyFarmRound/progressDemonLakeQuest - \u043d\u0435 \u0434\u043e\u0432\u0435\u0440\u044f\u0442\u044c page).
  await page.goto('http://lbast.ru/location.php', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  await pause(page, 500, 1000);

  const DEVTOWN = '\u0414\u0435\u0432\u0442\u0430\u0443\u043d';
  const EAST_CRAFT = '\u041d\u0430 \u0432\u043e\u0441\u0442\u043e\u043a, \u0432 \u0440\u0435\u043c\u0435\u0441\u043b\u0435\u043d\u043d\u044b\u0439 \u0440\u0430\u0439\u043e\u043d';
  const GO_EAST = '\u0418\u0434\u0442\u0438 \u043d\u0430 \u0432\u043e\u0441\u0442\u043e\u043a';
  const PORT = '\u043f\u043e\u0440\u0442\u043e\u0432\u044b\u0439 \u0440\u0430\u0439\u043e\u043d';
  const FISH_EYE_TAVERN_FULL = '\u0422\u0440\u0430\u043a\u0442\u0438\u0440 \u00ab\u0420\u044b\u0431\u0438\u0439 \u0433\u043b\u0430\u0437\u00bb';
  const FISH_EYE_TAVERN_PLAIN = '\u0420\u044b\u0431\u0438\u0439 \u0433\u043b\u0430\u0437';
  const DESCEND = '\u0421\u043f\u0443\u0441\u0442\u0438\u0442\u044c\u0441\u044f \u043d\u0430 \u0430\u0440\u0435\u043d\u0443';

  // \u041a\u043b\u0438\u043a \u043f\u043e \u0442\u0435\u043a\u0441\u0442\u0443 "\u0410\u043c\u0443\u043b\u0435\u0442" \u0441\u0438\u0441\u0442\u0435\u043c\u0430\u0442\u0438\u0447\u0435\u0441\u043a\u0438 \u043d\u0435 \u043d\u0430\u0445\u043e\u0434\u0438\u0442 \u0441\u0441\u044b\u043b\u043a\u0443 (Latin "A" \u0432 \u0432\u0451\u0440\u0441\u0442\u043a\u0435 \u0441\u0430\u0439\u0442\u0430, \u0441\u043c.
  // CHAOS_FASTWAY_URL \u043a\u043e\u043c\u043c\u0435\u043d\u0442\u0430\u0440\u0438\u0439) - \u043f\u0435\u0440\u0435\u0445\u043e\u0434\u0438\u043c \u043f\u0440\u044f\u043c\u043e \u043a \u0414\u0435\u0432\u0442\u0430\u0443\u043d\u0443 \u043f\u043e fastway URL.
  await navigateFastway(page, DEVTOWN_FASTWAY_URL, '\u0414\u0435\u0432\u0442\u0430\u0443\u043d');

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
    nextTexts: [PORT, PORT.toLowerCase()],
    retries: 4,
  });

  await performStep(page, {
    stepName: PORT,
    currentTexts: [PORT, PORT.toLowerCase()],
    nextTexts: [FISH_EYE_TAVERN_FULL, FISH_EYE_TAVERN_PLAIN, FISH_EYE_TAVERN_PLAIN.toLowerCase()],
    retries: 4,
  });

  await performStep(page, {
    stepName: FISH_EYE_TAVERN_FULL,
    currentTexts: [
      FISH_EYE_TAVERN_FULL,
      '\u0422\u0440\u0430\u043a\u0442\u0438\u0440 \"\u0420\u044b\u0431\u0438\u0439 \u0433\u043b\u0430\u0437\"',
      FISH_EYE_TAVERN_PLAIN,
      FISH_EYE_TAVERN_PLAIN.toLowerCase(),
    ],
    nextTexts: [DESCEND, DESCEND.toLowerCase()],
    retries: 4,
  });

  await performStep(page, {
    stepName: DESCEND,
    currentTexts: [
      DESCEND,
      DESCEND.toLowerCase(),
      '\u0421\u043f\u0443\u0441\u0442\u0438\u0442\u044c\u0441\u044f',
      '\u0441\u043f\u0443\u0441\u0442\u0438\u0442\u044c\u0441\u044f',
      '\u041d\u0430 \u0430\u0440\u0435\u043d\u0443',
      '\u043d\u0430 \u0430\u0440\u0435\u043d\u0443',
    ],
    retries: 4,
  });
}

async function runFishEyeFight(page) {
  console.log('Fish Eye quest: fight start');

  // HP проверяем ДО спуска на арену, а не на ней самой: с арены уйти нельзя (см. preTripHpGate).
  // Гейт ниже, на самой арене, оставлен - он ловит случай, когда HP просело уже по дороге.
  if (!(await preTripHpGate(page, 'Рыбий глаз: до спуска на арену'))) return false;

  await runFishEyeRouteToArena(page);

  // The arena has its own in-game cooldown ("\u0412\u044b \u0432\u043e\u0441\u0441\u0442\u0430\u043d\u0430\u0432\u043b\u0438\u0432\u0430\u0435\u0442\u0435 \u0441\u0438\u043b\u044b. \u0412\u043e\u0437\u0432\u0440\u0430\u0449\u0430\u0439\u0442\u0435\u0441\u044c \u0447\u0435\u0440\u0435\u0437
  // N \u043c\u0438\u043d.") independent of our internal 25-minute timer, which can drift out of sync. Detect
  // it and reschedule cleanly instead of failing to find "\u0412 \u0431\u043e\u0439!" and erroring out.
  const arenaText = await getBodyText(page);
  const cooldownMatch = arenaText.match(/\u0412\u043e\u0437\u0432\u0440\u0430\u0449\u0430\u0439\u0442\u0435\u0441\u044c \u0447\u0435\u0440\u0435\u0437\s+(\d+)\s*\u043c\u0438\u043d/i);
  if (cooldownMatch) {
    const waitMinutes = Number(cooldownMatch[1]) || 1;
    console.log(`Fish Eye quest: \u0430\u0440\u0435\u043d\u0430 \u0435\u0449\u0451 \u043d\u0430 \u043a\u0443\u043b\u0434\u0430\u0443\u043d\u0435 ${waitMinutes} \u043c\u0438\u043d -> \u043e\u0442\u043a\u043b\u0430\u0434\u044b\u0432\u0430\u044e \u043f\u043e\u043f\u044b\u0442\u043a\u0443`);
    S.lastFishEyeRunAt = Date.now() + waitMinutes * 60 * 1000 - FISH_EYE_INTERVAL_MS;
    persistDailyQuestState();
    await clickByTexts(page, ['\u0412\u0435\u0440\u043d\u0443\u0442\u044c\u0441\u044f', '\u0432\u0435\u0440\u043d\u0443\u0442\u044c\u0441\u044f'], '\u0412\u0435\u0440\u043d\u0443\u0442\u044c\u0441\u044f').catch(() => {});
    return false;
  }

  // Another real in-game message, distinct from the per-fight cooldown above: "\u041c\u044b \u0431\u0435\u0440\u0435\u0436\u0435\u043c \u0441\u0432\u043e\u0438\u0445
  // \u0431\u043e\u0439\u0446\u043e\u0432, \u043f\u0440\u0438\u0445\u043e\u0434\u0438 \u0437\u0430\u0432\u0442\u0440\u0430" means today's fights AND the reward claim
  // are both already used up (our local counters drifted out of sync with the server, e.g. after a
  // restart). Sync our counters to that reality instead of erroring out and doing an unneeded city trip.
  const dailyLimitReached = /\u041c\u044b\s+\u0431\u0435\u0440\u0435\u0436\u0435\u043c\s+\u0441\u0432\u043e\u0438\u0445\s+\u0431\u043e\u0439\u0446\u043e\u0432/i.test(arenaText);
  if (dailyLimitReached) {
    console.log('Fish Eye quest: \u0432 \u0438\u0433\u0440\u0435 \u043b\u0438\u043c\u0438\u0442 \u043d\u0430 \u0441\u0435\u0433\u043e\u0434\u043d\u044f \u0443\u0436\u0435 \u0438\u0441\u0447\u0435\u0440\u043f\u0430\u043d ("\u041c\u044b \u0431\u0435\u0440\u0435\u0436\u0435\u043c \u0441\u0432\u043e\u0438\u0445 \u0431\u043e\u0439\u0446\u043e\u0432") -> \u043e\u0442\u043a\u043b\u0430\u0434\u044b\u0432\u0430\u044e \u0434\u043e \u0437\u0430\u0432\u0442\u0440\u0430');
    syncFishEyeDayState();
    S.fishEyeFightsToday = FISH_EYE_DAILY_FIGHT_LIMIT;
    S.fishEyeRewardClaimedToday = true;
    S.lastFishEyeRunAt = Date.now();
    persistDailyQuestState();
    await clickByTexts(page, ['\u0423\u0439\u0442\u0438', '\u0443\u0439\u0442\u0438', '\u0412\u0435\u0440\u043d\u0443\u0442\u044c\u0441\u044f', '\u0432\u0435\u0440\u043d\u0443\u0442\u044c\u0441\u044f'], '\u0423\u0439\u0442\u0438').catch(() => {});
    return false;
  }

  // Arena requires at least 1 reserve to fight: "\u041d\u0435\u043e\u0431\u0445\u043e\u0434\u0438\u043c\u043e \u0438\u043c\u0435\u0442\u044c \u0445\u043e\u0442\u044f \u0431\u044b \u0435\u0434\u0438\u043d\u0438\u0446\u0443 \u0440\u0435\u0437\u0435\u0440\u0432\u043e\u0432".
  // Reserve regenerates over time, so just defer this fight (~15 min) instead of erroring out and
  // doing an unneeded city trip.
  const noReserve = /\u041d\u0435\u043e\u0431\u0445\u043e\u0434\u0438\u043c\u043e\s+\u0438\u043c\u0435\u0442\u044c\s+\u0445\u043e\u0442\u044f\s+\u0431\u044b\s+\u0435\u0434\u0438\u043d\u0438\u0446\u0443\s+\u0440\u0435\u0437\u0435\u0440\u0432\u043e\u0432/i.test(arenaText);
  if (noReserve) {
    console.log('Fish Eye quest: \u043d\u0435\u0442 \u0440\u0435\u0437\u0435\u0440\u0432\u043e\u0432 \u0434\u043b\u044f \u0431\u043e\u044f ("\u041d\u0435\u043e\u0431\u0445\u043e\u0434\u0438\u043c\u043e \u0438\u043c\u0435\u0442\u044c \u0445\u043e\u0442\u044f \u0431\u044b \u0435\u0434\u0438\u043d\u0438\u0446\u0443 \u0440\u0435\u0437\u0435\u0440\u0432\u043e\u0432") -> \u043e\u0442\u043a\u043b\u0430\u0434\u044b\u0432\u0430\u044e \u043d\u0430 15 \u043c\u0438\u043d');
    S.lastFishEyeRunAt = Date.now() + 15 * 60 * 1000 - FISH_EYE_INTERVAL_MS;
    persistDailyQuestState();
    await clickByTexts(page, ['\u0412\u0435\u0440\u043d\u0443\u0442\u044c\u0441\u044f', '\u0432\u0435\u0440\u043d\u0443\u0442\u044c\u0441\u044f', '\u0423\u0439\u0442\u0438', '\u0443\u0439\u0442\u0438'], '\u0412\u0435\u0440\u043d\u0443\u0442\u044c\u0441\u044f').catch(() => {});
    return false;
  }

  // 18.09.2026: \u0432\u043c\u0435\u0441\u0442\u043e \u0430\u0440\u0435\u043d\u044b - \u044d\u043a\u0440\u0430\u043d \u043d\u0430\u0433\u0440\u0430\u0434\u044b ("\u041c\u043e\u043b\u043e\u0434\u0446\u043e\u043c! \u0417\u0430\u0433\u0440\u0435\u0431\u0430\u0439 \u0434\u043e\u0431\u044b\u0447\u0443... \u041f\u043e\u043b\u0443\u0447\u0435\u043d\u043e 100 \u0434\u0438\u043d,
  // \u044d\u043b\u044c"). \u0411\u043e\u0439 \u0443\u0436\u0435 \u0432\u044b\u0438\u0433\u0440\u0430\u043d \u0440\u0430\u043d\u044c\u0448\u0435 (\u0435\u0433\u043e \u0434\u043e\u0432\u0451\u043b \u043e\u0431\u0440\u0430\u0431\u043e\u0442\u0447\u0438\u043a \u0432\u0438\u0441\u044f\u0449\u0435\u0433\u043e \u0431\u043e\u044f), \u0437\u0434\u0435\u0441\u044c \u0442\u043e\u043b\u044c\u043a\u043e \u0438\u0442\u043e\u0433. \u041a\u043e\u0434
  // \u0438\u0441\u043a\u0430\u043b "\u0412 \u0431\u043e\u0439!", \u043d\u0435 \u043d\u0430\u0445\u043e\u0434\u0438\u043b \u0438 \u0443\u0445\u043e\u0434\u0438\u043b \u0432 \u043e\u0448\u0438\u0431\u043a\u0443 \u0441 \u0430\u0432\u0430\u0440\u0438\u0439\u043d\u044b\u043c \u0432\u043e\u0437\u0432\u0440\u0430\u0442\u043e\u043c \u0432 \u0433\u043e\u0440\u043e\u0434.
  if (/\u0417\u0430\u0433\u0440\u0435\u0431\u0430\u0439 \u0434\u043e\u0431\u044b\u0447\u0443|\u041f\u043e\u043b\u0443\u0447\u0435\u043d\u043e\s+\d+\s+\u0434\u0438\u043d/i.test(arenaText)) {
    console.log('Fish Eye quest: \u0431\u043e\u0439 \u0443\u0436\u0435 \u0432\u044b\u0438\u0433\u0440\u0430\u043d, \u043d\u0430 \u044d\u043a\u0440\u0430\u043d\u0435 \u043d\u0430\u0433\u0440\u0430\u0434\u0430 -> \u0437\u0430\u0441\u0447\u0438\u0442\u044b\u0432\u0430\u044e \u0438 \u0443\u0445\u043e\u0436\u0443.');
    await clickByTexts(page, ['\u0423\u0439\u0442\u0438', '\u0443\u0439\u0442\u0438', '\u0412\u0435\u0440\u043d\u0443\u0442\u044c\u0441\u044f', '\u0432\u0435\u0440\u043d\u0443\u0442\u044c\u0441\u044f'], '\u0423\u0439\u0442\u0438 (\u043f\u043e\u0441\u043b\u0435 \u043d\u0430\u0433\u0440\u0430\u0434\u044b)').catch(() => {});
    S.lastFishEyeRunAt = Date.now();
    syncFishEyeDayState();
    S.fishEyeFightsToday += 1;
    persistDailyQuestState();
    return true;
  }

  // \u0411\u043e\u0439 \u043d\u0430 \u0430\u0440\u0435\u043d\u0435 \u0434\u043e\u0431\u0440\u043e\u0432\u043e\u043b\u044c\u043d\u044b\u0439 \u0438 \u043c\u0430\u0440\u0448\u0440\u0443\u0442\u0430 \u043f\u043e\u0441\u043b\u0435 \u0441\u0435\u0431\u044f \u043d\u0435 \u0442\u044f\u043d\u0435\u0442 - \u0437\u0434\u0435\u0441\u044c \u0434\u043e\u0441\u0442\u0430\u0442\u043e\u0447\u043d\u043e \u043e\u0431\u044b\u0447\u043d\u043e\u0433\u043e
  // \u043e\u0442\u043a\u0430\u0437\u0430 (\u0432\u0435\u0440\u043d\u0451\u043c\u0441\u044f \u0432 \u0441\u043b\u0435\u0434\u0443\u044e\u0449\u0435\u043c \u0446\u0438\u043a\u043b\u0435), \u0436\u0434\u0430\u0442\u044c \u043f\u043e\u0434\u043b\u0435\u0447\u0438\u0432\u0430\u043d\u0438\u044f \u043f\u0440\u044f\u043c\u043e \u0432 \u0430\u0440\u0435\u043d\u0435 \u0441\u043c\u044b\u0441\u043b\u0430 \u043d\u0435\u0442.
  if (!(await questFightHpGate(page, '\u0420\u044b\u0431\u0438\u0439 \u0433\u043b\u0430\u0437: \u0430\u0440\u0435\u043d\u0430'))) return false;

  // Some fights start immediately after descending to the arena.
  if (!await existsAnyText(page, ['\u0423\u0434\u0430\u0440\u0438\u0442\u044c', '\u0443\u0434\u0430\u0440\u0438\u0442\u044c'])) {
    await performStep(page, {
      stepName: '\u0412 \u0431\u043e\u0439!',
      currentTexts: ['\u0412 \u0431\u043e\u0439!', '\u0432 \u0431\u043e\u0439!', '\u0412 \u0431\u043e\u0439', '\u0432 \u0431\u043e\u0439'],
      retries: 4,
    });
  }

  await fightLoop(page);

  S.lastFishEyeRunAt = Date.now();
  syncFishEyeDayState();
  S.fishEyeFightsToday += 1;
  persistDailyQuestState();

  console.log(`Fish Eye quest: fight done (${S.fishEyeFightsToday}/${FISH_EYE_DAILY_FIGHT_LIMIT} today)`);
  return true;
}

async function tryClaimFishEyeReward(page) {
  console.log('Fish Eye quest: reward attempt start');

  await runFishEyeRouteToArena(page);

  // 11th visit: descending to arena should grant reward. We don't know the exact UI,
  // so we avoid starting another fight and try to exit back to the game.
  if (await existsAnyText(page, ['\u0412 \u0431\u043e\u0439!', '\u0412 \u0431\u043e\u0439', '\u0432 \u0431\u043e\u0439!'])) {
    console.log('Fish Eye quest: looks like a fight is available; reward UI not detected.');
    return false;
  }

  const exitClicked = await clickByTexts(
    page,
    ['\u0412 \u0438\u0433\u0440\u0443', '\u0432 \u0438\u0433\u0440\u0443', '\u0412\u0435\u0440\u043d\u0443\u0442\u044c\u0441\u044f', '\u0432\u0435\u0440\u043d\u0443\u0442\u044c\u0441\u044f'],
    'Fish Eye reward exit',
  );

  if (exitClicked) {
    await pause(page, 800, 1600);
  }

  syncFishEyeDayState();
  S.fishEyeRewardClaimedToday = true;
  persistDailyQuestState();
  console.log('Fish Eye quest: reward claimed (assumed)');
  return true;
}

async function runDrabasQuest(page) {
  const QUEST_NAME = '\u041a\u0430\u043c\u043d\u0438 \u0414\u0440\u0430\u0431\u0430\u0441\u0430';

  if (!canRunDrabasNow()) {
    return false;
  }

  if (!await existsAnyText(page, [QUEST_NAME])) {
    return false;
  }

  const infoClicked = await clickInfoForQuest(page, QUEST_NAME);
  if (!infoClicked) {
    console.log('Could not open Drabas quest info.');
    return false;
  }

  await performStep(page, {
    stepName: '\u0412 \u0433\u043e\u0440\u044b',
    currentTexts: ['\u0412 \u0433\u043e\u0440\u044b', '\u0432 \u0433\u043e\u0440\u044b'],
    waitAfterClickMs: 7000,
    retries: 3,
  });

  if (await existsAnyText(page, ['\u0412 \u043f\u0443\u0442\u0438', '\u0432 \u043f\u0443\u0442\u0438'])) {
    await clickByTexts(page, ['\u0412 \u043f\u0443\u0442\u0438', '\u0432 \u043f\u0443\u0442\u0438'], '\u0412 \u043f\u0443\u0442\u0438');
    await pause(page, 800, 1600);
  }

  await performStep(page, {
    stepName: '\u0418\u0441\u043a\u0430\u0442\u044c \u043a\u0430\u043c\u043d\u0438 \u0414\u0440\u0430\u0431\u0430\u0441\u0430',
    currentTexts: [
      '\u0418\u0441\u043a\u0430\u0442\u044c \u043a\u0430\u043c\u043d\u0438 \u0414\u0440\u0430\u0431\u0430\u0441\u0430',
      '\u0438\u0441\u043a\u0430\u0442\u044c \u043a\u0430\u043c\u043d\u0438 \u0434\u0440\u0430\u0431\u0430\u0441\u0430',
    ],
    retries: 4,
  });

  await performStep(page, {
    stepName: '\u041d\u0430\u043f\u0430\u0441\u0442\u044c',
    currentTexts: ['\u041d\u0430\u043f\u0430\u0441\u0442\u044c', '\u043d\u0430\u043f\u0430\u0441\u0442\u044c'],
    retries: 4,
  });

  if (!(await questFightHpGate(page, '\u041a\u0430\u043c\u043d\u0438 \u0414\u0440\u0430\u0431\u0430\u0441\u0430'))) return false;

  await performStep(page, {
    stepName: '\u0412 \u0431\u043e\u0439!',
    currentTexts: ['\u0412 \u0431\u043e\u0439!', '\u0432 \u0431\u043e\u0439!', '\u0412 \u0431\u043e\u0439', '\u0432 \u0431\u043e\u0439'],
    retries: 4,
  });

  await fightLoop(page);

  S.lastDrabasRunAt = Date.now();
  syncDrabasDayState();
  S.drabasRunsToday += 1;
  persistDailyQuestState();
  console.log(`Drabas quest: done (${S.drabasRunsToday}/${DRABAS_DAILY_LIMIT} today)`);

  if (await existsAnyText(page, ['\u0412 \u0438\u0433\u0440\u0443', '\u0432 \u0438\u0433\u0440\u0443'])) {
    await clickByTexts(page, ['\u0412 \u0438\u0433\u0440\u0443', '\u0432 \u0438\u0433\u0440\u0443'], '\u0412 \u0438\u0433\u0440\u0443 (after Drabas)');
    await pause(page, 800, 1600);
  }

  return true;
}

async function progressRumaForgeQuest(page, { questCount } = {}) {
  const QUEST = '\u041a\u0443\u0437\u043d\u0438\u0446\u0430 \u0420\u0443\u043c\u0430';

  const today = getDayKeyNow();
  if (S.rumaForgeDayKey !== today) {
    S.rumaForgeDayKey = today;
    S.rumaForgeDoneToday = false;
  }
  if (S.rumaForgeDoneToday) {
    return false;
  }

  if (!await existsAnyText(page, [QUEST])) {
    return false;
  }

  const infoClicked = await clickInfoForQuest(page, QUEST);
  if (!infoClicked) {
    console.log('Could not open Ruma forge quest info.');
    return false;
  }

  // Main path (best-effort: if a step is missing we assume we're already past it).
  const travelText = '\u041a \u043c\u0435\u0441\u0442\u0443 \u0432\u044b\u043f\u043e\u043b\u043d\u0435\u043d\u0438\u044f';
  await tryPerformStepOptional(page, {
    stepName: travelText,
    currentTexts: [travelText, travelText.toLowerCase()],
    waitAfterClickMs: 7000,
  });

  // "\u0412 \u043f\u0443\u0442\u0438" \u2014 \u044d\u043a\u0440\u0430\u043d \u043f\u0443\u0442\u0435\u0448\u0435\u0441\u0442\u0432\u0438\u044f, \u043f\u0435\u0440\u0435\u0435\u0437\u0434 \u043d\u0435 \u043c\u0433\u043d\u043e\u0432\u0435\u043d\u043d\u044b\u0439. \u041a\u043b\u0438\u043a\u0430\u0435\u043c \u043f\u043e\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0435\u043d\u0438\u0435 \u0438 \u0436\u0434\u0451\u043c \u0434\u043e 30 \u0441\u0435\u043a,
  // \u043f\u043e\u043a\u0430 \u043d\u0435 \u043f\u043e\u044f\u0432\u0438\u0442\u0441\u044f "\u041f\u0440\u0438\u0441\u0442\u0430\u043d\u044c" (\u0441\u043b\u0435\u0434\u0443\u044e\u0449\u0438\u0439 \u0440\u0435\u0430\u043b\u044c\u043d\u044b\u0439 \u0448\u0430\u0433), \u043e\u0431\u0440\u0430\u0431\u0430\u0442\u044b\u0432\u0430\u044f \u043f\u043e\u0432\u0442\u043e\u0440\u044b "\u0412 \u043f\u0443\u0442\u0438 \u0435\u0449\u0435".
  // \u0411\u0435\u0437 \u044d\u0442\u043e\u0433\u043e \u043c\u0430\u0440\u0448\u0440\u0443\u0442 \u0438\u043d\u043e\u0433\u0434\u0430 \u0448\u0451\u043b \u0434\u0430\u043b\u044c\u0448\u0435 \u043d\u0430 \u0435\u0449\u0451-\u0435\u0434\u0443\u0449\u0435\u0439 \u0441\u0442\u0440\u0430\u043d\u0438\u0446\u0435, \u043d\u0435 \u043d\u0430\u0445\u043e\u0434\u0438\u043b \u041f\u0440\u0438\u0441\u0442\u0430\u043d\u044c, \u0438 \u0432\u0441\u0435
  // \u043f\u043e\u0441\u043b\u0435\u0434\u0443\u044e\u0449\u0438\u0435 \u043e\u043f\u0446\u0438\u043e\u043d\u0430\u043b\u044c\u043d\u044b\u0435 \u0448\u0430\u0433\u0438 \u043c\u043e\u043b\u0447\u0430 \u043f\u0440\u043e\u043f\u0443\u0441\u043a\u0430\u043b\u0438\u0441\u044c -> fightLoop \u043a\u0440\u0443\u0442\u0438\u043b\u0441\u044f \u0432\u0445\u043e\u043b\u043e\u0441\u0442\u0443\u044e.
  await tryPerformStepOptional(page, {
    stepName: '\u0412 \u043f\u0443\u0442\u0438',
    currentTexts: ['\u0412 \u043f\u0443\u0442\u0438 \u0435\u0449\u0435', '\u0432 \u043f\u0443\u0442\u0438 \u0435\u0449\u0435', '\u0412 \u043f\u0443\u0442\u0438 \u0435\u0449\u0451', '\u0432 \u043f\u0443\u0442\u0438 \u0435\u0449\u0451', '\u0412 \u043f\u0443\u0442\u0438', '\u0432 \u043f\u0443\u0442\u0438'],
    nextTexts: ['\u041f\u0440\u0438\u0441\u0442\u0430\u043d\u044c', '\u043f\u0440\u0438\u0441\u0442\u0430\u043d\u044c'],
    waitForNextMs: 30000,
  });

  await tryPerformStepOptional(page, {
    stepName: '\u041f\u0440\u0438\u0441\u0442\u0430\u043d\u044c',
    currentTexts: ['\u041f\u0440\u0438\u0441\u0442\u0430\u043d\u044c', '\u043f\u0440\u0438\u0441\u0442\u0430\u043d\u044c'],
  });

  await tryPerformStepOptional(page, {
    stepName: '\u0412\u0437\u044f\u0442\u044c \u043b\u043e\u0434\u043a\u0443 \u0434\u043e \u043e\u0441\u0442\u0440\u043e\u0432\u0430 \u0413\u043b\u0438\u043d\u0431\u0430\u0433 \u0437\u0430 15 \u0434\u0438\u043d',
    currentTexts: [
      '\u0412\u0437\u044f\u0442\u044c \u043b\u043e\u0434\u043a\u0443 \u0434\u043e \u043e\u0441\u0442\u0440\u043e\u0432\u0430 \u0413\u043b\u0438\u043d\u0431\u0430\u0433 \u0437\u0430 15 \u0434\u0438\u043d',
      '\u0412\u0437\u044f\u0442\u044c \u043b\u043e\u0434\u043a\u0443 \u0434\u043e \u043e\u0441\u0442\u0440\u043e\u0432\u0430 \u0413\u043b\u0438\u043d\u0431\u0430\u0433',
      '\u0432\u0437\u044f\u0442\u044c \u043b\u043e\u0434\u043a\u0443 \u0434\u043e \u043e\u0441\u0442\u0440\u043e\u0432\u0430 \u0433\u043b\u0438\u043d\u0431\u0430\u0433',
    ],
  });

  await tryPerformStepOptional(page, {
    stepName: '\u0414\u0430\u043b\u0435\u0435',
    currentTexts: ['\u0414\u0430\u043b\u0435\u0435', '\u0434\u0430\u043b\u0435\u0435'],
  });

  await tryPerformStepOptional(page, {
    stepName: '\u0412\u044b\u0439\u0442\u0438 \u043d\u0430 \u043d\u0430\u0431\u0435\u0440\u0435\u0436\u043d\u0443\u044e',
    currentTexts: ['\u0412\u044b\u0439\u0442\u0438 \u043d\u0430 \u043d\u0430\u0431\u0435\u0440\u0435\u0436\u043d\u0443\u044e', '\u0432\u044b\u0439\u0442\u0438 \u043d\u0430 \u043d\u0430\u0431\u0435\u0440\u0435\u0436\u043d\u0443\u044e'],
  });

  async function stepMany(text, count) {
    for (let i = 0; i < count; i++) {
      const ok = await tryPerformStepOptional(page, {
        stepName: `${text} (${i + 1}/${count})`,
        currentTexts: [text, text.toLowerCase()],
      });

      if (!ok) {
        // If the step isn't present, assume we're already past this part.
        break;
      }
    }
  }

  await stepMany('\u0418\u0434\u0442\u0438 \u043d\u0430 \u0441\u0435\u0432\u0435\u0440', 2);
  await stepMany('\u0418\u0434\u0442\u0438 \u043d\u0430 \u0432\u043e\u0441\u0442\u043e\u043a', 4);
  await stepMany('\u0418\u0434\u0442\u0438 \u043d\u0430 \u044e\u0433', 3);
  await stepMany('\u0418\u0434\u0442\u0438 \u043d\u0430 \u0437\u0430\u043f\u0430\u0434', 1);
  await stepMany('\u0418\u0434\u0442\u0438 \u043d\u0430 \u044e\u0433', 3);
  await stepMany('\u0418\u0434\u0442\u0438 \u043d\u0430 \u0437\u0430\u043f\u0430\u0434', 1);

  await tryPerformStepOptional(page, {
    stepName: '\u0417\u0430\u0439\u0442\u0438 \u0432 \u043a\u0443\u0437\u043d\u0438\u0446\u0443',
    currentTexts: ['\u0417\u0430\u0439\u0442\u0438 \u0432 \u043a\u0443\u0437\u043d\u0438\u0446\u0443', '\u0437\u0430\u0439\u0442\u0438 \u0432 \u043a\u0443\u0437\u043d\u0438\u0446\u0443'],
  });

  await tryPerformStepOptional(page, {
    stepName: '\u041f\u043e \u0440\u0443\u043a\u0430\u043c, \u044f \u0441\u043a\u043e\u0440\u043e \u0432\u0435\u0440\u043d\u0443\u0441\u044c!',
    currentTexts: [
      '\u041f\u043e \u0440\u0443\u043a\u0430\u043c, \u044f \u0441\u043a\u043e\u0440\u043e \u0432\u0435\u0440\u043d\u0443\u0441\u044c!',
      '\u043f\u043e \u0440\u0443\u043a\u0430\u043c, \u044f \u0441\u043a\u043e\u0440\u043e \u0432\u0435\u0440\u043d\u0443\u0441\u044c!',
    ],
  });

  // One fight (Ruma forge quest).
  // Гейт добавлен 17.09.2026 по итогам аудита ПО КОДУ (grep всех fightLoop): этого квеста не
  // было ни в одном продиктованном списке, и бой шёл без единой проверки HP. waitForRecovery -
  // после боя идёт продолжение маршрута (кузница + сдача), бросать его на середине нельзя.
  if (!(await questFightHpGate(page, 'Кузница Рума', QUEST_FIGHT_HP_FLOOR, { waitForRecovery: true }))) return false;
  console.log('Ruma forge quest: fight');

  if (await existsAnyText(page, ['\u0412 \u0431\u043e\u0439!', '\u0432 \u0431\u043e\u0439!', '\u0412 \u0431\u043e\u0439', '\u0432 \u0431\u043e\u0439'])) {
    await performStep(page, {
      stepName: '\u0412 \u0431\u043e\u0439!',
      currentTexts: ['\u0412 \u0431\u043e\u0439!', '\u0432 \u0431\u043e\u0439!', '\u0412 \u0431\u043e\u0439', '\u0432 \u0431\u043e\u0439'],
      retries: 4,
    });
  }

  // If we're already on the fight screen, fightLoop will just start clicking "Ударить".
  await fightLoop(page);

  await pause(page, 800, 1600);

  await performStep(page, {
    stepName: '\u0417\u0430\u0439\u0442\u0438 \u0432 \u043a\u0443\u0437\u043d\u0438\u0446\u0443',
    currentTexts: ['\u0417\u0430\u0439\u0442\u0438 \u0432 \u043a\u0443\u0437\u043d\u0438\u0446\u0443', '\u0437\u0430\u0439\u0442\u0438 \u0432 \u043a\u0443\u0437\u043d\u0438\u0446\u0443'],
    retries: 4,
  });

  await performStep(page, {
    stepName: '\u0412 \u0438\u0433\u0440\u0443',
    currentTexts: ['\u0412 \u0438\u0433\u0440\u0443', '\u0432 \u0438\u0433\u0440\u0443'],
    retries: 4,
  });

  // Verify the quest actually disappeared from the Q menu before marking it done.
  // Several of the steps above are best-effort (tryPerformStepOptional), so a silent
  // failure mid-route must not be recorded as a completed daily quest.
  if (Number.isFinite(questCount) && questCount > 0) {
    const menuOk = await resetToQuestMenu(page, questCount);
    if (menuOk) {
      const qText = await getBodyText(page);
      const names = parseQuestNamesFromQMenuText(qText);
      if (isQuestInMenu(names, QUEST)) {
        console.log('Ruma forge quest: still listed in Q menu after the route -> not marking done, will retry.');
        return false;
      }
    }
  }

  S.rumaForgeDoneToday = true;
  persistDailyQuestState();
  console.log('Ruma forge quest: done today');
  return true;
}

async function progressFisherFoodQuest(page, { questCount } = {}) {
  const QUEST = '\u0415\u0434\u0430 \u0434\u043b\u044f \u0440\u044b\u0431\u0430\u043a\u0430';

  const today = getDayKeyNow();
  if (S.fisherFoodDayKey !== today) {
    S.fisherFoodDayKey = today;
    S.fisherFoodDoneToday = false;
  }
  if (S.fisherFoodDoneToday) {
    return false;
  }

  if (!await existsAnyText(page, [QUEST])) {
    return false;
  }

  const infoClicked = await clickInfoForQuest(page, QUEST);
  if (!infoClicked) {
    console.log('Could not open Fisher Food quest info.');
    return false;
  }

  const travelText = '\u041a \u043c\u0435\u0441\u0442\u0443 \u0432\u044b\u043f\u043e\u043b\u043d\u0435\u043d\u0438\u044f';
  await tryPerformStepOptional(page, {
    stepName: travelText,
    currentTexts: [travelText, travelText.toLowerCase()],
    waitAfterClickMs: 7000,
  });

  if (await existsAnyText(page, ['\u0412 \u043f\u0443\u0442\u0438', '\u0432 \u043f\u0443\u0442\u0438'])) {
    await clickByTexts(page, ['\u0412 \u043f\u0443\u0442\u0438', '\u0432 \u043f\u0443\u0442\u0438'], '\u0412 \u043f\u0443\u0442\u0438');
    await pause(page, 800, 1600);
  }

  await tryPerformStepOptional(page, {
    stepName: '\u0414\u043e\u0439\u0442\u0438 \u0434\u043e \u0434\u0435\u0440\u0435\u0432\u043d\u0438',
    currentTexts: ['\u0414\u043e\u0439\u0442\u0438 \u0434\u043e \u0434\u0435\u0440\u0435\u0432\u043d\u0438', '\u0434\u043e\u0439\u0442\u0438 \u0434\u043e \u0434\u0435\u0440\u0435\u0432\u043d\u0438'],
  });

  await tryPerformStepOptional(page, {
    stepName: '\u0412\u0437\u044f\u0442\u044c \u0435\u0434\u0443',
    currentTexts: ['\u0412\u0437\u044f\u0442\u044c \u0435\u0434\u0443', '\u0432\u0437\u044f\u0442\u044c \u0435\u0434\u0443'],
  });

  await tryPerformStepOptional(page, {
    stepName: '\u0423\u0439\u0442\u0438',
    currentTexts: ['\u0423\u0439\u0442\u0438', '\u0443\u0439\u0442\u0438'],
  });

  // Deliver: Конь -> Ивовое озеро -> path -> hut -> give food -> leave.
  await tryPerformStepOptional(page, {
    stepName: '\u041a\u043e\u043d\u044c',
    currentTexts: ['\u041a\u043e\u043d\u044c', '\u043a\u043e\u043d\u044c'],
  });

  await tryPerformStepOptional(page, {
    stepName: '\u00bb \u0418\u0432\u043e\u0432\u043e\u0435 \u043e\u0437\u0435\u0440\u043e',
    currentTexts: ['\u00bb \u0418\u0432\u043e\u0432\u043e\u0435 \u043e\u0437\u0435\u0440\u043e', '\u0418\u0432\u043e\u0432\u043e\u0435 \u043e\u0437\u0435\u0440\u043e', '\u0438\u0432\u043e\u0432\u043e\u0435 \u043e\u0437\u0435\u0440\u043e'],
    waitAfterClickMs: 7000,
  });

  // \u0416\u0434\u0451\u043c \u0437\u0430\u0432\u0435\u0440\u0448\u0435\u043d\u0438\u044f \u043f\u0435\u0440\u0435\u0435\u0437\u0434\u0430 \u043a \u0418\u0432\u043e\u0432\u043e\u043c\u0443 \u043e\u0437\u0435\u0440\u0443: \u043a\u043b\u0438\u043a\u0430\u0435\u043c "\u0412 \u043f\u0443\u0442\u0438" \u0438 \u0436\u0434\u0451\u043c \u0434\u043e 30 \u0441\u0435\u043a \u043f\u043e\u044f\u0432\u043b\u0435\u043d\u0438\u044f \u043f\u0435\u0440\u0432\u043e\u0433\u043e
  // \u0448\u0430\u0433\u0430 \u0434\u043e\u0441\u0442\u0430\u0432\u043a\u0438 ("\u0418\u0434\u0442\u0438 \u043d\u0430 \u0437\u0430\u043f\u0430\u0434"/"\u0412\u043e\u0439\u0442\u0438 \u0432 \u043b\u0430\u0447\u0443\u0433\u0443"). \u0411\u0435\u0437 \u044d\u0442\u043e\u0433\u043e \u0434\u043e\u0441\u0442\u0430\u0432\u043a\u0430 \u043c\u043e\u043b\u0447\u0430 \u043f\u0440\u043e\u043f\u0443\u0441\u043a\u0430\u043b\u0430\u0441\u044c, \u0430
  // \u043a\u0432\u0435\u0441\u0442 \u043e\u0448\u0438\u0431\u043e\u0447\u043d\u043e \u043f\u043e\u043c\u0435\u0447\u0430\u043b\u0441\u044f done (\u0435\u0434\u0443 \u0432\u0437\u044f\u043b\u0438, \u043d\u043e \u043d\u0435 \u0434\u043e\u043d\u0435\u0441\u043b\u0438).
  await tryPerformStepOptional(page, {
    stepName: '\u0412 \u043f\u0443\u0442\u0438',
    currentTexts: ['\u0412 \u043f\u0443\u0442\u0438 \u0435\u0449\u0435', '\u0432 \u043f\u0443\u0442\u0438 \u0435\u0449\u0435', '\u0412 \u043f\u0443\u0442\u0438 \u0435\u0449\u0451', '\u0432 \u043f\u0443\u0442\u0438 \u0435\u0449\u0451', '\u0412 \u043f\u0443\u0442\u0438', '\u0432 \u043f\u0443\u0442\u0438'],
    nextTexts: ['\u0418\u0434\u0442\u0438 \u043d\u0430 \u0437\u0430\u043f\u0430\u0434', '\u0438\u0434\u0442\u0438 \u043d\u0430 \u0437\u0430\u043f\u0430\u0434', '\u0412\u043e\u0439\u0442\u0438 \u0432 \u043b\u0430\u0447\u0443\u0433\u0443', '\u0432\u043e\u0439\u0442\u0438 \u0432 \u043b\u0430\u0447\u0443\u0433\u0443'],
    waitForNextMs: 30000,
  });

  async function stepManyExact(text, count) {
    for (let i = 0; i < count; i++) {
      const ok = await tryPerformStepOptional(page, {
        stepName: `${text} (${i + 1}/${count})`,
        currentTexts: [text, text.toLowerCase()],
      });
      if (!ok) break;
    }
  }

  await stepManyExact('\u0418\u0434\u0442\u0438 \u043d\u0430 \u0437\u0430\u043f\u0430\u0434', 1);
  await stepManyExact('\u0418\u0434\u0442\u0438 \u043d\u0430 \u044e\u0433', 3);
  await stepManyExact('\u0418\u0434\u0442\u0438 \u043d\u0430 \u0437\u0430\u043f\u0430\u0434', 2);

  await tryPerformStepOptional(page, {
    stepName: '\u0412\u043e\u0439\u0442\u0438 \u0432 \u043b\u0430\u0447\u0443\u0433\u0443',
    currentTexts: ['\u0412\u043e\u0439\u0442\u0438 \u0432 \u043b\u0430\u0447\u0443\u0433\u0443', '\u0432\u043e\u0439\u0442\u0438 \u0432 \u043b\u0430\u0447\u0443\u0433\u0443'],
  });

  const gaveFood = await tryPerformStepOptional(page, {
    stepName: '\u041e\u0442\u0434\u0430\u0442\u044c \u0435\u0434\u0443',
    currentTexts: ['\u041e\u0442\u0434\u0430\u0442\u044c \u0435\u0434\u0443', '\u043e\u0442\u0434\u0430\u0442\u044c \u0435\u0434\u0443'],
  });

  await tryPerformStepOptional(page, {
    stepName: '\u0423\u0439\u0442\u0438',
    currentTexts: ['\u0423\u0439\u0442\u0438', '\u0443\u0439\u0442\u0438'],
  });

  if (await existsAnyText(page, ['\u0412 \u0438\u0433\u0440\u0443', '\u0432 \u0438\u0433\u0440\u0443'])) {
    await clickByTexts(page, ['\u0412 \u0438\u0433\u0440\u0443', '\u0432 \u0438\u0433\u0440\u0443'], '\u0412 \u0438\u0433\u0440\u0443 (after Fisher Food)');
    await pause(page, 800, 1600);
  }

  // \u0415\u0441\u043b\u0438 "\u041e\u0442\u0434\u0430\u0442\u044c \u0435\u0434\u0443" \u043d\u0435 \u043d\u0430\u0448\u043b\u043e\u0441\u044c \u2014 \u0434\u043e\u0441\u0442\u0430\u0432\u043a\u0430 \u043d\u0435 \u0434\u043e\u0448\u043b\u0430 (\u0435\u0434\u0443 \u0432\u0437\u044f\u043b\u0438, \u043d\u043e \u043d\u0435 \u0434\u043e\u043d\u0435\u0441\u043b\u0438). \u041d\u0435 \u043f\u043e\u043c\u0435\u0447\u0430\u0435\u043c done,
  // \u043f\u043e\u0432\u0442\u043e\u0440\u0438\u043c \u0432 \u0441\u043b\u0435\u0434\u0443\u044e\u0449\u0435\u043c \u0446\u0438\u043a\u043b\u0435.
  if (!gaveFood) {
    console.log('Fisher Food quest: \u043d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u043e\u0442\u0434\u0430\u0442\u044c \u0435\u0434\u0443 (\u0434\u043e\u0441\u0442\u0430\u0432\u043a\u0430 \u043d\u0435 \u0434\u043e\u0448\u043b\u0430) -> \u043d\u0435 \u043e\u0442\u043c\u0435\u0447\u0430\u044e done, \u043f\u043e\u0432\u0442\u043e\u0440 \u043f\u043e\u0437\u0436\u0435');
    return false;
  }

  // \u0414\u043e\u043f\u043e\u043b\u043d\u0438\u0442\u0435\u043b\u044c\u043d\u0430\u044f \u043f\u0440\u043e\u0432\u0435\u0440\u043a\u0430 (\u043a\u0430\u043a \u0432 \u041a\u0443\u0437\u043d\u0438\u0446\u0435 \u0420\u0443\u043c\u0430): \u043a\u0432\u0435\u0441\u0442 \u0434\u043e\u043b\u0436\u0435\u043d \u0438\u0441\u0447\u0435\u0437\u043d\u0443\u0442\u044c \u0438\u0437 Q-\u043c\u0435\u043d\u044e.
  if (Number.isFinite(questCount) && questCount > 0) {
    const menuOk = await resetToQuestMenu(page, questCount);
    if (menuOk) {
      const names = parseQuestNamesFromQMenuText(await getBodyText(page));
      if (isQuestInMenu(names, QUEST)) {
        console.log('Fisher Food quest: \u0432\u0441\u0451 \u0435\u0449\u0451 \u0432 Q-\u043c\u0435\u043d\u044e \u043f\u043e\u0441\u043b\u0435 \u043c\u0430\u0440\u0448\u0440\u0443\u0442\u0430 -> \u043d\u0435 \u043e\u0442\u043c\u0435\u0447\u0430\u044e done, \u043f\u043e\u0432\u0442\u043e\u0440 \u043f\u043e\u0437\u0436\u0435.');
        return false;
      }
    }
  }

  S.fisherFoodDoneToday = true;
  persistDailyQuestState();
  console.log('Fisher Food quest: done today');
  return true;
}

async function progressCaravanRobberyQuest(page) {
  const QUEST = '\u0413\u0440\u0430\u0431\u0438\u043c \u043a\u043e\u0440\u043e\u0432\u0430\u043d\u044b';

  const today = getDayKeyNow();
  if (S.caravanRobberyDayKey !== today) {
    S.caravanRobberyDayKey = today;
    S.caravanRobberyDoneToday = false;
  }
  if (S.caravanRobberyDoneToday) {
    return false;
  }

  if (!await existsAnyText(page, [QUEST])) {
    return false;
  }

  const infoClicked = await clickInfoForQuest(page, QUEST);
  if (!infoClicked) {
    console.log('Could not open Caravan Robbery quest info.');
    return false;
  }

  // Гейт ДО дороги. 18.09.2026: он стоял после "Я хочу грабить корован!", а этот клик уже
  // запирает в бою (2 охранника, ссылки выхода нет). Гейт отказал на 64%, персонаж остался
  // на экране боя, и следующий цикл всё равно полез драться - вышел живым на 68/380.
  // Отказываться можно только здесь, на карточке задания, пока никуда не пошли.
  if (!(await questFightHpGate(page, '\u0413\u0440\u0430\u0431\u0438\u043c \u043a\u043e\u0440\u043e\u0432\u0430\u043d\u044b'))) return false;

  const travelText = '\u041a \u043c\u0435\u0441\u0442\u0443 \u0432\u044b\u043f\u043e\u043b\u043d\u0435\u043d\u0438\u044f';
  await tryPerformStepOptional(page, {
    stepName: travelText,
    currentTexts: [travelText, travelText.toLowerCase()],
    waitAfterClickMs: 7000,
  });

  if (await existsAnyText(page, ['\u0412 \u043f\u0443\u0442\u0438', '\u0432 \u043f\u0443\u0442\u0438'])) {
    await clickByTexts(page, ['\u0412 \u043f\u0443\u0442\u0438', '\u0432 \u043f\u0443\u0442\u0438'], '\u0412 \u043f\u0443\u0442\u0438');
    await pause(page, 800, 1600);
  }

  await tryPerformStepOptional(page, {
    stepName: '\u041e\u0441\u043c\u043e\u0442\u0440\u0435\u0442\u044c \u0433\u043e\u0440\u0438\u0437\u043e\u043d\u0442',
    currentTexts: ['\u041e\u0441\u043c\u043e\u0442\u0440\u0435\u0442\u044c \u0433\u043e\u0440\u0438\u0437\u043e\u043d\u0442', '\u043e\u0441\u043c\u043e\u0442\u0440\u0435\u0442\u044c \u0433\u043e\u0440\u0438\u0437\u043e\u043d\u0442'],
    nextTexts: ['\u042f \u0445\u043e\u0447\u0443 \u0433\u0440\u0430\u0431\u0438\u0442\u044c \u043a\u043e\u0440\u043e\u0432\u0430\u043d!', '\u044f \u0445\u043e\u0447\u0443 \u0433\u0440\u0430\u0431\u0438\u0442\u044c \u043a\u043e\u0440\u043e\u0432\u0430\u043d!'],
  });

  await tryPerformStepOptional(page, {
    stepName: '\u042f \u0445\u043e\u0447\u0443 \u0433\u0440\u0430\u0431\u0438\u0442\u044c \u043a\u043e\u0440\u043e\u0432\u0430\u043d!',
    currentTexts: ['\u042f \u0445\u043e\u0447\u0443 \u0433\u0440\u0430\u0431\u0438\u0442\u044c \u043a\u043e\u0440\u043e\u0432\u0430\u043d!', '\u044f \u0445\u043e\u0447\u0443 \u0433\u0440\u0430\u0431\u0438\u0442\u044c \u043a\u043e\u0440\u043e\u0432\u0430\u043d!'],
    nextTexts: ['\u0412 \u0431\u043e\u0439!', '\u0432 \u0431\u043e\u0439!'],
  });

  await tryPerformStepOptional(page, {
    stepName: '\u0412 \u0431\u043e\u0439!',
    currentTexts: ['\u0412 \u0431\u043e\u0439!', '\u0432 \u0431\u043e\u0439!', '\u0412 \u0431\u043e\u0439', '\u0432 \u0431\u043e\u0439'],
  });

  await fightLoop(page);

  await tryPerformStepOptional(page, {
    stepName: '\u041e\u0441\u043c\u043e\u0442\u0440\u0435\u0442\u044c \u0433\u043e\u0440\u0438\u0437\u043e\u043d\u0442',
    currentTexts: ['\u041e\u0441\u043c\u043e\u0442\u0440\u0435\u0442\u044c \u0433\u043e\u0440\u0438\u0437\u043e\u043d\u0442', '\u043e\u0441\u043c\u043e\u0442\u0440\u0435\u0442\u044c \u0433\u043e\u0440\u0438\u0437\u043e\u043d\u0442'],
  });

  if (await existsAnyText(page, ['\u0412 \u0438\u0433\u0440\u0443', '\u0432 \u0438\u0433\u0440\u0443'])) {
    await clickByTexts(page, ['\u0412 \u0438\u0433\u0440\u0443', '\u0432 \u0438\u0433\u0440\u0443'], '\u0412 \u0438\u0433\u0440\u0443 (after Caravan Robbery)');
    await pause(page, 800, 1600);
  }

  // \u0420\u0430\u043d\u044c\u0448\u0435 \u0437\u0434\u0435\u0441\u044c \u0431\u0435\u0437\u0443\u0441\u043b\u043e\u0432\u043d\u043e \u0441\u0442\u0430\u0432\u0438\u043b\u0441\u044f caravanRobberyDoneToday = true, \u0434\u0430\u0436\u0435 \u0435\u0441\u043b\u0438 \u0432\u0441\u0435 \u0448\u0430\u0433\u0438
  // \u0432\u044b\u0448\u0435 \u043c\u043e\u043b\u0447\u0430 \u043d\u0438\u0447\u0435\u0433\u043e \u043d\u0435 \u043d\u0430\u0448\u043b\u0438 (tryPerformStepOptional \u043d\u0435 \u0431\u0440\u043e\u0441\u0430\u0435\u0442 \u043e\u0448\u0438\u0431\u043a\u0443) \u2014 \u0442\u043e \u0435\u0441\u0442\u044c \u0444\u043b\u0430\u0433
  // "\u0432\u044b\u043f\u043e\u043b\u043d\u0435\u043d\u043e" \u043c\u043e\u0433 \u0432\u044b\u0441\u0442\u0430\u0432\u0438\u0442\u044c\u0441\u044f \u0431\u0435\u0437 \u0440\u0435\u0430\u043b\u044c\u043d\u043e\u0433\u043e \u0431\u043e\u044f/\u043f\u0440\u043e\u0433\u0440\u0435\u0441\u0441\u0430. \u041f\u0440\u043e\u0432\u0435\u0440\u044f\u0435\u043c \u0447\u0435\u0440\u0435\u0437 Q-\u043c\u0435\u043d\u044e, \u043a\u0430\u043a
  // \u0438 \u0434\u043b\u044f \u0425\u0430\u0440\u0447\u0435\u0432\u043d\u0438/\u0428\u0442\u043e\u043b\u0435\u043d: \u0441\u0447\u0438\u0442\u0430\u0435\u043c done \u0442\u043e\u043b\u044c\u043a\u043e \u0435\u0441\u043b\u0438 \u043a\u0432\u0435\u0441\u0442 \u0440\u0435\u0430\u043b\u044c\u043d\u043e \u043f\u0440\u043e\u043f\u0430\u043b \u0438\u0437 \u0441\u043f\u0438\u0441\u043a\u0430.
  const menuOk = await resetToQuestMenu(page);
  if (menuOk) {
    const qNames = parseQuestNamesFromQMenuText(await getBodyText(page));
    if (isQuestInMenu(qNames, QUEST)) {
      console.log('Caravan Robbery quest: all after fight, but still listed in Q -> NOT marking done, will retry.');
      return true; // \u043f\u0440\u043e\u0433\u0440\u0435\u0441\u0441 \u0431\u044b\u043b (\u0431\u043e\u0439/\u0448\u0430\u0433\u0438), \u043d\u043e \u043d\u0435 \u0441\u0447\u0438\u0442\u0430\u0435\u043c \u0432\u044b\u043f\u043e\u043b\u043d\u0435\u043d\u043d\u044b\u043c \u043d\u0430 \u0441\u0435\u0433\u043e\u0434\u043d\u044f
    }
  }

  S.caravanRobberyDoneToday = true;
  persistDailyQuestState();
  console.log('Caravan Robbery quest: done today');
  return true;
}

async function runFishEyeIfDue(page) {
  let didAnything = false;

  if (canRunFishEyeRewardNow()) {
    const rewardResult = await runNonQQuestSafe(page, 'Fish Eye reward', () => tryClaimFishEyeReward(page));
    if (rewardResult === null) {
      S.lastFishEyeRunAt = Date.now();
    } else if (rewardResult) {
      didAnything = true;
    }
  }

  if (canRunFishEyeFightNow()) {
    const fightResult = await runNonQQuestSafe(page, 'Fish Eye fight', () => runFishEyeFight(page));
    if (fightResult === null) {
      S.lastFishEyeRunAt = Date.now();
    } else if (fightResult) {
      didAnything = true;
    }
  }

  if (didAnything) {
    persistDailyQuestState();
  }

  return didAnything;
}

// ===================================================================================
// "Довольствие" - короткий ежедневный квест без боя, продиктован Пашей 17.09.2026:
// Амулет -> Дорожный крест -> Казначейство Тригмагистрата -> Получить довольствие -> В игру.
// Не проверено вживую (продиктовано по памяти, как Демон озера/Кораблекрушение до первого
// реального прогона) - verify live перед тем как доверять маршруту полностью.
// ===================================================================================
async function progressDovolstvieQuest(page) {
  await clickByTexts(page, ['Амулет', 'Aмулет'], 'Довольствие: Амулет');
  await pause(page, 800, 1200);
  await clickByTexts(page, ['Дорожный крест'], 'Довольствие: Дорожный крест');
  await pause(page, 1500, 2500);

  const treasuryOk = await clickByTexts(page, ['Казначейство Тригмагистрата'], 'Довольствие: Казначейство Тригмагистрата');
  if (!treasuryOk) {
    console.log('Довольствие: "Казначейство Тригмагистрата" не найдено рядом с Дорожным крестом - маршрут не подтверждён, нужна проверка вживую.');
    return false;
  }
  await pause(page, 800, 1200);

  const claimOk = await clickByTexts(page, ['Получить довольствие'], 'Довольствие: Получить довольствие');
  if (!claimOk) {
    console.log('Довольствие: "Получить довольствие" не найдено - возможно, уже получено сегодня или незнакомый экран.');
    return false;
  }
  await pause(page, 800, 1200);

  await tryPerformStepOptional(page, { stepName: 'В игру', currentTexts: ['В игру', 'в игру'] });
  await pause(page, 500, 900);
  return true;
}

async function runDovolstvieIfAvailable(page) {
  const today = getDayKeyNow();
  if (S.dovolstvieDayKey !== today) {
    S.dovolstvieDayKey = today;
    S.dovolstvieDoneToday = false;
    persistDailyQuestState();
  }
  if (S.dovolstvieDoneToday) return false;

  const ok = await runNonQQuestSafe(page, 'Довольствие quest', () => progressDovolstvieQuest(page));
  if (ok) {
    S.dovolstvieDoneToday = true;
    persistDailyQuestState();
  }
  return Boolean(ok);
}
