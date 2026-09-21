// Квест "Харчевня".
// Выделено из ai_char/module.js (там только сборка экспорта). Изменяемое состояние - S из ./state.

// Экспорт стоит ДО require: файлы lib/ вызывают друг друга по кругу, а объявления функций
// всплывают (hoisting), поэтому к моменту любого встречного require все функции уже здесь.
module.exports = {
  ensureTavernQuestTaken, ensureTavernQuestTurnedIn, ensureTavernQuestBotsKilled,
  progressTavernQuest,
};

const { S, getDayKeyNow, persistDailyQuestState, QUEST_FIGHT_HP_FLOOR } = require('./state');
const { getBodyText, parseStats, pause } = require('./core');
const { fightLoop } = require('./fight');
const { noteHpFromPageText, questFightHpGate } = require('./hp');
const {
  clickInfoForQuest, dropCurrentAssignment, hasAlreadyHasQuestText, parseQuestNamesFromQMenuText,
  resetToQuestMenu,
} = require('./quest_menu');
const { clickByTexts, existsAnyText, performStep } = require('./ui');

async function ensureTavernQuestTaken(page) {
  const QUEST_TAVERN = '\u0425\u0430\u0440\u0447\u0435\u0432\u043d\u044f';

  try {
    const infoClicked = await clickInfoForQuest(page, QUEST_TAVERN);
    if (!infoClicked) {
      console.log('Could not open tavern quest info.');
      return false;
    }

    // Take quest route as described by user.
    await performStep(page, {
      stepName: '\u041a \u043c\u0435\u0441\u0442\u0443 \u0432\u044b\u043f\u043e\u043b\u043d\u0435\u043d\u0438\u044f',
      currentTexts: ['\u041a \u043c\u0435\u0441\u0442\u0443 \u0432\u044b\u043f\u043e\u043b\u043d\u0435\u043d\u0438\u044f', '\u043a \u043c\u0435\u0441\u0442\u0443 \u0432\u044b\u043f\u043e\u043b\u043d\u0435\u043d\u0438\u044f'],
      waitAfterClickMs: 7000,
      retries: 3,
    });

    // Some pages show travel progress. If it's clickable, click once; otherwise proceed when entry appears.
    if (await existsAnyText(page, ['\u0412 \u043f\u0443\u0442\u0438 \u0435\u0449\u0435', '\u0432 \u043f\u0443\u0442\u0438 \u0435\u0449\u0435'])) {
      await clickByTexts(page, ['\u0412 \u043f\u0443\u0442\u0438 \u0435\u0449\u0435', '\u0432 \u043f\u0443\u0442\u0438 \u0435\u0449\u0435'], '\u0412 \u043f\u0443\u0442\u0438 \u0435\u0449\u0435');
      await pause(page, 800, 1600);
    }

    await performStep(page, {
      stepName: '\u0417\u0430\u0439\u0442\u0438 \u0432 \u0445\u0430\u0440\u0447\u0435\u0432\u043d\u044e',
      currentTexts: ['\u0417\u0430\u0439\u0442\u0438 \u0432 \u0445\u0430\u0440\u0447\u0435\u0432\u043d\u044e', '\u0437\u0430\u0439\u0442\u0438 \u0432 \u0445\u0430\u0440\u0447\u0435\u0432\u043d\u044e'],
      retries: 4,
    });

    await performStep(page, {
      stepName: '\u0421\u043f\u0440\u043e\u0441\u0438\u0442\u044c \u043e \u0440\u0430\u0431\u043e\u0442\u0435',
      currentTexts: ['\u0421\u043f\u0440\u043e\u0441\u0438\u0442\u044c \u043e \u0440\u0430\u0431\u043e\u0442\u0435', '\u0441\u043f\u0440\u043e\u0441\u0438\u0442\u044c \u043e \u0440\u0430\u0431\u043e\u0442\u0435'],
      retries: 4,
    });

    // \u0418\u0433\u0440\u0430 \u043c\u043e\u0433\u043b\u0430 \u043e\u0442\u0432\u0435\u0442\u0438\u0442\u044c "\u0443 \u0432\u0430\u0441 \u0443\u0436\u0435 \u0435\u0441\u0442\u044c \u0437\u0430\u0434\u0430\u043d\u0438\u0435" - \u0442\u043e\u0433\u0434\u0430 \u043d\u043e\u0432\u043e\u0435 \u043d\u0435 \u0432\u043e\u0437\u044c\u043c\u0451\u0442\u0441\u044f, \u043f\u043e\u043a\u0430 \u0441\u0442\u0430\u0440\u043e\u0435
    // \u0432\u0438\u0441\u0438\u0442 \u0432 \u0430\u043d\u043a\u0435\u0442\u0435. \u041e\u0442\u043a\u0430\u0437\u044b\u0432\u0430\u0435\u043c\u0441\u044f \u043e\u0442 \u043d\u0435\u0433\u043e \u0438 \u043f\u0440\u043e\u0431\u0443\u0435\u043c \u0437\u0430\u043d\u043e\u0432\u043e \u0432 \u0441\u043b\u0435\u0434\u0443\u044e\u0449\u0435\u043c \u0446\u0438\u043a\u043b\u0435.
    if (hasAlreadyHasQuestText(await getBodyText(page))) {
      console.log('Tavern quest: \u0438\u0433\u0440\u0430 \u043e\u0442\u0432\u0435\u0442\u0438\u043b\u0430 "\u0443 \u0432\u0430\u0441 \u0443\u0436\u0435 \u0435\u0441\u0442\u044c \u0437\u0430\u0434\u0430\u043d\u0438\u0435" -> \u0438\u0434\u0443 \u0432 \u0430\u043d\u043a\u0435\u0442\u0443 \u043e\u0442\u043a\u0430\u0437\u044b\u0432\u0430\u0442\u044c\u0441\u044f.');
      await dropCurrentAssignment(page, '\u0425\u0430\u0440\u0447\u0435\u0432\u043d\u044f: \u043c\u0435\u0448\u0430\u0435\u0442 \u0432\u0437\u044f\u0442\u044c \u043d\u043e\u0432\u043e\u0435 \u0437\u0430\u0434\u0430\u043d\u0438\u0435');
      return false;
    }

    await performStep(page, {
      stepName: '\u0412 \u0438\u0433\u0440\u0443',
      currentTexts: ['\u0412 \u0438\u0433\u0440\u0443', '\u0432 \u0438\u0433\u0440\u0443'],
      retries: 4,
    });

    console.log('Tavern quest: take flow finished.');
    return true;
  } catch (e) {
    // If the quest is already taken, "Спросить о работе" may be absent.
    console.log(`Tavern quest: take flow is not available (${e.message})`);
    return false;
  }
}

