// Квест "Штольни" (выключен для AI__, см. SHTOLNI_ENABLED_FOR_AI).
// Выделено из ai_char/module.js (там только сборка экспорта). Изменяемое состояние - S из ./state.

// Экспорт стоит ДО require: файлы lib/ вызывают друг друга по кругу, а объявления функций
// всплывают (hoisting), поэтому к моменту любого встречного require все функции уже здесь.
module.exports = {
  progressShtolniQuest,
};

const {
  S, EXCLUSIVE_QUEST_CONFLICT_BACKOFF_MS, EXCLUSIVE_QUEST_ERROR_BACKOFF_MS, getDayKeyNow,
  persistDailyQuestState, SHTOLNI_ENABLED_FOR_AI, SHTOLNI_MIN_HP, SHTOLNI_MIN_HP_FRACTION,
  SHTOLNI_MIN_RESERVE_MINUTES,
} = require('./state');
const { appendDebugSnapshot, getBodyText, parseStats, pause } = require('./core');
const { fightLoop } = require('./fight');
const {
  getHpCurrentSafe, tryPerformStepOptional, waitForHpAbove, waitForReserveAtLeast,
} = require('./hp');
const {
  clickInfoForQuest, isQuestInMenu, openQuestsMenu, parseQuestNamesFromQMenuText, resetToQuestMenu,
} = require('./quest_menu');
const { tryDrinkFestiveAle } = require('./recovery');
const {
  clickByKeywords, clickByNormalizedIncludes, clickByTexts, clickByTextsLoose, existsAnyText,
  performStep,
} = require('./ui');

