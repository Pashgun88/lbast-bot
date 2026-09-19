// Главный сценарий цикла doScenario.
// Выделено из ai_char/module.js (там только сборка экспорта). Изменяемое состояние - S из ./state.

// Экспорт стоит ДО require: файлы lib/ вызывают друг друга по кругу, а объявления функций
// всплывают (hoisting), поэтому к моменту любого встречного require все функции уже здесь.
module.exports = {
  doScenario, ensureNoStuckResponsibleTask,
};

const {
  S, FARM_TARGET, LAST_HOUSE_HP_THRESHOLD, persistDailyQuestState, SHTOLNI_MIN_HP,
  SHTOLNI_MIN_HP_FRACTION, SHTOLNI_MIN_RESERVE_MINUTES, VINOGRAD_INTERVAL_MS,
} = require('./state');
const {
  canRunAnyNonQQuestNow, getBodyText, isExclusiveQQuestInProgress, pause, scheduleFarmNextCycle,
  scheduleQuestFollowup,
} = require('./core');
const {
  canRunFishEyeFightNow, canRunFishEyeRewardNow, canRunFishingNow, runDailyQuests,
  runNonQQuestSafe,
} = require('./daily_quests');
const {
  ensureFarmFightScreen, isFarmLocation, shouldFightFarmByStats,
} = require('./farm_goblins_blake');
const { fightLoop } = require('./fight');
const { runFishingTask } = require('./fishing');
const { handleUnreadMailIfAny } = require('./mail');
const { runFishEyeFight, tryClaimFishEyeReward } = require('./quests_basic');
const {
  goToChaosByAmulet, goToLocationAndReadStats, recoverToCity, runLastHouseRecovery,
  scheduleLongRestMinutes, useRecovery,
} = require('./recovery');
const {
  shouldGoChaosByStats, shouldGoLastHouseByStats, shouldRecoverByStats,
} = require('./stats_decisions');
const {
  isStatueOfGloryDue, runStatueOfGloryTask, runVinogradTask, scheduleNextStatueOfGlory,
} = require('./vinograd_statue');

