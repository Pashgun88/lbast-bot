// Решения по статам (shouldXByStats) + закомментированный старый квест УГО.
// Выделено из ai_char/module.js (там только сборка экспорта). Изменяемое состояние - S из ./state.

// Экспорт стоит ДО require: файлы lib/ вызывают друг друга по кругу, а объявления функций
// всплывают (hoisting), поэтому к моменту любого встречного require все функции уже здесь.
module.exports = {
  shouldGoChaosByStats, shouldGoLastHouseByStats, shouldRecoverByStoneguard,
  shouldRecoverByStoneguardLowHp, shouldRecoverByStats, shouldUseFishByStats, shouldFightByStats,
  shouldFightBlakeByStats,
};

const { BLAKE_MIN_HP, LAST_HOUSE_HP_THRESHOLD } = require('./state');

// UGO quest disabled (no longer needed).
// function isUgoDue() {
//   const key = getDayKeyNow();
//   if (ugoDayKey !== key) {
//     ugoDayKey = key;
//     ugoRunsToday = 0;
//     persistUgoState();
//   }
//
//   if (ugoRunsToday >= UGO_DAILY_LIMIT) {
//     return false;
//   }
//
//   if (!lastUgoRunAt) return true;
//   return Date.now() - lastUgoRunAt >= UGO_INTERVAL_MS;
// }
//
// async function runUgoQuest(page) {
//   console.log('Ugo quest: start');

//   // Конь -> Рыбацкая деревня -> (В пути) -> Кузница мастера Уго -> арена -> бой.
//   await performStep(page, {
//     stepName: '\u041a\u043e\u043d\u044c',
//     currentTexts: ['\u041a\u043e\u043d\u044c', '\u043a\u043e\u043d\u044c'],
//     retries: 3,
//   });

//   await performStep(page, {
//     stepName: '\u0420\u044b\u0431\u0430\u0446\u043a\u0430\u044f \u0434\u0435\u0440\u0435\u0432\u043d\u044f',
//     currentTexts: ['\u0420\u044b\u0431\u0430\u0446\u043a\u0430\u044f \u0434\u0435\u0440\u0435\u0432\u043d\u044f', '\u0440\u044b\u0431\u0430\u0446\u043a\u0430\u044f \u0434\u0435\u0440\u0435\u0432\u043d\u044f'],
//     waitAfterClickMs: 7000,
//     retries: 3,
//   });

//   if (await existsAnyText(page, ['\u0412 \u043f\u0443\u0442\u0438', '\u0432 \u043f\u0443\u0442\u0438'])) {
//     await clickByTexts(page, ['\u0412 \u043f\u0443\u0442\u0438', '\u0432 \u043f\u0443\u0442\u0438'], '\u0412 \u043f\u0443\u0442\u0438');
//     await pause(page, 800, 1600);
//   }

//   await performStep(page, {
//     stepName: '\u041a\u0443\u0437\u043d\u0438\u0446\u0430 \u043c\u0430\u0441\u0442\u0435\u0440\u0430 \u0423\u0433\u043e',
//     currentTexts: ['\u041a\u0443\u0437\u043d\u0438\u0446\u0430 \u043c\u0430\u0441\u0442\u0435\u0440\u0430 \u0423\u0433\u043e', '\u043a\u0443\u0437\u043d\u0438\u0446\u0430 \u043c\u0430\u0441\u0442\u0435\u0440\u0430 \u0443\u0433\u043e'],
//     nextTexts: [
//       '\u041f\u0440\u043e\u0439\u0442\u0438 \u043d\u0430 \u0430\u0440\u0435\u043d\u0443 [\u0437\u0430 360 \u0434\u0438\u043d]',
//       '\u041f\u0440\u043e\u0439\u0442\u0438 \u043d\u0430 \u0430\u0440\u0435\u043d\u0443',
//       '\u043f\u0440\u043e\u0439\u0442\u0438 \u043d\u0430 \u0430\u0440\u0435\u043d\u0443',
//     ],
//     retries: 4,
//   });