async function ensureTavernQuestTurnedIn(page, { questCount } = {}) {
  const QUEST_TAVERN = '\u0425\u0430\u0440\u0447\u0435\u0432\u043d\u044f';

  const infoClicked = await clickInfoForQuest(page, QUEST_TAVERN);
  if (!infoClicked) {
    console.log('Could not open tavern quest info.');
    return false;
  }

  const reportText = '\u0414\u043e\u043b\u043e\u0436\u0438\u0442\u044c \u043e \u0432\u044b\u043f\u043e\u043b\u043d\u0435\u043d\u0438\u0438';
  const travelText = '\u041a \u043c\u0435\u0441\u0442\u0443 \u0432\u044b\u043f\u043e\u043b\u043d\u0435\u043d\u0438\u044f';

  await performStep(page, {
    stepName: travelText,
    currentTexts: [travelText, travelText.toLowerCase()],
    waitAfterClickMs: 7000,
    retries: 3,
  });

  if (await existsAnyText(page, ['\u0412 \u043f\u0443\u0442\u0438', '\u0432 \u043f\u0443\u0442\u0438', '\u0412 \u043f\u0443\u0442\u0438 \u0435\u0449\u0435', '\u0432 \u043f\u0443\u0442\u0438 \u0435\u0449\u0435'])) {
    await clickByTexts(page, ['\u0412 \u043f\u0443\u0442\u0438 \u0435\u0449\u0435', '\u0432 \u043f\u0443\u0442\u0438 \u0435\u0449\u0435', '\u0412 \u043f\u0443\u0442\u0438', '\u0432 \u043f\u0443\u0442\u0438'], '\u0412 \u043f\u0443\u0442\u0438');
    await pause(page, 800, 1600);
  }

  await performStep(page, {
    stepName: '\u0417\u0430\u0439\u0442\u0438 \u0432 \u0445\u0430\u0440\u0447\u0435\u0432\u043d\u044e',
    currentTexts: ['\u0417\u0430\u0439\u0442\u0438 \u0432 \u0445\u0430\u0440\u0447\u0435\u0432\u043d\u044e', '\u0437\u0430\u0439\u0442\u0438 \u0432 \u0445\u0430\u0440\u0447\u0435\u0432\u043d\u044e'],
    retries: 4,
  });

  if (!await existsAnyText(page, [reportText, reportText.toLowerCase()])) {
    console.log('Tavern quest turn-in step is not available yet.');
    return false;
  }

  await performStep(page, {
    stepName: reportText,
    currentTexts: [reportText, reportText.toLowerCase()],
    retries: 4,
  });

  await performStep(page, {
    stepName: '\u0412 \u0438\u0433\u0440\u0443',
    currentTexts: ['\u0412 \u0438\u0433\u0440\u0443', '\u0432 \u0438\u0433\u0440\u0443'],
    retries: 4,
  });

  console.log('Tavern quest: turn-in flow finished.');

  // Verify the quest is actually removed from the Q list. Sometimes the "report" click
  // navigates but the quest is still not completed yet.
  if (Number.isFinite(questCount) && questCount > 0) {
    const menuOk = await resetToQuestMenu(page, questCount);
    if (menuOk) {
      const qText = await getBodyText(page);
      const names = parseQuestNamesFromQMenuText(qText);
      if (names.includes(QUEST_TAVERN)) {
        console.log('Tavern quest: turn-in did not complete (still present in Q menu).');
        return false;
      }
    }
  }

  return true;
}

