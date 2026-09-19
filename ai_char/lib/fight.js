// Цикл боя fightLoop.
// Выделено из ai_char/module.js (там только сборка экспорта). Изменяемое состояние - S из ./state.

// Экспорт стоит ДО require: файлы lib/ вызывают друг друга по кругу, а объявления функций
// всплывают (hoisting), поэтому к моменту любого встречного require все функции уже здесь.
module.exports = {
  fightLoop,
};

const { HEALING_ELIXIR_HP_FRACTION } = require('./state');
const { getBodyText, parseStats, pause } = require('./core');
const { equipNextHealingElixir, tryUseHealingElixir } = require('./recovery');
const { clickByTexts, existsAnyText } = require('./ui');

async function fightLoop(page) {
  const UDAR = '\u0423\u0434\u0430\u0440\u0438\u0442\u044c';
  const SKILL = '\u0423\u043c\u0435\u043d\u0438\u0435';
  const START_FIGHT_TEXTS = [
    '\u0412 \u0431\u043e\u0439!',
    '\u0432 \u0431\u043e\u0439!',
    '\u0412 \u0431\u043e\u0439',
    '\u0432 \u0431\u043e\u0439',
    '\u0412\u0441\u0442\u0443\u043f\u0438\u0442\u044c \u0432 \u0431\u043e\u0439',
    '\u0432\u0441\u0442\u0443\u043f\u0438\u0442\u044c \u0432 \u0431\u043e\u0439',
    '\u041f\u0440\u0438\u043d\u044f\u0442\u044c \u0431\u043e\u0439',
    '\u043f\u0440\u0438\u043d\u044f\u0442\u044c \u0431\u043e\u0439',
  ];
  const DONE_TEXTS = [
    '\u0411\u043e\u0439 \u0437\u0430\u0432\u0435\u0440\u0448\u0435\u043d!',
    '\u0412\u0435\u0440\u043d\u0443\u0442\u044c\u0441\u044f',
    '\u0432\u0435\u0440\u043d\u0443\u0442\u044c\u0441\u044f',
  ];
  const RESET_PAIRS_TEXTS = ['\u0421\u0431\u0440\u043e\u0441\u0438\u0442\u044c \u043f\u0430\u0440\u044b', '\u0441\u0431\u0440\u043e\u0441\u0438\u0442\u044c \u043f\u0430\u0440\u044b'];
  const RECEPTION_TEXTS = ['\u041f\u0440\u0438\u0435\u043c', '\u043f\u0440\u0438\u0435\u043c', '\u041f\u0440\u0438\u0451\u043c', '\u043f\u0440\u0438\u0451\u043c'];

  // Если несколько итераций подряд на странице нет ничего боевого (ни "Бой завершен"/"Вернуться",
  // ни "В бой"/"Сбросить пары", ни "Ударить") — значит мы не на боевом экране (маршрут не довёл до
  // боя). Не крутим 300 итераций (~10 мин), а быстро бросаем ошибку -> цикл восстановится.
  const MAX_STUCK = 10;
  let stuck = 0;
  // Ограничение на попытки эликсира в рамках одного боя — без этого при исчерпании запаса
  // (obычно всего 1-2 шт. на весь инвентарь) цикл будет бесконечно "лечиться" вместо ударов.
  // Было 1. Одной попытки на бой мало: эликсир даёт +40 HP, а один удар снимает больше, так
  // что в длинном бою лечиться нужно не раз. Ограничение сверху нужно ТОЛЬКО чтобы не
  // зациклиться, когда эликсиры кончились, - но это и так ловит сам tryUseHealingElixir
  // (возвращает false на "Предмет не найден!"), поэтому 3 здесь просто страховка.
  const MAX_ELIXIR_USES_PER_FIGHT = 3;
  let elixirUsesThisFight = 0;

  for (let i = 0; i < 300; i++) {
    const text = await getBodyText(page);

    if (await existsAnyText(page, DONE_TEXTS)) {
      const ok = await clickByTexts(page, DONE_TEXTS, 'fight done/return');
      if (!ok) throw new Error('fight_done_click_failed');
      await pause(page, 800, 2000);
      return true;
    }

    // Repeatable hunt targets (Гарпия/Бизон/etc.) have a real in-game per-target cooldown:
    // "Вы слишком устали, приходите через N мин." Ported from Tsunami's daily_quests_piraty.js
    // (commit fb9dea7, 16.09.2026) - detect it and throw a distinguishable error instead of
    // burning through MAX_STUCK iterations hunting for a fight that isn't there right now.
    const tiredMatch = text.match(/Вы\s+слишком\s+устали.{0,40}?через\s+(\d+)\s*мин/i);
    if (tiredMatch) {
      throw new Error(`fight_target_cooldown:${Number(tiredMatch[1]) || 1}`);
    }

    // Sometimes we are on a pre-fight page and must click "В бой" first.
    if (!/Ударить/i.test(text)) {
      const startOk = await clickByTexts(page, START_FIGHT_TEXTS, '\u0412 \u0431\u043e\u0439');
      if (startOk) {
        stuck = 0;
        await pause(page, 800, 1800);
        continue;
      }

      // "\u041f\u0430\u0440\u044b" can build up mid-fight and block further hits until reset.
      const resetOk = await clickByTexts(page, RESET_PAIRS_TEXTS, '\u0421\u0431\u0440\u043e\u0441\u0438\u0442\u044c \u043f\u0430\u0440\u044b');
      if (resetOk) {
        stuck = 0;
        await pause(page, 800, 1800);
        continue;
      }

      // \u041d\u0438 \u0431\u043e\u0435\u0432\u043e\u0433\u043e \u044d\u043a\u0440\u0430\u043d\u0430, \u043d\u0438 \u043a\u043d\u043e\u043f\u043a\u0438 \u0441\u0442\u0430\u0440\u0442\u0430 \u0431\u043e\u044f \u2014 \u0432\u0435\u0440\u043e\u044f\u0442\u043d\u043e, \u043c\u044b \u043d\u0435 \u043d\u0430 \u0431\u043e\u0435\u0432\u043e\u0439 \u0441\u0442\u0440\u0430\u043d\u0438\u0446\u0435.
      stuck += 1;
      if (stuck >= MAX_STUCK) {
        throw new Error('fight_not_reached');
      }
      await pause(page, 700, 1500);
      continue;
    }

    // "Прием" is an optional pre-hit action, available in most bot fights (quests, farm, etc.)
    // but not always shown - in paired-bot fights it can appear on only one of the two bots.
    // Use it whenever HP drops below 75% max, then proceed to the normal hit.
    const stats = parseStats(text);

    // Эликсир лечения (HP+40), экипированный в подсумок, доступен в бою через "Пояс" ->
    // "Использовать Эликсир лечения". Порог и число попыток - см. HEALING_ELIXIR_HP_FRACTION
    // и MAX_ELIXIR_USES_PER_FIGHT: жмём Пояс при критическом HP, а не на каждый чих, но и не
    // ровно один раз за бой.
    if (
      elixirUsesThisFight < MAX_ELIXIR_USES_PER_FIGHT &&
      typeof stats.hpCurrent === 'number' &&
      typeof stats.hpMax === 'number' &&
      stats.hpMax > 0 &&
      stats.hpCurrent < stats.hpMax * HEALING_ELIXIR_HP_FRACTION
    ) {
      const usedElixir = await tryUseHealingElixir(page);
      if (usedElixir) {
        elixirUsesThisFight += 1;
        // Подсумок только что опустел - сразу заряжаем следующий, не дожидаясь конца боя.
        await equipNextHealingElixir(page).catch(() => false);
        stuck = 0;
        await pause(page, 800, 1600);
        continue;
      }
    }

    if (
      typeof stats.hpCurrent === 'number' &&
      typeof stats.hpMax === 'number' &&
      stats.hpMax > 0 &&
      stats.hpCurrent < stats.hpMax * 0.75 &&
      await existsAnyText(page, RECEPTION_TEXTS)
    ) {
      const receptionOk = await clickByTexts(page, RECEPTION_TEXTS, 'Прием');
      if (receptionOk) {
        await pause(page, 500, 1200);
      }
    }

    if (process.env.AI_DEBUG_FIGHT === '1') {
      console.log('===== FIGHT SCREEN DEBUG =====\n' + text + '\n===== END =====');
    }

    // "Умение" (16.09.2026, Паша: "в бою используй умение - теперь это удар") - отдельная
    // от "Ударить" боевая кнопка, которая САМА бьёт по клику (не подменю) - подтверждено
    // вживую: клик по "Умение" сразу дал "AI__ бьет в голень Бизон, нанеся урон на 19" и
    // после этого кнопка "Умение" пропала из ряда (Обновить/Ударить/Пояс/Инв. без неё) до
    // восстановления - т.е. у умения свой отдельный кулдаун. Используем его КАЖДЫЙ раз,
    // когда оно доступно, вместо обычного "Ударить" (не вместе - это альтернативный удар
    // за тот же ход, не пред-действие вроде "Прием").
    const usedSkill = await clickByTexts(page, [SKILL, SKILL.toLowerCase()], SKILL).catch(() => false);
    if (usedSkill) {
      stuck = 0;
      await pause(page, 1000, 2000);
      continue;
    }

    const ok = await clickByTexts(page, [UDAR, UDAR.toLowerCase()], UDAR);
    if (!ok) {
      stuck += 1;
      if (stuck >= MAX_STUCK) {
        throw new Error('fight_stuck');
      }
      await pause(page, 700, 1800);
      continue;
    }

    stuck = 0;
    await pause(page, 1000, 2000);
  }

  throw new Error('fight_timeout');
}