//   await performStep(page, {
//     stepName: '\u041f\u0440\u043e\u0439\u0442\u0438 \u043d\u0430 \u0430\u0440\u0435\u043d\u0443 [\u0437\u0430 360 \u0434\u0438\u043d]',
//     currentTexts: [
//       '\u041f\u0440\u043e\u0439\u0442\u0438 \u043d\u0430 \u0430\u0440\u0435\u043d\u0443 [\u0437\u0430 360 \u0434\u0438\u043d]',
//       '\u041f\u0440\u043e\u0439\u0442\u0438 \u043d\u0430 \u0430\u0440\u0435\u043d\u0443',
//       '\u043f\u0440\u043e\u0439\u0442\u0438 \u043d\u0430 \u0430\u0440\u0435\u043d\u0443',
//     ],
//     retries: 3,
//   });

//   // Sometimes the fight starts immediately and the page shows "Ударить" without a separate "В бой!" button.
//   if (!await existsAnyText(page, ['\u0423\u0434\u0430\u0440\u0438\u0442\u044c', '\u0443\u0434\u0430\u0440\u0438\u0442\u044c'])) {
//     if (await existsAnyText(page, ['\u0412 \u0431\u043e\u0439!', '\u0432 \u0431\u043e\u0439!', '\u0412 \u0431\u043e\u0439', '\u0432 \u0431\u043e\u0439'])) {
//       await performStep(page, {
//         stepName: '\u0412 \u0431\u043e\u0439!',
//         currentTexts: ['\u0412 \u0431\u043e\u0439!', '\u0432 \u0431\u043e\u0439!', '\u0412 \u0431\u043e\u0439', '\u0432 \u0431\u043e\u0439'],
//         retries: 4,
//       });
//     } else {
//       console.log('Ugo quest: no fight button detected; assume quest is unavailable/already completed.');
//       lastUgoRunAt = Date.now();
//       persistUgoState();
//       return;
//     }
//   }
//
//   await fightLoop(page);
//
//   lastUgoRunAt = Date.now();
//   const key = getDayKeyNow();
//   if (ugoDayKey !== key) {
//     ugoDayKey = key;
//     ugoRunsToday = 0;
//   }
//   ugoRunsToday += 1;
//   persistUgoState();
//   console.log('Ugo quest: done');
// }

function shouldGoChaosByStats(stats) {
  return stats.hpCurrent < 0;
}

// LAST_HOUSE_HP_THRESHOLD: определено в lib/state.js (константа нужна нескольким файлам).

function shouldGoLastHouseByStats(stats) {
  return typeof stats?.hpCurrent === 'number' && stats.hpCurrent < LAST_HOUSE_HP_THRESHOLD;
}

function shouldRecoverByStoneguard(stats) {
  return stats.cooldown <= 0;
}

// Dead zone: HP is not deeply negative (that's Последний дом's job) but too low to fight Blake
// and quests for this cycle are already done -> wait it out in Стоунгард (safe, can't be attacked)
// instead of idling wherever the last action left the character.
function shouldRecoverByStoneguardLowHp(stats) {
  return stats.hpCurrent >= 0 && stats.hpCurrent < BLAKE_MIN_HP;
}

function shouldRecoverByStats(stats) {
  return shouldRecoverByStoneguard(stats) || shouldRecoverByStoneguardLowHp(stats);
}

function shouldUseFishByStats(stats) {
  return stats.cooldown >= 15 && stats.hpCurrent >= 0 && stats.hpCurrent < 1000;
}

function shouldFightByStats(stats) {
  return stats.hpCurrent >= 1000 && stats.cooldown > 0;
}

// Blake hits harder than goblins, so farming there needs a bigger HP buffer (matches bleyk.js).
function shouldFightBlakeByStats(stats) {
  return stats.hpCurrent >= BLAKE_MIN_HP && stats.cooldown > 0;
}