async function ensureTavernQuestBotsKilled(page, { initialReserveMinutes, questCount } = {}) {
  const QUEST_TAVERN = '\u0425\u0430\u0440\u0447\u0435\u0432\u043d\u044f';
  const BOT_RESERVE_COST = 5;
  const BOT_TARGETS = [
    {
      travelTexts: [
        '\u041a \u043c\u0435\u0441\u0442\u0443 \u043e\u0431\u0438\u0442\u0430\u043d\u0438\u044f \u043f\u0435\u0441\u0447\u0430\u043d\u043d\u0438\u043a\u043e\u0432',
        '\u041a \u043c\u0435\u0441\u0442\u0443 \u043e\u0431\u0438\u0442\u0430\u043d\u0438\u044f \u043f\u0435\u0441\u0447\u0430\u043d\u043d\u0438\u043a\u0430',
      ],
      npc: '\u041f\u0435\u0441\u0447\u0430\u043d\u043d\u0438\u043a \u0433\u0440\u0435\u0435\u0442\u0441\u044f \u043d\u0430 \u0441\u043e\u043b\u043d\u0446\u0435',
    },
    {
      travelTexts: [
        '\u041a \u043c\u0435\u0441\u0442\u0443 \u043e\u0431\u0438\u0442\u0430\u043d\u0438\u044f \u043e\u0433\u043d\u0435\u043d\u043d\u044b\u0445 \u043b\u0438\u0441',
        '\u041a \u043c\u0435\u0441\u0442\u0443 \u043e\u0431\u0438\u0442\u0430\u043d\u0438\u044f \u043e\u0433\u043d\u0435\u043d\u043d\u043e\u0439 \u043b\u0438\u0441\u044b',
      ],
      npc: '\u041e\u0433\u043d\u0435\u043d\u043d\u0430\u044f \u043b\u0438\u0441\u0430',
    },
    {
      travelTexts: [
        '\u041a \u043c\u0435\u0441\u0442\u0443 \u043e\u0431\u0438\u0442\u0430\u043d\u0438\u044f \u0442\u0443\u0448\u043a\u0430\u043d\u0447\u0438\u043a\u043e\u0432',
        '\u041a \u043c\u0435\u0441\u0442\u0443 \u043e\u0431\u0438\u0442\u0430\u043d\u0438\u044f \u0442\u0443\u0448\u043a\u0430\u043d\u0447\u0438\u043a\u0430',
      ],
      npc: '\u0422\u0443\u0448\u043a\u0430\u043d\u0447\u0438\u043a',
    },
  ];
  const BOT_LIMIT = 3;

  let reserveMinutes = Number.isFinite(initialReserveMinutes) ? Number(initialReserveMinutes) : null;

  const openTavernInfoFromMenu = async () => {
    if (!await resetToQuestMenu(page, questCount)) {
      return false;
    }

    const infoClicked = await clickInfoForQuest(page, QUEST_TAVERN);
    if (!infoClicked) {
      console.log('Could not open tavern quest info.');
      return false;
    }

    return true;
  };

  if (!await openTavernInfoFromMenu()) {
    return false;
  }

  let kills = 0;

  while (kills < BOT_LIMIT) {
    let matched = null;

    // Prefer the expected order (sandman -> fire fox -> jerboa).
    const expected = BOT_TARGETS[kills] || null;
    if (!expected) {
      console.log(`Tavern quest: unknown expected bot index ${kills}`);
      return false;
    }

    const expectedVariants = [
      ...expected.travelTexts,
      ...expected.travelTexts.map((t) => t.toLowerCase()),
    ];

    // IMPORTANT: do not fall back to other bots.
    // Each bot has its own route, so repeating the first one is wrong.
    for (let i = 0; i < 3; i++) {
      if (await existsAnyText(page, expectedVariants)) {
        matched = { ...expected, travelVariants: expectedVariants };
        break;
      }

      // Some steps only appear after reopening the quest info from the Q menu.
      await pause(page, 800, 1600);
      await openTavernInfoFromMenu();
    }

    if (!matched) {
      console.log(`Tavern quest: expected bot step not available yet (kills=${kills}/${BOT_LIMIT}): ${expected.npc}`);
      return false;
    }

    const nextIndex = kills + 1;
    if (Number.isFinite(reserveMinutes) && reserveMinutes < BOT_RESERVE_COST) {
      console.log(`Reserve is too low for bot ${nextIndex}/${BOT_LIMIT}: ${reserveMinutes}`);
      return false;
    }

    console.log(`Tavern quest: bot ${nextIndex}/${BOT_LIMIT} -> ${matched.npc}`);

    // Гейт перед боем с ботом - ДО дороги к нему. 18.09.2026: гейт стоял после клика по
    // "Песчанник греется на солнце", а этот клик УЖЕ открывает бой. Персонаж на 56/380 висел в
    // бою больше 40 минут, "ожидая HP", которое в бою почти не растёт (+18 за 40 мин). Решать,
    // идти ли в бой, можно только пока в него ещё не вошли - на экране задания, а не у бота.
    // waitForRecovery: Харчевню не бросаем на полпути - ждём подлечивания и добиваем ботов.
    if (!(await questFightHpGate(
      page,
      `Харчевня (бой ${nextIndex}/${BOT_LIMIT})`,
      QUEST_FIGHT_HP_FLOOR,
      { waitForRecovery: true },
    ))) return false;

    await performStep(page, {
      stepName: matched.travelTexts[0],
      currentTexts: matched.travelVariants,
      waitAfterClickMs: 7000,
      retries: 3,
    });

    if (await existsAnyText(page, ['\u0412 \u043f\u0443\u0442\u0438', '\u0432 \u043f\u0443\u0442\u0438', '\u0412 \u043f\u0443\u0442\u0438 \u0435\u0449\u0435', '\u0432 \u043f\u0443\u0442\u0438 \u0435\u0449\u0435'])) {
      await clickByTexts(page, ['\u0412 \u043f\u0443\u0442\u0438 \u0435\u0449\u0435', '\u0432 \u043f\u0443\u0442\u0438 \u0435\u0449\u0435', '\u0412 \u043f\u0443\u0442\u0438', '\u0432 \u043f\u0443\u0442\u0438'], '\u0412 \u043f\u0443\u0442\u0438');
      await pause(page, 800, 1600);
    }

    await performStep(page, {
      stepName: matched.npc,
      currentTexts: [matched.npc, matched.npc.toLowerCase()],
      retries: 4,
    });

    const textAfterNpc = await getBodyText(page);
    if (/У вас уже есть/i.test(textAfterNpc) && /Вернуться/i.test(textAfterNpc)) {
      console.log(`Tavern quest: already have required item for bot ${nextIndex}/${BOT_LIMIT} -> skip fight`);
      const backOk = await clickByTexts(page, ['\u0412\u0435\u0440\u043d\u0443\u0442\u044c\u0441\u044f', '\u0432\u0435\u0440\u043d\u0443\u0442\u044c\u0441\u044f'], '\u0412\u0435\u0440\u043d\u0443\u0442\u044c\u0441\u044f');
      if (backOk) await pause(page, 800, 1600);
      kills++;
      await pause(page, 800, 1600);
      await openTavernInfoFromMenu();
      continue;
    }


    await performStep(page, {
      stepName: '\u0412 \u0431\u043e\u0439!',
      currentTexts: [
        '\u0412 \u0431\u043e\u0439!',
        '\u0432 \u0431\u043e\u0439!',
        '\u0412 \u0431\u043e\u0439',
        '\u0432 \u0431\u043e\u0439',
        '\u0412\u0441\u0442\u0443\u043f\u0438\u0442\u044c \u0432 \u0431\u043e\u0439',
        '\u0432\u0441\u0442\u0443\u043f\u0438\u0442\u044c \u0432 \u0431\u043e\u0439',
        '\u041f\u0440\u0438\u043d\u044f\u0442\u044c \u0431\u043e\u0439',
        '\u043f\u0440\u0438\u043d\u044f\u0442\u044c \u0431\u043e\u0439',
      ],
      // Sometimes we land directly in fight ("Ударить" already visible) after clicking the NPC.
      nextTexts: ['\u0423\u0434\u0430\u0440\u0438\u0442\u044c', '\u0443\u0434\u0430\u0440\u0438\u0442\u044c', '\u0411\u043e\u0439 \u0437\u0430\u0432\u0435\u0440\u0448\u0435\u043d!', '\u0431\u043e\u0439 \u0437\u0430\u0432\u0435\u0440\u0448\u0435\u043d!'],
      retries: 4,
    });

    await fightLoop(page);
    kills++;

    const text = await getBodyText(page);
    const stats = parseStats(text);
    // Без этого гейт второго и третьего боя опирался бы на замер ДО первого боя.
    noteHpFromPageText(text, `Харчевня (после боя ${kills}/${BOT_LIMIT})`);
    if (stats.cooldown !== null) {
      reserveMinutes = stats.cooldown;
    } else if (Number.isFinite(reserveMinutes)) {
      reserveMinutes = reserveMinutes - BOT_RESERVE_COST;
    }

    // Next bot step is typically checked by reopening the quest info from the Q menu.
    await pause(page, 800, 1600);
    await openTavernInfoFromMenu();
  }

  console.log('Tavern quest: bot limit reached (expected 3 fights).');
  return true;
}