async function progressShtolniQuest(page) {
  if (!SHTOLNI_ENABLED_FOR_AI) {
    return false;
  }

  const QUEST = '\u0428\u0442\u043e\u043b\u044c\u043d\u0438';
  const CHILD_SEARCH_LINE =
    '\u0416\u0435\u043d\u0449\u0438\u043d\u0430 \u043d\u0430\u043f\u0440\u044f\u0436\u0435\u043d\u043d\u043e \u0432\u0441\u043c\u0430\u0442\u0440\u0438\u0432\u0430\u0435\u0442\u0441\u044f \u0432\u0434\u0430\u043b\u044c, \u043f\u044b\u0442\u0430\u044f\u0441\u044c \u0443\u0432\u0438\u0434\u0435\u0442\u044c \u0441\u0432\u043e\u0435\u0433\u043e \u0440\u0435\u0431\u0435\u043d\u043a\u0430.';
  const WHAT_HAPPENED = [
    '\u0427\u0442\u043e \u0443 \u0432\u0430\u0441 \u0441\u043b\u0443\u0447\u0438\u043b\u043e\u0441\u044c?',
    '\u0427\u0442\u043e \u0443 \u0432\u0430\u0441 \u0441\u043b\u0443\u0447\u0438\u043b\u043e\u0441\u044c',
    '\u0427\u0442\u043e \u0443 \u0432\u0430\u0441',
    '\u0427\u0442\u043e \u0443 \u0412\u0430\u0441',
  ];
  const SURE_HELP = [
    '\u041a\u043e\u043d\u0435\u0447\u043d\u043e \u043f\u043e\u043c\u043e\u0433\u0443! \u0413\u0434\u0435 \u044d\u0442\u0438 \u0448\u0442\u043e\u043b\u044c\u043d\u0438?',
    '\u041a\u043e\u043d\u0435\u0447\u043d\u043e \u043f\u043e\u043c\u043e\u0433\u0443',
    '\u0413\u0434\u0435 \u044d\u0442\u0438 \u0448\u0442\u043e\u043b\u044c\u043d\u0438',
  ];
  const GO_SEARCH = [
    '\u041e\u0442\u043f\u0440\u0430\u0432\u0438\u0442\u044c\u0441\u044f \u043d\u0430 \u043f\u043e\u0438\u0441\u043a\u0438',
    '\u043d\u0430 \u043f\u043e\u0438\u0441\u043a\u0438',
  ];
  const TAKE_QUEST = [
    '\u0412\u0437\u044f\u0442\u044c \u0437\u0430\u0434\u0430\u043d\u0438\u0435',
    '\u0412\u0437\u044f\u0442\u044c \u043a\u0432\u0435\u0441\u0442',
    '\u0412\u0437\u044f\u0442\u044c',
    '\u041f\u0440\u0438\u043d\u044f\u0442\u044c',
    '\u0421\u043e\u0433\u043b\u0430\u0441\u0438\u0442\u044c\u0441\u044f',
  ];

  const today = getDayKeyNow();
  if (S.shtolniDayKey !== today) {
    S.shtolniDayKey = today;
    S.shtolniDoneToday = false;
    S.shtolniTakenToday = false;
    S.shtolniFailStreak = 0;
    S.shtolniSuppressedUntil = 0;
    S.shtolniNoProgressStreak = 0;
    S.shtolniLastStage = '';
    S.shtolniFocusStartedAt = 0;
  }
  if (S.shtolniDoneToday) {
    return false;
  }

  // Global safety gates: user-requested constraints for this quest.
  // Enforced both when starting and when continuing an in-progress quest.
  // AI__ (14.09.2026): порог HP задан не абсолютным числом (у AI__ max HP растёт по мере
  // прокачки), а долей от максимума — SHTOLNI_MIN_HP_FRACTION = 0.9 (90% от hpMax).
  const stats = S.lastCycleStats;
  const reserveMinutes = typeof stats?.reserveMinutes === 'number' ? stats.reserveMinutes : stats?.cooldown;
  const hpCurrent = typeof stats?.hpCurrent === 'number' ? stats.hpCurrent : null;
  const hpMax = typeof stats?.hpMax === 'number' ? stats.hpMax : null;
  const hpThreshold = typeof hpMax === 'number' ? Math.round(hpMax * SHTOLNI_MIN_HP_FRACTION) : null;
  const hpOk = typeof hpCurrent === 'number' && typeof hpThreshold === 'number' && hpCurrent >= hpThreshold;

  if (!hpOk) {
    console.log(`Shtolni gate: need hp>=${hpThreshold ?? 'n/a'} (${SHTOLNI_MIN_HP_FRACTION * 100}% of max); have hp=${hpCurrent ?? 'n/a'}`);
    return false;
  }

  // 14.09.2026 (Паша): "по резерву отмени правило, просто жди сколько нужно, резерв это
  // минуты" — резерв не блокирует попытку насовсем (как раньше, пока не наберётся сам по
  // себе через много обычных циклов драйвера), а активно ожидается прямо здесь, сколько бы
  // это ни заняло. HP уже проверен выше, так что ждать резерв имеет смысл.
  const reserveOk = typeof reserveMinutes === 'number' && reserveMinutes >= SHTOLNI_MIN_RESERVE_MINUTES;
  if (!reserveOk) {
    console.log(`Shtolni gate: reserve=${reserveMinutes ?? 'n/a'} < ${SHTOLNI_MIN_RESERVE_MINUTES} -> жду сколько потребуется.`);
    if (!await waitForReserveAtLeast(page, SHTOLNI_MIN_RESERVE_MINUTES, { waitMs: 5 * 60 * 1000, maxWaits: 2000 })) {
      console.log('Shtolni: не дождался достаточного резерва (превышен предохранитель по числу попыток).');
      return false;
    }
  }

  // 14.09.2026 (Паша): "нужно было просто остаться и продолжить квест" — если на текущей
  // странице уже видна "Продолжить квест" (значит квест реально в процессе, например мы
  // выиграли первый бой и вышли долечиться), используем её напрямую вместо повторного
  // захода через инфо-квеста → "К месту выполнения", который заново прогоняет весь путь по
  // штольням и переигрывает уже пройденный первый бой (баг, приведший ко второму поражению).
  let resumedInPlace = false;
  if (await existsAnyText(page, ['Продолжить квест', 'продолжить квест'])) {
    console.log('Shtolni: "Продолжить квест" уже на текущей странице -> продолжаем на месте, без повторного захода.');
    resumedInPlace = await clickByTexts(
      page,
      ['Продолжить квест', 'продолжить квест'],
      'Продолжить квест (resume in place)'
    );
    if (resumedInPlace) await pause(page, 800, 1600);
  }

  let hadFirstFight = false;
  let hadSecondFight = false;

  if (resumedInPlace) {
    // Предполагаем, что раз квест уже шёл и предлагал прямое продолжение — первый бой уже
    // отыгран (выигран), и мы попадаем сразу в логику развилки "Ждать"/"Ворваться" ниже.
    hadFirstFight = true;
  } else {
  const questExists = await existsAnyText(page, [QUEST]);
  if (!questExists) {
    return false;
  }

  const infoClicked = await clickInfoForQuest(page, QUEST);
  if (!infoClicked) {
    console.log('Could not open Shtolni quest info.');
    return false;
  }

  // Reserve gate for the whole shtolni run: 1st bot + 2nd bot + loot/turn-in after 2nd fight.
  // Do not leave the flow; wait in-place until we have enough reserve.
  if (!await waitForReserveAtLeast(page, SHTOLNI_MIN_RESERVE_MINUTES, { waitMs: 5 * 60 * 1000, maxWaits: 2000 })) {
    console.log('Shtolni quest: reserve gate timed out, stop for now.');
    return false;
  }

  // As soon as we start interacting with the quest, consider it "taken/in progress"
  // to prevent parallel exclusive quest handling.
  S.shtolniTakenToday = true;
  if (!S.shtolniFocusStartedAt) S.shtolniFocusStartedAt = Date.now();

  // 14.09.2026 (Паша): выпить "Праздничный эль" ЗАРАНЕЕ, ещё на экране инфо-квеста, пока мы
  // не зашли в саму пещеру — раньше это делалось прямо перед первым боем, что означало
  // навигацию в inv.php посреди "сцены" подземелья и, видимо, ломало распознавание предмета.
  await tryDrinkFestiveAle(page);

  const textBefore = await getBodyText(page);
  if (/Вы еще не выполнили другое задание/i.test(textBefore)) {
    console.log('Shtolni quest is blocked by another active quest -> backoff and do not mark as in-progress');
    // Do not keep the exclusive lock for a quest that cannot proceed.
    S.shtolniTakenToday = false;
    S.shtolniSuppressedUntil = Date.now() + EXCLUSIVE_QUEST_CONFLICT_BACKOFF_MS;
    S.shtolniFocusStartedAt = 0;
    return false;
  }
  const hasAdvancedMarkerBefore = await existsAnyText(page, [
    ...WHAT_HAPPENED,
    ...SURE_HELP,
    ...GO_SEARCH,
    '\u041e\u0442\u043a\u0440\u044b\u0442\u044c \u0434\u0432\u0435\u0440\u044c',
    '\u041f\u0440\u043e\u0434\u043e\u043b\u0436\u0438\u0442\u044c \u043a\u0432\u0435\u0441\u0442',
    '\u041e\u0442\u043a\u0430\u0437\u0430\u0442\u044c\u0441\u044f',
  ]);

  let progressedIntroOnly = false;

  // Take quest / initial dialog.
  const travelText = '\u041a \u043c\u0435\u0441\u0442\u0443 \u0432\u044b\u043f\u043e\u043b\u043d\u0435\u043d\u0438\u044f';

  // If the quest was reset / not taken yet, some accounts get an explicit "take quest" button first.
  // Try it opportunistically; if it's already taken, nothing happens.
  const tookQuest = await tryPerformStepOptional(page, {
    stepName: TAKE_QUEST[0],
    currentTexts: [...TAKE_QUEST, ...TAKE_QUEST.map((t) => t.toLowerCase())],
    nextTexts: [travelText, travelText.toLowerCase()],
    waitAfterClickMs: 1000,
  });
  if (tookQuest) progressedIntroOnly = true;

  const travelOk = await tryPerformStepOptional(page, {
    stepName: travelText,
    currentTexts: [travelText, travelText.toLowerCase()],
    waitAfterClickMs: 7000,
    nextTexts: ['\u041f\u043e\u0433\u043e\u0432\u043e\u0440\u0438\u0442\u044c \u0441 \u0436\u0435\u043d\u0449\u0438\u043d\u043e\u0439', '\u043f\u043e\u0433\u043e\u0432\u043e\u0440\u0438\u0442\u044c \u0441 \u0436\u0435\u043d\u0449\u0438\u043d\u043e\u0439'],
  });
  if (travelOk) progressedIntroOnly = true;

  if (await existsAnyText(page, ['\u0412 \u043f\u0443\u0442\u0438', '\u0432 \u043f\u0443\u0442\u0438'])) {
    await clickByTexts(page, ['\u0412 \u043f\u0443\u0442\u0438', '\u0432 \u043f\u0443\u0442\u0438'], '\u0412 \u043f\u0443\u0442\u0438');
    await pause(page, 800, 1600);
  }

  const talkOk = await tryPerformStepOptional(page, {
    stepName: '\u041f\u043e\u0433\u043e\u0432\u043e\u0440\u0438\u0442\u044c \u0441 \u0436\u0435\u043d\u0449\u0438\u043d\u043e\u0439',
    currentTexts: ['\u041f\u043e\u0433\u043e\u0432\u043e\u0440\u0438\u0442\u044c \u0441 \u0436\u0435\u043d\u0449\u0438\u043d\u043e\u0439', '\u043f\u043e\u0433\u043e\u0432\u043e\u0440\u0438\u0442\u044c \u0441 \u0436\u0435\u043d\u0449\u0438\u043d\u043e\u0439'],
    waitAfterClickMs: 1800,
    nextTexts: [...WHAT_HAPPENED, ...WHAT_HAPPENED.map((t) => t.toLowerCase())],
  });
  if (talkOk) progressedIntroOnly = true;

  // Some accounts/branches show only the "У ДОРОГИ" description after talking to the woman:
  // "Женщина напряженно всматривается вдаль..." with just an "Уйти" button.
  // This still means the quest is active and must be continued; leave the screen and reopen quest info.
  const sawChildSearchLine = await existsAnyText(page, [CHILD_SEARCH_LINE, CHILD_SEARCH_LINE.toLowerCase()]);
  if (sawChildSearchLine) {
    // If the dialog options are not present yet, do an explicit leave + reopen to get back to the quest step list.
    const hasDialogOptions = await existsAnyText(page, [...WHAT_HAPPENED, ...WHAT_HAPPENED.map((t) => t.toLowerCase())]);
    if (!hasDialogOptions) {
      const leftOk = await tryPerformStepOptional(page, {
        stepName: '\u0423\u0439\u0442\u0438',
        currentTexts: ['\u0423\u0439\u0442\u0438', '\u0443\u0439\u0442\u0438'],
        nextTexts: [
          '\u0418\u0434\u0442\u0438 \u043d\u0430 \u0432\u043e\u0441\u0442\u043e\u043a',
          '\u0438\u0434\u0442\u0438 \u043d\u0430 \u0432\u043e\u0441\u0442\u043e\u043a',
          '\u041f\u0440\u043e\u0434\u043e\u043b\u0436\u0438\u0442\u044c \u043a\u0432\u0435\u0441\u0442',
          '\u043f\u0440\u043e\u0434\u043e\u043b\u0436\u0438\u0442\u044c \u043a\u0432\u0435\u0441\u0442',
        ],
      });
      if (leftOk) progressedIntroOnly = true;
    }
  }

  await tryPerformStepOptional(page, {
    stepName: WHAT_HAPPENED[0],
    currentTexts: [...WHAT_HAPPENED, ...WHAT_HAPPENED.map((t) => t.toLowerCase())],
    nextTexts: [...SURE_HELP, ...SURE_HELP.map((t) => t.toLowerCase())],
  });

  await tryPerformStepOptional(page, {
    stepName: SURE_HELP[0],
    currentTexts: [...SURE_HELP, ...SURE_HELP.map((t) => t.toLowerCase())],
    nextTexts: [...GO_SEARCH, ...GO_SEARCH.map((t) => t.toLowerCase())],
  });

  await tryPerformStepOptional(page, {
    stepName: GO_SEARCH[0],
    currentTexts: [...GO_SEARCH, ...GO_SEARCH.map((t) => t.toLowerCase())],
    nextTexts: ['\u0418\u0434\u0442\u0438 \u043d\u0430 \u0432\u043e\u0441\u0442\u043e\u043a', '\u0438\u0434\u0442\u0438 \u043d\u0430 \u0432\u043e\u0441\u0442\u043e\u043a'],
  });

  if (progressedIntroOnly) {
    const knownNextMarkers = [
      ...WHAT_HAPPENED,
      ...SURE_HELP,
      ...GO_SEARCH,
      '\u0418\u0434\u0442\u0438 \u043d\u0430 \u0432\u043e\u0441\u0442\u043e\u043a',
      '\u0418\u0434\u0442\u0438 \u043d\u0430 \u0441\u0435\u0432\u0435\u0440',
      '\u041f\u0440\u0438\u043d\u044f\u0442\u044c \u0431\u043e\u0439',
      '\u0412 \u0431\u043e\u0439!',
      '\u0423\u0434\u0430\u0440\u0438\u0442\u044c',
      '\u041e\u0442\u043a\u0440\u044b\u0442\u044c \u0434\u0432\u0435\u0440\u044c',
      '\u041f\u0440\u043e\u0434\u043e\u043b\u0436\u0438\u0442\u044c \u043a\u0432\u0435\u0441\u0442',
    ];

    const hasAnyKnownNext = await existsAnyText(page, [
      ...knownNextMarkers,
      ...knownNextMarkers.map((t) => t.toLowerCase()),
    ]);

    if (!hasAnyKnownNext) {
      appendDebugSnapshot('Shtolni: no expected steps after intro', {
        label: 'shtolni_no_steps',
        url: page.url(),
        text: await getBodyText(page),
      });
    }
  }

  // Quest dungeon steps and first fight.
  const pathSteps = [
    '\u041f\u0440\u043e\u0434\u043e\u043b\u0436\u0438\u0442\u044c \u043a\u0432\u0435\u0441\u0442',
    '\u0418\u0434\u0442\u0438 \u043d\u0430 \u0432\u043e\u0441\u0442\u043e\u043a',
    '\u0418\u0434\u0442\u0438 \u043d\u0430 \u0441\u0435\u0432\u0435\u0440',
    '\u041e\u0442\u043a\u0440\u044b\u0442\u044c \u0434\u0432\u0435\u0440\u044c',
    '\u0418\u0434\u0442\u0438 \u0432\u043f\u0435\u0440\u0435\u0434',
    '\u0414\u0430\u043b\u0435\u0435',
    '\u0412\u044b\u0439\u0442\u0438 \u0432 \u0442\u0443\u043d\u043d\u0435\u043b\u044c',
    '\u041f\u0440\u0438\u043d\u044f\u0442\u044c \u0431\u043e\u0439',
  ];

  for (let i = 0; i < pathSteps.length; i++) {
    const step = pathSteps[i];
    const next = pathSteps[i + 1] ? [pathSteps[i + 1], pathSteps[i + 1].toLowerCase()] : ['\u0412 \u0431\u043e\u0439!', '\u0432 \u0431\u043e\u0439!'];
    await tryPerformStepOptional(page, {
      stepName: step,
      currentTexts: [step, step.toLowerCase()],
      nextTexts: next,
    });
  }

  if (await existsAnyText(page, ['\u0412 \u0431\u043e\u0439!', '\u0432 \u0431\u043e\u0439!', '\u0412 \u0431\u043e\u0439', '\u0432 \u0431\u043e\u0439'])) {
    await performStep(page, {
      stepName: '\u0412 \u0431\u043e\u0439!',
      currentTexts: ['\u0412 \u0431\u043e\u0439!', '\u0432 \u0431\u043e\u0439!', '\u0412 \u0431\u043e\u0439', '\u0432 \u0431\u043e\u0439'],
      retries: 4,
    });
    await fightLoop(page);
    hadFirstFight = true;
  }
  } // end of !resumedInPlace branch

  // After the first fight we often land on a generic screen ("Вернуться"/location.php).
  // Prefer continuing the quest in-place (e.g. "Продолжить квест") instead of jumping back to Q.
  // Only fall back to reopening quest info from Q if we have no continuation UI.
  if (hadFirstFight) {
    await pause(page, 800, 1600);

    const continuedInPlace =
      await tryPerformStepOptional(page, {
        stepName: 'Продолжить квест',
        currentTexts: ['Продолжить квест', 'продолжить квест'],
      }) ||
      await tryPerformStepOptional(page, {
        stepName: 'Далее',
        currentTexts: ['Далее', 'далее'],
      });

    if (!continuedInPlace) {
      const menuOk = await resetToQuestMenu(page, null);
      if (menuOk) {
        const infoOk = await clickInfoForQuest(page, QUEST);
        if (!infoOk) {
          console.log('Could not reopen Shtolni quest info after first fight.');
        }
      } else {
        console.log('Could not reset to quests menu after first fight.');
      }
    }
  }

  // Continue after the first fight only if we are actually at this stage (or later).
  const postFightMarkers = [
    '\u041f\u0440\u043e\u0434\u043e\u043b\u0436\u0438\u0442\u044c \u043a\u0432\u0435\u0441\u0442',
    '\u0412\u043e\u0440\u0432\u0430\u0442\u044c\u0441\u044f \u0432 \u043a\u043e\u043c\u043d\u0430\u0442\u0443',
    '\u0412\u0441\u0442\u0443\u043f\u0438\u0442\u044c \u0432 \u0431\u043e\u0439',
    '\u0418\u0434\u0442\u0438 \u043d\u0430 \u044e\u0433',
    '\u041e\u0442\u043a\u0430\u0437\u0430\u0442\u044c\u0441\u044f',
  ];

  // If we have just completed the first fight in this run, we should always try to continue immediately.
  // Some quest pages do not show the post-fight markers reliably until we start clicking, so don't bail out.
  const shouldTryContinue = hadFirstFight || await existsAnyText(page, [...postFightMarkers, ...postFightMarkers.map((t) => t.toLowerCase())]);

  if (!shouldTryContinue) {
    // Not at the post-fight stage yet; don't force mid-quest continuation.
    // If this was a turn-in / dialog-only stage, "В игру" is often shown and must be clicked
    // to actually leave the quest and complete the turn-in.
    let backOk = false;
    if (!travelOk && !talkOk) {
      backOk = await tryPerformStepOptional(page, {
        stepName: '\u0412 \u0438\u0433\u0440\u0443',
        currentTexts: ['\u0412 \u0438\u0433\u0440\u0443', '\u0432 \u0438\u0433\u0440\u0443'],
        nextTexts: [],
      });
    }

    // If we keep seeing only the intro stage (travel/talk/back) over multiple cycles,
    // stop blocking other actions to avoid getting stuck forever.
    const stage = hasAdvancedMarkerBefore ? 'advanced' : 'intro';
    if (stage === 'intro') {
      if (travelOk || talkOk) {
        // Real quest action happened; do not back off on intro progression.
        S.shtolniNoProgressStreak = 0;
        S.shtolniLastStage = stage;
      } else if (backOk) {
        if (S.shtolniLastStage === stage) {
          S.shtolniNoProgressStreak += 1;
        } else {
          S.shtolniNoProgressStreak = 1;
        }
        S.shtolniLastStage = stage;

        // Back off only after many consecutive "only exit" cycles.
        if (S.shtolniNoProgressStreak >= 6) {
          S.shtolniSuppressedUntil = Date.now() + EXCLUSIVE_QUEST_ERROR_BACKOFF_MS;
          console.log(`Shtolni quest: no progress streak=${S.shtolniNoProgressStreak} -> backoff 15 min and continue other actions`);
          appendDebugSnapshot('Shtolni stuck at intro (backoff)', { label: 'shtolni_intro', url: page.url(), text: await getBodyText(page) });
        }
      }
    } else if (stage === 'advanced') {
      S.shtolniNoProgressStreak = 0;
      S.shtolniLastStage = stage;
    }

    return Boolean(travelOk || talkOk || backOk);
  }

  let progressed = false;
  let finished = false;

  // Second part and second fight (best-effort, as originally).
  const afterGateSteps = [
    '\u041f\u0440\u043e\u0434\u043e\u043b\u0436\u0438\u0442\u044c \u043a\u0432\u0435\u0441\u0442',
    '\u0414\u0430\u043b\u0435\u0435',
    '\u0414\u0430\u043b\u0435\u0435',
  ];

  if (hadFirstFight) {
    // We expect some continuation UI; if nothing matches, capture a snapshot for quick tuning.
    const hasAnyAfterGate = await existsAnyText(page, [...afterGateSteps, ...afterGateSteps.map((t) => t.toLowerCase())]);
    if (!hasAnyAfterGate) {
      appendDebugSnapshot('Shtolni: no continuation after first fight', {
        label: 'shtolni_after_first_fight',
        url: page.url(),
        text: await getBodyText(page),
      });
    }
  }

  for (let i = 0; i < afterGateSteps.length; i++) {
    const step = afterGateSteps[i];
    const isAfterFirstFightContinueStep = step === '\u0414\u0430\u043b\u0435\u0435';
    const isSecondContinueStep =
      isAfterFirstFightContinueStep &&
      afterGateSteps[i + 1] === '\u0414\u0430\u043b\u0435\u0435' &&
      afterGateSteps[i - 1] === '\u0414\u0430\u043b\u0435\u0435';
    const nextMarkers = [
      '\u0416\u0434\u0430\u0442\u044c',
      '\u0412\u043e\u0440\u0432\u0430\u0442\u044c\u0441\u044f',
      '\u0412\u043e\u0440\u0432\u0430\u0442\u044c\u0441\u044f \u0432 \u043a\u043e\u043c\u043d\u0430\u0442\u0443',
      '\u0412\u0441\u0442\u0443\u043f\u0438\u0442\u044c',
      '\u0412\u0441\u0442\u0443\u043f\u0438\u0442\u044c \u0432 \u0431\u043e\u0439',
      '\u041f\u0440\u0438\u043d\u044f\u0442\u044c \u0431\u043e\u0439',
      '\u0412 \u0431\u043e\u0439!',
      '\u0423\u0434\u0430\u0440\u0438\u0442\u044c',
    ];

    const ok = await tryPerformStepOptional(page, {
      stepName: step,
      currentTexts: [step, step.toLowerCase()],
      nextTexts: nextMarkers,
      waitForNextMs: isAfterFirstFightContinueStep ? (isSecondContinueStep ? 30000 : 15000) : 0,
    });
    if (ok) progressed = true;
  }

  // Second fight: click "Ворваться..." (optionally after "Ждать"), then advance to fight start.
  const tryClickVorvatsya = async () => {
    const variants = [
      '\u0412\u043e\u0440\u0432\u0430\u0442\u044c\u0441\u044f \u0432 \u043a\u043e\u043c\u043d\u0430\u0442\u0443',
      '\u0412\u043e\u0440\u0432\u0430\u0442\u044c\u0441\u044f',
    ];
    return await performStep(page, {
      stepName: '\u0412\u043e\u0440\u0432\u0430\u0442\u044c\u0441\u044f \u0432 \u043a\u043e\u043c\u043d\u0430\u0442\u0443',
      currentTexts: [...variants, ...variants.map((t) => t.toLowerCase())],
      nextTexts: ['\u0414\u0430\u043b\u0435\u0435', '\u0434\u0430\u043b\u0435\u0435', '\u041f\u0440\u0438\u043d\u044f\u0442\u044c \u0431\u043e\u0439', '\u0412 \u0431\u043e\u0439!', '\u0423\u0434\u0430\u0440\u0438\u0442\u044c'],
      retries: 3,
      waitForNextMs: 30000,
      skipIfNextVisible: false,
      clickFn: async (p, texts, stepName) => {
        const clicked = await clickByTextsLoose(p, texts, stepName);
        if (clicked) return true;
        if (await clickByKeywords(p, ['\u0412\u043e\u0440\u0432\u0430\u0442\u044c\u0441\u044f'], stepName)) return true;
        return clickByNormalizedIncludes(p, ['\u0432\u043e\u0440\u0432\u0430\u0442\u044c\u0441\u044f', '\u043a\u043e\u043c\u043d'], stepName);
      },
    });
  };

  // Try to reach the second fight screen.
  const hasVorvatsya = await existsAnyText(page, [
    '\u0412\u043e\u0440\u0432\u0430\u0442\u044c\u0441\u044f \u0432 \u043a\u043e\u043c\u043d\u0430\u0442\u0443',
    '\u0412\u043e\u0440\u0432\u0430\u0442\u044c\u0441\u044f',
    '\u0416\u0434\u0430\u0442\u044c',
  ]);
  // 14.09.2026 (\u041f\u0430\u0448\u0430): \u043d\u0430 \u044d\u0442\u043e\u0439 \u0440\u0430\u0437\u0432\u0438\u043b\u043a\u0435 \u0434\u043b\u044f AI__ \u0432\u043c\u0435\u0441\u0442\u043e "\u0412\u043e\u0440\u0432\u0430\u0442\u044c\u0441\u044f \u0432 \u043a\u043e\u043c\u043d\u0430\u0442\u0443" \u0432\u0441\u0435\u0433\u0434\u0430
  // \u0436\u043c\u0451\u043c "\u0416\u0434\u0430\u0442\u044c" (\u0434\u043e 2 \u0440\u0430\u0437 \u043f\u043e\u0434\u0440\u044f\u0434, \u043f\u043e\u043a\u0430 \u043a\u043d\u043e\u043f\u043a\u0430 \u043f\u0440\u0435\u0434\u043b\u0430\u0433\u0430\u0435\u0442\u0441\u044f) \u2014 \u043f\u043e \u0435\u0433\u043e \u0441\u043b\u043e\u0432\u0430\u043c, \u044d\u0442\u043e \u0432\u0435\u0434\u0451\u0442
  // \u043a \u0431\u043e\u043b\u0435\u0435 \u043b\u0451\u0433\u043a\u043e\u043c\u0443 \u043f\u0440\u043e\u0434\u043e\u043b\u0436\u0435\u043d\u0438\u044e. "\u0412\u043e\u0440\u0432\u0430\u0442\u044c\u0441\u044f" \u0438\u0441\u043f\u043e\u043b\u044c\u0437\u0443\u0435\u043c \u0442\u043e\u043b\u044c\u043a\u043e \u0435\u0441\u043b\u0438 "\u0416\u0434\u0430\u0442\u044c" \u043d\u0435 \u043f\u0440\u0435\u0434\u043b\u0430\u0433\u0430\u044e\u0442.
  if (hadFirstFight || hasVorvatsya) {
    let waitedCount = 0;
    while (
      waitedCount < 2 &&
      (await existsAnyText(page, ['\u0416\u0434\u0430\u0442\u044c', '\u0436\u0434\u0430\u0442\u044c']))
    ) {
      const waitedOk = await tryPerformStepOptional(page, {
        stepName: '\u0416\u0434\u0430\u0442\u044c',
        currentTexts: ['\u0416\u0434\u0430\u0442\u044c', '\u0436\u0434\u0430\u0442\u044c'],
      });
      if (!waitedOk) break;
      waitedCount += 1;
      await pause(page, 800, 1600);
    }
    console.log(`Shtolni: clicked "\u0416\u0434\u0430\u0442\u044c" ${waitedCount} time(s) at the branch.`);

    if (await existsAnyText(page, ['\u0412\u043e\u0440\u0432\u0430\u0442\u044c\u0441\u044f', '\u0412\u043e\u0440\u0432\u0430\u0442\u044c\u0441\u044f \u0432 \u043a\u043e\u043c\u043d\u0430\u0442\u0443'])) {
      try {
        await tryClickVorvatsya();
      } catch (e) {
        // ignore
      }
    }
  }

  // Advance to fight start button if needed.
  for (let i = 0; i < 8; i++) {
    if (await existsAnyText(page, ['\u0423\u0434\u0430\u0440\u0438\u0442\u044c', '\u0443\u0434\u0430\u0440\u0438\u0442\u044c', '\u0411\u043e\u0439 \u0437\u0430\u0432\u0435\u0440\u0448\u0435\u043d', '\u0411\u043e\u0439 \u0437\u0430\u0432\u0435\u0440\u0448\u0435\u043d!'])) {
      break;
    }

    const advanced =
      await tryPerformStepOptional(page, { stepName: '\u0414\u0430\u043b\u0435\u0435', currentTexts: ['\u0414\u0430\u043b\u0435\u0435', '\u0434\u0430\u043b\u0435\u0435'] }) ||
      await tryPerformStepOptional(page, { stepName: '\u041f\u0440\u0438\u043d\u044f\u0442\u044c \u0431\u043e\u0439', currentTexts: ['\u041f\u0440\u0438\u043d\u044f\u0442\u044c \u0431\u043e\u0439', '\u043f\u0440\u0438\u043d\u044f\u0442\u044c \u0431\u043e\u0439'] }) ||
      await tryPerformStepOptional(page, { stepName: '\u0412\u0441\u0442\u0443\u043f\u0438\u0442\u044c \u0432 \u0431\u043e\u0439', currentTexts: ['\u0412\u0441\u0442\u0443\u043f\u0438\u0442\u044c \u0432 \u0431\u043e\u0439', '\u0432\u0441\u0442\u0443\u043f\u0438\u0442\u044c \u0432 \u0431\u043e\u0439', '\u0412\u0441\u0442\u0443\u043f\u0438\u0442\u044c', '\u0432\u0441\u0442\u0443\u043f\u0438\u0442\u044c'] });

    if (!advanced) {
      break;
    }
  }

  if (await existsAnyText(page, ['\u0412 \u0431\u043e\u0439!', '\u0432 \u0431\u043e\u0439!', '\u0412 \u0431\u043e\u0439', '\u0432 \u0431\u043e\u0439', '\u0423\u0434\u0430\u0440\u0438\u0442\u044c', '\u0443\u0434\u0430\u0440\u0438\u0442\u044c'])) {
    // HP gate: only if we can actually parse HP on this page.
    // On some fight/transition pages stats parsing is unavailable; do not block the quest in that case.
    // 14.09.2026 (\u041f\u0430\u0448\u0430): "\u0445\u0438\u043b \u043f\u043e\u0441\u043b\u0435 \u043a\u0430\u0436\u0434\u043e\u0433\u043e \u0431\u043e\u044f" \u2014 \u0430\u0431\u0441\u043e\u043b\u044e\u0442\u043d\u044b\u0439 \u043f\u043e\u0440\u043e\u0433 2000 \u0431\u044b\u043b \u0440\u0430\u0441\u0441\u0447\u0438\u0442\u0430\u043d \u043d\u0430
    // Tsunami (\u0442\u044b\u0441\u044f\u0447\u0438 HP) \u0438 \u0443 AI__ (max ~300-400) \u043d\u0438\u043a\u043e\u0433\u0434\u0430 \u043d\u0435 \u043c\u043e\u0433 \u0441\u0440\u0430\u0431\u043e\u0442\u0430\u0442\u044c (\u0432\u0435\u0447\u043d\u044b\u0439 \u0442\u0430\u0439\u043c\u0430\u0443\u0442).
    // \u0417\u0430\u043c\u0435\u043d\u0435\u043d\u043e \u043d\u0430 \u0434\u043e\u043b\u044e \u043e\u0442 \u0442\u0435\u043a\u0443\u0449\u0435\u0433\u043e hpMax \u044d\u0442\u043e\u0433\u043e \u043f\u0435\u0440\u0441\u043e\u043d\u0430\u0436\u0430, \u043a\u0430\u043a \u0438 \u0432 \u043e\u0441\u0442\u0430\u043b\u044c\u043d\u044b\u0445 \u0433\u0435\u0439\u0442\u0430\u0445 \u0428\u0442\u043e\u043b\u0435\u043d.
    const statsForGate = parseStats(await getBodyText(page));
    // Транзитные экраны ("Далее"/"Ждать") часто не содержат обычный заголовок с HP/max —
    // в этом случае используем hpMax из lastCycleStats (последний раз, когда его удалось
    // прочитать на location.php), а не абсолютный "2000" (тот всегда недостижим у AI__).
    const hpMaxForGate =
      typeof statsForGate.hpMax === 'number'
        ? statsForGate.hpMax
        : typeof S.lastCycleStats?.hpMax === 'number'
        ? S.lastCycleStats.hpMax
        : null;
    const hpGateThreshold = hpMaxForGate ? Math.max(1, Math.round(hpMaxForGate * SHTOLNI_MIN_HP_FRACTION) - 1) : SHTOLNI_MIN_HP;
    const hpNow = await getHpCurrentSafe(page);
    if (hpNow !== null && hpNow <= hpGateThreshold) {
      if (!await waitForHpAbove(page, hpGateThreshold, { waitMs: 5 * 60 * 1000, maxWaits: 24 })) {
        console.log('Shtolni quest: HP gate timed out, stop for now.');
        return progressed;
      }
    }
    if (!await existsAnyText(page, ['\u0423\u0434\u0430\u0440\u0438\u0442\u044c', '\u0443\u0434\u0430\u0440\u0438\u0442\u044c'])) {
      await performStep(page, {
        stepName: '\u0412 \u0431\u043e\u0439!',
        currentTexts: ['\u0412 \u0431\u043e\u0439!', '\u0432 \u0431\u043e\u0439!', '\u0412 \u0431\u043e\u0439', '\u0432 \u0431\u043e\u0439'],
        retries: 4,
      });
    }
    await fightLoop(page);
    progressed = true;
    hadSecondFight = true;
    // 14.09.2026 (Паша): диагностика — не видели вживую, что реально показывается после 2го боя — снимаем полный текст и ссылки для отладки exitSteps.
    try {
      const linksNow = await page.locator('a').evaluateAll((els) =>
        els.map((e) => ({ t: e.textContent.trim(), href: e.getAttribute('href') })).filter((x) => x.t)
      );
      const bodyText = await getBodyText(page);
      appendDebugSnapshot('Shtolni: state right after 2nd fight (for exitSteps tuning)', {
        label: 'shtolni_after_2nd_fight',
        url: page.url(),
        text: `${bodyText}\n\nLINKS: ${JSON.stringify(linksNow)}`,
      });
    } catch (e) {
      // ignore
    }
  }

  // Wrap up and exit.
  // Only try to exit/turn-in after the second fight.
  if (!hadSecondFight) {
    return progressed;
  }

  // \u0412\u041d\u0418\u041c\u0410\u041d\u0418\u0415 (\u041f\u0430\u0448\u0430, 14.09.2026): "\u041e\u0442\u043a\u0430\u0437\u0430\u0442\u044c\u0441\u044f" \u0437\u0434\u0435\u0441\u044c \u0443 Tsunami \u0430\u0432\u0442\u043e\u043c\u0430\u0442\u0438\u0447\u0435\u0441\u043a\u0438 \u043e\u0442\u043a\u043b\u043e\u043d\u044f\u0435\u0442
  // \u043f\u0440\u0435\u0434\u043b\u043e\u0436\u0435\u043d\u043d\u0443\u044e \u043d\u0430\u0433\u0440\u0430\u0434\u0443 \u0432 \u0444\u0438\u043d\u0430\u043b\u044c\u043d\u043e\u043c \u0434\u0438\u0430\u043b\u043e\u0433\u0435 \u2014 \u0434\u043b\u044f AI__ \u0442\u0430\u043a \u0434\u0435\u043b\u0430\u0442\u044c \u041d\u0415 \u043d\u0430\u0434\u043e. \u041f\u043e\u043a\u0430 \u043d\u0435
  // \u043f\u0440\u043e\u0432\u0435\u0440\u0435\u043d\u043e \u0432\u0436\u0438\u0432\u0443\u044e, \u0447\u0442\u043e \u0438\u043c\u0435\u043d\u043d\u043e \u043f\u0440\u0435\u0434\u043b\u0430\u0433\u0430\u0435\u0442\u0441\u044f \u0432\u0437\u0430\u043c\u0435\u043d ("\u0412\u0437\u044f\u0442\u044c"/"\u041f\u0440\u0438\u043d\u044f\u0442\u044c"/\u0434\u0440.), \u043f\u043e\u044d\u0442\u043e\u043c\u0443
  // "\u041e\u0442\u043a\u0430\u0437\u0430\u0442\u044c\u0441\u044f" \u0438\u0437 \u0430\u0432\u0442\u043e-\u043a\u043b\u0438\u043a\u0430 \u0443\u0431\u0440\u0430\u043d \u0438 \u0437\u0430\u043c\u0435\u043d\u0451\u043d \u0434\u0438\u0430\u0433\u043d\u043e\u0441\u0442\u0438\u043a\u043e\u0439: \u0435\u0441\u043b\u0438 \u044d\u0442\u043e\u0442 \u0448\u0430\u0433 \u0432\u0441\u043f\u043b\u044b\u0432\u0451\u0442,
  // \u0432 \u043b\u043e\u0433\u0435 \u043f\u043e\u044f\u0432\u0438\u0442\u0441\u044f \u043f\u043e\u043b\u043d\u044b\u0439 \u0442\u0435\u043a\u0441\u0442 \u044d\u043a\u0440\u0430\u043d\u0430, \u0447\u0442\u043e\u0431\u044b \u0440\u0435\u0448\u0438\u0442\u044c \u043e\u0441\u043e\u0437\u043d\u0430\u043d\u043d\u043e, \u0430 \u043d\u0435 \u0432\u044b\u0431\u0440\u0430\u0442\u044c \u043d\u0435 \u0433\u043b\u044f\u0434\u044f.
  // 14.09.2026 (\u041f\u0430\u0448\u0430): "\u043d\u0435 \u043e\u0442\u043a\u0430\u0437\u044b\u0432\u0430\u0435\u043c\u0441\u044f \u043e\u0442 \u043d\u0430\u0433\u0440\u0430\u0434\u044b, \u0431\u0435\u0440\u0451\u043c \u0435\u0451" \u2014 \u043f\u0440\u043e\u0431\u0443\u0435\u043c \u0432\u0430\u0440\u0438\u0430\u043d\u0442\u044b \u043f\u0440\u0438\u043d\u044f\u0442\u0438\u044f
  // (\u0442\u0435\u043a\u0441\u0442 \u043a\u043d\u043e\u043f\u043a\u0438 \u0442\u043e\u0447\u043d\u043e \u043d\u0435 \u0438\u0437\u0432\u0435\u0441\u0442\u0435\u043d, \u0442.\u043a. \u0432\u0436\u0438\u0432\u0443\u044e \u0434\u043e \u044d\u0442\u043e\u0433\u043e \u044d\u043a\u0440\u0430\u043d\u0430 \u0440\u0430\u043d\u044c\u0448\u0435 \u043d\u0435 \u0434\u043e\u0445\u043e\u0434\u0438\u043b\u0438).
  const tryAcceptShtolniReward = async () => {
    if (!await existsAnyText(page, ['\u041e\u0442\u043a\u0430\u0437\u0430\u0442\u044c\u0441\u044f', '\u043e\u0442\u043a\u0430\u0437\u0430\u0442\u044c\u0441\u044f'])) {
      return false;
    }
    const ACCEPT_CANDIDATES = [
      '\u0412\u0437\u044f\u0442\u044c \u043d\u0430\u0433\u0440\u0430\u0434\u0443',
      '\u0412\u0437\u044f\u0442\u044c',
      '\u041f\u0440\u0438\u043d\u044f\u0442\u044c \u043d\u0430\u0433\u0440\u0430\u0434\u0443',
      '\u041f\u0440\u0438\u043d\u044f\u0442\u044c',
      '\u0421\u043e\u0433\u043b\u0430\u0441\u0438\u0442\u044c\u0441\u044f',
      '\u0417\u0430\u0431\u0440\u0430\u0442\u044c',
    ];
    const accepted = await clickByTextsLoose(page, ACCEPT_CANDIDATES, 'Shtolni reward accept');
    appendDebugSnapshot(
      accepted
        ? 'Shtolni: reward accept button clicked'
        : 'Shtolni: "\u041e\u0442\u043a\u0430\u0437\u0430\u0442\u044c\u0441\u044f" screen reached, no known accept button matched (AI__ \u2014 needs manual review)',
      { label: 'shtolni_decline_screen', url: page.url(), text: await getBodyText(page) }
    );
    if (accepted) await pause(page, 800, 1600);
    return accepted;
  };

  // 14.09.2026 (\u041f\u0430\u0448\u0430): \u0432\u043c\u0435\u0441\u0442\u043e \u0437\u0430\u0448\u0438\u0442\u043e\u0433\u043e \u0441\u043f\u0438\u0441\u043a\u0430 \u0448\u0430\u0433\u043e\u0432 \u0432\u044b\u0445\u043e\u0434\u0430 (\u043e\u043a\u0430\u0437\u0430\u043b\u0441\u044f \u043d\u0435\u0432\u0435\u0440\u043d\u044b\u043c \u2014 \u0440\u0435\u0430\u043b\u044c\u043d\u044b\u0439 \u043e\u0431\u0440\u0430\u0442\u043d\u044b\u0439 \u043f\u0443\u0442\u044c \u0447\u0435\u0440\u0435\u0437 \u0448\u0442\u043e\u043b\u044c\u043d\u0438 \u2014 "\u0418\u0434\u0442\u0438 \u043d\u0430 \u044e\u0433" \u2192 "\u041e\u0442\u043a\u0440\u044b\u0442\u044c \u0434\u0432\u0435\u0440\u044c", \u0430 \u043d\u0435 "\u0418\u0434\u0442\u0438 \u043d\u0430 \u0437\u0430\u043f\u0430\u0434")
  // \u0438\u0434\u0451\u043c \u0430\u0432\u0442\u043e\u043c\u0430\u0442\u0438\u0447\u0435\u0441\u043a\u0438: \u043f\u043e\u043a\u0430 \u043d\u0430 \u044d\u043a\u0440\u0430\u043d\u0435 \u0440\u043e\u0432\u043d\u043e \u043e\u0434\u0438\u043d \u043e\u0441\u043c\u044b\u0441\u043b\u0435\u043d\u043d\u044b\u0439 \u0432\u044b\u0431\u043e\u0440 (\u0438\u0441\u043a\u043b\u044e\u0447\u0430\u044f \u0441\u0442\u0430\u043d\u0434\u0430\u0440\u0442\u043d\u043e\u0435 \u043c\u0435\u043d\u044e \u0441\u0430\u0439\u0442\u0430) \u2014 \u043a\u043b\u0438\u043a\u0430\u0435\u043c \u043f\u043e \u043d\u0435\u043c\u0443, \u043a\u0430\u043a \u0432 \u0440\u0430\u0437\u0432\u0435\u0434\u043a\u0435 "\u041a\u043e\u043b\u043e\u0434\u0446\u0430 \u0421\u0442\u0440\u0430\u0445\u0430" \u0432 \u044d\u0442\u043e\u0439 \u0436\u0435 \u0441\u0435\u0441\u0441\u0438\u0438. \u041e\u0441\u0442\u0430\u043d\u0430\u0432\u043b\u0438\u0432\u0430\u0435\u043c\u0441\u044f \u043d\u0430 \u0440\u0430\u0437\u0432\u0438\u043b\u043a\u0435/\u0431\u043e\u0435 \u0438\u043b\u0438 \u043a\u043e\u0433\u0434\u0430 \u0441\u0441\u044b\u043b\u043e\u043a \u043d\u0435\u0442 \u0432\u043e\u0432\u0441\u0435.
  const BORING_LINK_TEXTS = new Set([
    '\u0410\u043c\u0443\u043b\u0435\u0442', '\u0410mulet', '\u041a\u043e\u043d\u044c', '\u041a\u0430\u0440\u0442\u0430', '\u0427\u0430\u0442', '\u0424\u043e\u0440\u0443\u043c', '\u041a\u043b\u0430\u043d\u044b', '\u0416\u0413', '\u0413\u0430\u043b\u0435\u0440\u0435\u044f',
    '\u041a\u0442\u043e \u0437\u0434\u0435\u0441\u044c?', '\u041e\u0431\u043d\u043e\u0432\u0438\u0442\u044c', '\u0412 \u0438\u0433\u0440\u0443', '\u0412\u044b\u0445\u043e\u0434', '\u0420\u0430\u0437\u043c\u0435\u0440 \u0442\u0435\u043a\u0441\u0442\u0430',
  ]);
  const isBoringLink = (t) => BORING_LINK_TEXTS.has(t) || /^\u0411\u043e\u0438\s*\[?\d*\]?$/i.test(t) || /^\u041f\u043e\u043c\u043e\u0449\u044c/i.test(t) || /^\u041f\u0430\u043c\u044f\u0442\u043d\u0438\u043a/i.test(t);

  await tryAcceptShtolniReward();

  let didExit = false;
  for (let i = 0; i < 15; i++) {
    if (await tryAcceptShtolniReward()) {
      progressed = true;
      continue;
    }

    const linksNow = await page.locator('a').evaluateAll((els) =>
      els.map((e) => ({ t: e.textContent.trim(), href: e.getAttribute('href') })).filter((x) => x.t)
    ).catch(() => []);
    const meaningful = linksNow.filter((l) => !isBoringLink(l.t));

    if (meaningful.length === 0) {
      // Ничего осмысленного больше нет — вероятно вышли обратно на обычную локацию.
      if (/location\.php/i.test(page.url())) {
        didExit = true;
      }
      break;
    }
    // 14.09.2026 (Паша, живой прогон): на обратном пути встречается развилка "Идти на юг" / "Открыть дверь"
    // (та же дверь, что и на входе) — предпочитаем "Идти на юг" (продолжать обратный путь),
    // а не заходить в дверь снова.
    const southOption = meaningful.find((l) => /^Идти на юг$/i.test(l.t));
    if (meaningful.length > 1 && !southOption) {
      appendDebugSnapshot('Shtolni: exit walk hit a decision point (multiple options) - stopping', {
        label: 'shtolni_exit_decision',
        url: page.url(),
        text: `${await getBodyText(page)}\n\nLINKS: ${JSON.stringify(meaningful)}`,
      });
      break;
    }

    const label = southOption ? southOption.t : meaningful[0].t;
    const clicked = await clickByTexts(page, [label], `Shtolni exit: ${label}`);
    if (!clicked) break;
    progressed = true;
    if (/\u0432\u0435\u0440\u043d\u0443\u0442\u044c\u0441\u044f/i.test(label)) {
      didExit = true;
    }
    await pause(page, 700, 1400);
  }
  await tryAcceptShtolniReward();

  // IMPORTANT: do not mark Shtolni as "done" just because we exited the flow.
  // Some branches show exit-like buttons after the first fight, but the quest still has a second fight.
  if (didExit) {
    // Verify by reopening the Q menu and checking whether the quest still exists.
    const backToQ = await openQuestsMenu(page);
    if (backToQ) {
      const qText = await getBodyText(page);
      const qNames = parseQuestNamesFromQMenuText(qText);
      const stillThere = isQuestInMenu(qNames, QUEST);
      if (!stillThere) {
        finished = true;
      } else {
        // Not finished yet -> keep it in progress and let the main loop retry soon.
        appendDebugSnapshot('Shtolni: returned to Q but quest still active', {
          label: 'shtolni_not_finished',
          url: page.url(),
          text: qText,
        });
      }
    } else if (hadSecondFight) {
      // If we cannot verify via Q, only consider "done" after we actually did the second fight.
      finished = true;
    }
  }

  if (finished) {
    console.log('Shtolni quest: flow finished.');
    S.shtolniDoneToday = true;
    S.shtolniTakenToday = false;
    S.shtolniSuppressedUntil = 0;
    S.shtolniFocusStartedAt = 0;
    persistDailyQuestState();
    return true;
  }

  return progressed;
}