async function doScenario(page) {
  let read = await goToLocationAndReadStats(page, 'stats before action');
  if (read.attackHandled) {
    return;
  }
  let stats = read.stats;
  S.lastCycleStats = stats;

  await handleUnreadMailIfAny(page);

  read = await goToLocationAndReadStats(page, 'stats after mail check');
  if (read.attackHandled) {
    return;
  }
  stats = read.stats;
  S.lastCycleStats = stats;

  if (stats.hpCurrent === null || stats.cooldown === null) {
    throw new Error('failed to parse HP/cooldown');
  }

  if (shouldGoLastHouseByStats(stats)) {
    console.log(`HP < ${LAST_HOUSE_HP_THRESHOLD} (${stats.hpCurrent}) -> Форпост/Последний дом`);
    await runLastHouseRecovery(page);
    return;
  }

  if (shouldGoChaosByStats(stats)) {
    console.log('HP below zero -> go to chaos fist');
    await goToChaosByAmulet(page);
    return;
  }

  // Water the vineyard: when "Виноград" task marker is visible OR the 8-hour interval has elapsed.
  const vinogradDue = Date.now() - S.lastVinogradRunAt >= VINOGRAD_INTERVAL_MS;
  if (/Виноград/i.test(read.text || '') || vinogradDue) {
    console.log(`Виноград: ${vinogradDue ? 'прошло 8 часов' : 'обнаружено задание'}, выполняю маршрут`);
    await runVinogradTask(page);
    S.lastVinogradRunAt = Date.now();
    persistDailyQuestState();
  }

  // Статуя славы: раз в 12-14 часов. Если не удалось — не роняем весь цикл в общий бэкофф
  // "Retry after N min", а логируем, планируем следующую попытку и продолжаем цикл дальше.
  if (isStatueOfGloryDue()) {
    console.log('Статуя славы: подошёл интервал 12-14 часов, выполняю маршрут');
    try {
      await runStatueOfGloryTask(page);
    } catch (e) {
      console.log(`Статуя славы: не удалось (${e.message}) -> пропускаю, продолжаю цикл`);
      try {
        await page.goto('http://lbast.ru/location.php', { waitUntil: 'domcontentloaded', timeout: 60000 });
        await pause(page, 800, 1600);
      } catch (e2) { /* ignore */ }
    }
    scheduleNextStatueOfGlory();
  }

  // Рыбалка: между квестами, до 6 успешных уловов в день. Эта проверка стоит только здесь,
  // в верхней части цикла — фарм ниже её никогда не запускает. Если персонаж уже на локации
  // фарма (между боями), рыбалку пропускаем, чтобы не гонять туда-обратно (для Блейка проход
  // ещё и платный) ради необязательного филлера.
  if (canRunFishingNow() && isFarmLocation(read.text)) {
    console.log('Рыбалка: пропускаю в этом цикле (уже на локации фарма)');
  } else if (canRunFishingNow()) {
    console.log('Рыбалка: пробую поймать карася');
    await runFishingTask(page);
  }

  let didAnyQuest = false;
  let hadAnyTargetQuestInQMenu = false;
  let didAttemptNonQQuestThisCycle = false;
  let nonQQuestFailedThisCycle = false;
  if (Number.isFinite(stats.questsAvailable) && stats.questsAvailable > 0) {
    const qResult = await runDailyQuests(page, stats);
    didAnyQuest = qResult.didAnything;
    hadAnyTargetQuestInQMenu = hadAnyTargetQuestInQMenu || qResult.hasAnyTargetQuest;

    read = await goToLocationAndReadStats(page, 'stats after daily quests');
    if (read.attackHandled) {
      return;
    }
    stats = read.stats;
    S.lastCycleStats = stats;
  }

  // Exclusive Q quests (Tavern / Shtolni): while one is in progress, do not start any other flows
  // (Ugo, Fish Eye, goblins). Keep focusing until the quest is finished.
  if (isExclusiveQQuestInProgress()) {
    // Shtolni safety gates: do not grind steps while reserve/HP are below the configured thresholds.
    if (S.shtolniTakenToday && !S.shtolniDoneToday) {
      const reserveMinutes = typeof stats?.reserveMinutes === 'number' ? stats.reserveMinutes : stats?.cooldown;
      const hpCurrent = typeof stats?.hpCurrent === 'number' ? stats.hpCurrent : null;
      const hpMax = typeof stats?.hpMax === 'number' ? stats.hpMax : null;
      const hpThreshold = typeof hpMax === 'number' ? hpMax * SHTOLNI_MIN_HP_FRACTION : SHTOLNI_MIN_HP;
      const reserveLow = typeof reserveMinutes === 'number' && reserveMinutes < SHTOLNI_MIN_RESERVE_MINUTES;
      const hpLow = typeof hpCurrent === 'number' && hpCurrent >= 0 && hpCurrent < hpThreshold;

      if (reserveLow || hpLow) {
        const delayMinutes = 15;
        console.log(`Shtolni gated: hp=${hpCurrent ?? 'n/a'} reserve=${reserveMinutes ?? 'n/a'} -> wait ${delayMinutes} min`);
        scheduleLongRestMinutes(delayMinutes, 'shtolni_gate');
        return;
      }
    }
    console.log('Exclusive quest in progress (Харчевня/Штольни) -> skip other actions, retry quests soon');
    scheduleQuestFollowup('exclusive_in_progress');
    return;
  }

  // UGO quest disabled (no longer needed).
  // if (stats.hpCurrent !== null && stats.hpCurrent > UGO_MIN_HP && isUgoDue()) {
  //   didAttemptNonQQuestThisCycle = true;
  //   const ugoResult = await runNonQQuestSafe(page, 'Ugo quest', async () => {
  //     await runUgoQuest(page);
  //     return true;
  //   });
  //
  //   if (ugoResult === null) {
  //     // Backoff on errors to avoid immediate re-tries in the same/next short cycle.
  //     lastUgoRunAt = Date.now();
  //     const key = getDayKeyNow();
  //     if (ugoDayKey !== key) {
  //       ugoDayKey = key;
  //       ugoRunsToday = 0;
  //     }
  //     persistUgoState();
  //     nonQQuestFailedThisCycle = true;
  //
  //     read = await goToLocationAndReadStats(page, 'stats after ugo recovery');
  //     if (read.attackHandled) {
  //       return;
  //     }
  //     stats = read.stats;
  //   } else if (ugoResult) {
  //     didAnyQuest = true;
  //
  //     read = await goToLocationAndReadStats(page, 'stats after ugo quest');
  //     if (read.attackHandled) {
  //       return;
  //     }
  //     stats = read.stats;
  //   }
  // }
  //
  // // Some non-Q quests can unlock/advance Q quests; re-check Q after Ugo.
  // if (Number.isFinite(stats.questsAvailable) && stats.questsAvailable > 0) {
  //   const secondQPass = await runDailyQuests(page, stats);
  //   if (secondQPass.didAnything) {
  //     didAnyQuest = true;
  //   }
  //   hadAnyTargetQuestInQMenu = hadAnyTargetQuestInQMenu || secondQPass.hasAnyTargetQuest;
  //
  //   read = await goToLocationAndReadStats(page, 'stats after daily quests (post-ugo)');
  //   if (read.attackHandled) {
  //     return;
  //   }
  //   stats = read.stats;
  //   lastCycleStats = stats;
  // }

  if (isExclusiveQQuestInProgress()) {
    // Shtolni safety gates: do not grind steps while reserve/HP are below the configured thresholds.
    if (S.shtolniTakenToday && !S.shtolniDoneToday) {
      const reserveMinutes = typeof stats?.reserveMinutes === 'number' ? stats.reserveMinutes : stats?.cooldown;
      const hpCurrent = typeof stats?.hpCurrent === 'number' ? stats.hpCurrent : null;
      const hpMax = typeof stats?.hpMax === 'number' ? stats.hpMax : null;
      const hpThreshold = typeof hpMax === 'number' ? hpMax * SHTOLNI_MIN_HP_FRACTION : SHTOLNI_MIN_HP;
      const reserveLow = typeof reserveMinutes === 'number' && reserveMinutes < SHTOLNI_MIN_RESERVE_MINUTES;
      const hpLow = typeof hpCurrent === 'number' && hpCurrent >= 0 && hpCurrent < hpThreshold;

      if (reserveLow || hpLow) {
        const delayMinutes = 15;
        console.log(`Shtolni gated: hp=${hpCurrent ?? 'n/a'} reserve=${reserveMinutes ?? 'n/a'} -> wait ${delayMinutes} min`);
        scheduleLongRestMinutes(delayMinutes, 'shtolni_gate');
        return;
      }
    }
    console.log('Exclusive quest in progress (Харчевня/Штольни) -> skip other actions, retry quests soon');
    scheduleQuestFollowup('exclusive_in_progress');
    return;
  }

  if (canRunFishEyeRewardNow()) {
    didAttemptNonQQuestThisCycle = true;
    const rewardResult = await runNonQQuestSafe(page, 'Fish Eye reward', async () => {
      const ok = await tryClaimFishEyeReward(page);
      return ok;
    });

    if (rewardResult === null) {
      // Backoff on errors to avoid immediate retry loops.
      S.lastFishEyeRunAt = Date.now();
      nonQQuestFailedThisCycle = true;

      read = await goToLocationAndReadStats(page, 'stats after fish eye reward recovery');
      if (read.attackHandled) {
        return;
      }
      stats = read.stats;
    } else if (rewardResult) {
      didAnyQuest = true;
      read = await goToLocationAndReadStats(page, 'stats after fish eye reward');
      if (read.attackHandled) {
        return;
      }
      stats = read.stats;
    }
  }

  if (canRunFishEyeFightNow()) {
    didAttemptNonQQuestThisCycle = true;
    const fightResult = await runNonQQuestSafe(page, 'Fish Eye fight', async () => {
      return await runFishEyeFight(page);
    });

    if (fightResult === null) {
      // Backoff on errors to avoid immediate retry loops.
      S.lastFishEyeRunAt = Date.now();
      nonQQuestFailedThisCycle = true;

      read = await goToLocationAndReadStats(page, 'stats after fish eye fight recovery');
      if (read.attackHandled) {
        return;
      }
      stats = read.stats;
    } else if (fightResult) {
      didAnyQuest = true;

      read = await goToLocationAndReadStats(page, 'stats after fish eye fight');
      if (read.attackHandled) {
        return;
      }
      stats = read.stats;
    } else {
      // fightResult === false: arena reported its own in-game cooldown, already rescheduled
      // and backed out cleanly (no error). Just refresh stats before moving on.
      read = await goToLocationAndReadStats(page, 'stats after fish eye cooldown');
      if (read.attackHandled) {
        return;
      }
      stats = read.stats;
    }
  }

  // Re-check Q after Fish Eye as well.
  if (Number.isFinite(stats.questsAvailable) && stats.questsAvailable > 0) {
    const postFishQPass = await runDailyQuests(page, stats);
    if (postFishQPass.didAnything) {
      didAnyQuest = true;
    }
    hadAnyTargetQuestInQMenu = hadAnyTargetQuestInQMenu || postFishQPass.hasAnyTargetQuest;

    read = await goToLocationAndReadStats(page, 'stats after daily quests (post-fish)');
    if (read.attackHandled) {
      return;
    }
    stats = read.stats;
  }

  // Don't pay the Blake boat fee twice: if we're already at the farm location, ride out a low-HP
  // dead zone in place (falls through to the farm loop below, which will just stay put) instead of
  // taking a "free" Fastway trip to Стоунгард that then requires paying to get back to Blake.
  // (For goblins there's no paid passage, but staying put is harmless and consistent.)
  if (shouldRecoverByStats(stats) && !isFarmLocation(read.text)) {
    console.log('recovery condition met -> go to stoneguard');
    await useRecovery(page);
    return;
  }

  const noTargetQuestsInQ = !hadAnyTargetQuestInQMenu;
  const noNonQQuestDueNow = !canRunAnyNonQQuestNow(stats);
  const canSwitchToFarmNow = noTargetQuestsInQ && noNonQQuestDueNow;

  if (didAnyQuest && !canSwitchToFarmNow) {
    console.log('Some quests were handled this cycle -> skip farm fights');
    scheduleQuestFollowup('quests_progress');
    return;
  }

  // If our configured Q quests are available but we couldn't progress them (errors / missing buttons),
  // don't get stuck in a fast-retry loop: go to the farm if nothing else was done this cycle.
  if (hadAnyTargetQuestInQMenu && !didAnyQuest) {
    console.log(`Target quests are available in Q menu but none were progressed -> go ${FARM_TARGET}`);
  } else if (hadAnyTargetQuestInQMenu) {
    console.log('Target quests are available in Q menu but none were progressed -> retry quests soon');
    scheduleQuestFollowup('quests_available_but_no_progress');
    return;
  }

  // If there are no target quests in Q and a priority non-Q quest is due:
  // - if we DID NOT attempt it this cycle, retry soon
  // - if we attempted it and it failed, continue to the farm (no retry loop)
  if (canRunAnyNonQQuestNow(stats) && !didAttemptNonQQuestThisCycle) {
    console.log('No target Q quests, but a non-Q quest is due -> retry quests soon');
    scheduleQuestFollowup('non_q_due');
    return;
  }

  if (canSwitchToFarmNow && didAnyQuest) {
    console.log(`No target quests remain and no non-Q quest is due -> go ${FARM_TARGET} now`);
  }

  // Прощальный заброс перед переездом на Блейка. Мы всё равно уходим с материка (после квестов /
  // Рыбьего глаза / восстановления мы уже НЕ на острове), а лодка на Блейка всё равно одна и та же —
  // поэтому если дневной лимит рыбы не выбран и кулдаун рыбалки прошёл, делаем ОДНУ попытку на
  // материке (Ивовое озеро бесплатно) и в этом же цикле едем фармить. Фарм не откладывается на
  // будущие циклы (нет return/ожидания) — это чистое использование уже открытого окна вне острова,
  // без лишних платных проходов (лодка на остров всё равно одна). На острове рыбалку по-прежнему
  // пропускаем: !isFarmLocation гарантирует, что с Блейка ради рыбалки мы не уходим.
  if (!isFarmLocation(read.text) && canRunFishingNow()) {
    console.log('Прощальный заброс на материке перед переездом на Блейка');
    await runFishingTask(page);
  }

  let didAnyFarmFight = false;
  while (shouldFightFarmByStats(stats)) {
    console.log('can fight -> start fight');

    try {
      await ensureFarmFightScreen(page);
      await fightLoop(page);
      didAnyFarmFight = true;
    } catch (e) {
      console.log(`Farm fight flow error: ${e.message}`);
      await recoverToCity(page, `${FARM_TARGET}: ${e.message}`);
      // Usually a one-off page-load glitch (empty page, route link not found yet) rather than a
      // real problem -> retry almost immediately instead of sleeping the full default cycle.
      S.nextCycleDelayOverrideMs = 10 * 1000;
      console.log('Retry in 10 sec (farm_fight_flow_error)');
      return;
    }

    read = await goToLocationAndReadStats(page, 'stats after fight');
    if (read.attackHandled) {
      return;
    }
    stats = read.stats;

    await handleUnreadMailIfAny(page);

    read = await goToLocationAndReadStats(page, 'stats after mail check post-fight');
    if (read.attackHandled) {
      return;
    }
    stats = read.stats;

    if (stats.hpCurrent === null || stats.cooldown === null) {
      console.log('failed to parse stats after fight, stop cycle');
      return;
    }

    if (shouldGoLastHouseByStats(stats)) {
      console.log(`post-fight HP < ${LAST_HOUSE_HP_THRESHOLD} (${stats.hpCurrent}) -> Форпост/Последний дом`);
      await runLastHouseRecovery(page);
      return;
    }

    if (shouldGoChaosByStats(stats)) {
      console.log('post-fight HP below zero -> go to chaos fist');
      await goToChaosByAmulet(page);
      return;
    }

    if (shouldFightFarmByStats(stats)) {
      console.log('next fight is available');
      await pause(page, 1000, 2000);
      continue;
    }

    // Stay at the farm location instead of returning to the city — leaving only happens above for
    // negative HP (Последний дом / Кулак хаоса) or (outside this loop) when a quest needs attention.
    // A depleted cooldown alone is not a reason to travel back; staying put means ensureFarmFightScreen
    // can resume next cycle via the Последний портал shortcut instead of re-running the whole route.
    console.log('no condition matched -> stay at farm location, stop cycle');
    scheduleFarmNextCycle(stats, didAnyFarmFight);
    return;
  }

  console.log('nothing to do this cycle');
  scheduleFarmNextCycle(stats, didAnyFarmFight);
}