async function progressTavernQuest(page, { initialReserveMinutes, questCount } = {}) {
  const today = getDayKeyNow();
  if (S.tavernDayKey !== today) {
    S.tavernDayKey = today;
    S.tavernDoneToday = false;
    S.tavernTakenToday = false;
    S.tavernFailStreak = 0;
    S.tavernSuppressedUntil = 0;
    S.tavernFocusStartedAt = 0;
  }
  if (S.tavernDoneToday) {
    return false;
  }

  // We are entering the tavern quest flow from the Q menu; treat it as exclusive/in-progress.
  S.tavernTakenToday = true;
  if (!S.tavernFocusStartedAt) S.tavernFocusStartedAt = Date.now();
  let didAnything = false;

  // Always try to take the quest first (as user described). If the take flow isn't available
  // (quest already taken), we proceed to bot steps / turn-in.
  if (!await resetToQuestMenu(page, questCount)) {
    return false;
  }

  const taken = await ensureTavernQuestTaken(page);
  if (taken) {
    S.tavernTakenToday = true;
    didAnything = true;
    // After taking the quest we must continue ONLY with this quest; bot steps are shown via Q -> инфо.
    // Try to progress bots/turn-in in the same cycle to avoid starting other quests in parallel.
  }

  // After the quest is taken, do the 3 bot fights.
  if (!await resetToQuestMenu(page, questCount)) {
    return didAnything;
  }
  const botsDone = await ensureTavernQuestBotsKilled(page, { initialReserveMinutes, questCount });
  if (botsDone) {
    didAnything = true;
  }

  // Раньше доклад пробовался ТОЛЬКО при botsDone. Паша, 17.09.2026: "ты уже всех убил с
  // квеста, надо доложить о задании" - ботов добили, но цикл ботов вернул false (на одном из
  // шагов не пустил HP-гейт), и квест навсегда оставался несданным. Пробовать доклад можно
  // всегда: ensureTavernQuestTurnedIn сам возвращает false, если ссылки "Доложить о
  // выполнении" на месте нет, так что "доложить, не убив" тут невозможно.
  {
    if (!await resetToQuestMenu(page, questCount)) {
      return didAnything;
    }
    const turnedIn = await ensureTavernQuestTurnedIn(page, { questCount });
    if (turnedIn) {
      S.tavernDoneToday = true;
      S.tavernTakenToday = false;
      S.tavernSuppressedUntil = 0;
      S.tavernFocusStartedAt = 0;
      persistDailyQuestState();
      return true;
    }
  }

  return didAnything;
}