// ===================================================================================
// Гильдия асассинов (AI__): три независимых задания, доступны при морали <= 0.
// Каждое — свой "zad" в ссылке приёма и свой "lway" в quest-шорткате коня.
// Маршруты записаны по опыту реального прохождения, см. LESSONS_AI_CHAR.md,
// раздел "Квесты, которые требуют формального 'взять задание' у источника".
// Предметы заданий (Часы банкира / Старая картина / Четки торговца) просто копятся —
// сдача ("Доложить о выполнении") заблокирована до 6 уровня персонажа.
// ===================================================================================

// 15.09.2026, живой баг: гильдия асассинов делит с некоторыми Q-квестами (Штольни,
// Колодец Страха) один слот "ответственного задания" на pers.php. Если он занят чем-то
// незавершённым (напр. брошенные вчера Штольни), "Гильдия асассинов" (obj=44) рендерит
// ПУСТУЮ страницу (даже список заданий не показывается), а go=1&zad=N молча ничего не
// делает - "Идти к дому" потом не появляется, и старый код ошибочно решал "уже сделано
// сегодня". Проверяем и снимаем блокер заранее, а не гадаем по отсутствию цели.
async function ensureNoStuckResponsibleTask(page) {
  await page.goto('http://lbast.ru/pers.php', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await pause(page, 500, 1000);
  const text = await getBodyText(page);
  if (!/Текущее задание:\s*Вы выполняете/i.test(text)) {
    return false;
  }
  console.log('Обнаружен занятый слот "ответственного задания" -> отказываюсь, чтобы освободить.');
  // По href mod=dropquest, НЕ по тексту "отказаться": в анкете рядом строка статуи славы со
  // своим "Отказаться" (mod=statuenull), и клик по тексту 17.09.2026 уже снял бафф статуи.
  const dropHref = await page.evaluate(() => {
    const a = Array.from(document.querySelectorAll('a')).find((x) => (x.getAttribute('href') || '').includes('mod=dropquest'));
    return a ? a.getAttribute('href') : null;
  }).catch(() => null);
  if (!dropHref) return false;
  await page.goto(`http://lbast.ru/${dropHref.replace(/^\//, '')}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await pause(page, 800, 1500);
  return true;
}
