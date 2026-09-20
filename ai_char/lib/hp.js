// HP-гейты перед боями, runQuestStepSafe, чтение HP/резерва, ожидание HP.
// Выделено из ai_char/module.js (там только сборка экспорта). Изменяемое состояние - S из ./state.

// Экспорт стоит ДО require: файлы lib/ вызывают друг друга по кругу, а объявления функций
// всплывают (hoisting), поэтому к моменту любого встречного require все функции уже здесь.
module.exports = {
  hpFractionForGate, noteHpFromPageText, questFightHpGate, preTripHpGate, lowHpBeforeFightQuest,
  runQuestStepSafe, readHpFromLocationInNewTab, readReserveFromLocationInNewTab, getHpCurrentSafe,
  getReserveMinutesSafe, waitForReserveAtLeast, waitForHpAbove, tryPerformStepOptional,
};

const { S, EXCLUSIVE_QUEST_ERROR_BACKOFF_MS, QUEST_FIGHT_HP_FLOOR, isNoFightMode, PEACEFUL_QUESTS } = require('./state');
const { fixedPause, getBodyText, parseStats, pause } = require('./core');
const { handleIncomingAttackIfAny } = require('./pvp');
const { recoverToCity } = require('./recovery');
const { clickByTexts, existsAnyClickable, existsAnyText, performStep } = require('./ui');

// S.characterDownDetected: объявлено в lib/state.js (всё изменяемое состояние - там).

// S.lastKnownHp: объявлено в lib/state.js (всё изменяемое состояние - там).

// Доля HP для гейта перед боем: берём свежее чтение, если оно есть, иначе последнее
// достоверное. null означает "узнать не удалось" - вызывающий ОБЯЗАН считать это запретом боя.
function hpFractionForGate(preStats) {
  const current = typeof preStats?.hpCurrent === 'number' ? preStats.hpCurrent : S.lastKnownHp.current;
  const max = typeof preStats?.hpMax === 'number' ? preStats.hpMax : S.lastKnownHp.max;
  if (typeof current !== 'number' || typeof max !== 'number' || max <= 0) return null;
  return current / max;
}

function noteHpFromPageText(text, label) {
  const stats = parseStats(text);
  if (typeof stats.hpCurrent !== 'number') return S.characterDownDetected;
  S.lastKnownHp = { current: stats.hpCurrent, max: stats.hpMax, at: Date.now() };
  const wasDown = S.characterDownDetected;
  S.characterDownDetected = stats.hpCurrent <= 0;
  if (S.characterDownDetected && !wasDown) {
    console.log(`ВНИМАНИЕ: после "${label}" HP=${stats.hpCurrent}/${stats.hpMax} - персонаж выбыл из строя, обрываю очередь квестов.`);
  }
  return S.characterDownDetected;
}

// QUEST_FIGHT_HP_FLOOR: определено в lib/state.js (константа нужна нескольким файлам).

// Проверка перед боем. ВАЖНО: боевые экраны ("В бой!") шапку со статами не рендерят, поэтому
// здесь нельзя писать `typeof hp === 'number' && hp < max*0.7` - на null все условия ложны и
// гейт молча пропускает бой. hpFractionForGate падает на последнее достоверное чтение, а если
// и его нет - возвращает null, и это ЗАПРЕТ боя, а не разрешение.
async function questFightHpGate(
  page,
  label,
  floor = QUEST_FIGHT_HP_FLOOR,
  { waitForRecovery = false, maxWaitMs = 40 * 60 * 1000 } = {},
) {
  const text = await getBodyText(page).catch(() => '');
  const stats = parseStats(text);
  noteHpFromPageText(text, `${label}: перед боем`);
  // 18.09.2026: после перезапуска драйвера последнего замера нет, а экран у Демона озера статов
  // не рендерит -> гейт отказал вслепую при реальных 334/380, уже стоя у демона. Нет статов на
  // экране - меряем во второй вкладке, а не объявляем HP неизвестным.
  if (typeof stats.hpCurrent !== 'number') await readHpFromLocationInNewTab(page);
  const frac = hpFractionForGate(stats);

  // Паша, 17.09.2026: "ты не выполнил харчевню а уже идешь выполнять другое задание, нужно
  // закончить харчевню". Для таких квестов отказ от боя - неправильная реакция: лечение
  // ~14 hp/мин, до порога обычно 2-5 минут. Ждём восстановления во ВТОРОЙ вкладке, чтобы не
  // трогать сцену квеста (waitForHpAbove делает page.reload() - на экране NPC так нельзя).
  // Ждём только при ЧИТАЕМОМ HP: null означает "проверить нечем", и это по-прежнему отказ.
  if (waitForRecovery && frac !== null && frac < floor && S.lastKnownHp.max > 0) {
    const need = Math.ceil(S.lastKnownHp.max * floor);
    console.log(`${label}: HP ${Math.round(frac * 100)}% < ${Math.round(floor * 100)}% -> жду восстановления до ${need}/${S.lastKnownHp.max}, квест не бросаю.`);
    const deadline = Date.now() + maxWaitMs;
    while (Date.now() < deadline) {
      await fixedPause(page, 60_000);
      const hpNow = await readHpFromLocationInNewTab(page);
      if (typeof hpNow !== 'number') continue;
      S.lastKnownHp = { current: hpNow, max: S.lastKnownHp.max, at: Date.now() };
      console.log(`${label}: HP ${hpNow}/${S.lastKnownHp.max} (нужно ${need})`);
      if (hpNow >= need) {
        console.log(`${label}: HP восстановилось -> иду в бой.`);
        return true;
      }
    }
    console.log(`${label}: HP не восстановилось за отведённое время -> ухожу с боевого экрана.`);
  }

  if (frac === null || frac < floor) {
    const shown = frac === null
      ? 'HP не читается ни на экране, ни по последнему замеру'
      : `${Math.round(frac * 100)}% < ${Math.round(floor * 100)}%`;
    console.log(`${label}: HP-гейт не пройден (${shown}) -> в бой не иду, вернусь в следующем цикле.`);
    // ОБЯЗАТЕЛЬНО уйти с боевого экрана. 17.09.2026, живой случай: гейт отказался от боя с
    // огненной лисой на 59%, но персонаж остался стоять на экране с кнопкой "В бой!", и в
    // начале следующего цикла handleIncomingAttackIfAny принял её за нападение и залез в тот
    // же самый бой в обход гейта. Отказ от боя обязан ещё и разоружать экран.
    // Список выходов НЕ ограничивается "Вернуться": живой случай 17.09.2026 - на арене
    // Рыбьего глаза такой ссылки нет ("уйти с экрана боя: ни одного варианта: Вернуться"),
    // поэтому отказ не разоружил экран, бой остался висеть и заблокировал игру целиком
    // (location.php отдавал голый "В бой!" со ссылкой на arena_go.php).
    await clickByTexts(
      page,
      ['Вернуться', 'вернуться', 'Уйти', 'уйти', 'Убежать', 'убежать', 'Выскочить из комнаты', 'Выйти из дома'],
      `${label}: уйти с экрана боя`,
    ).catch(() => {});
    await page
      .goto('http://lbast.ru/location.php', { waitUntil: 'domcontentloaded', timeout: 60000 })
      .catch(() => {});
    return false;
  }
  return true;
}

// Гейт "до выхода из дома". questFightHpGate отказывается от боя, уже СТОЯ на боевом экране,
// и потому обязан уметь с него уйти. Но бывают места, где ссылки выхода нет вовсе: живой
// случай 17.09.2026 - арена "Рыбьего глаза". Гейт честно отказался от боя на 52%, ни один из
// восьми вариантов выхода ("Вернуться"/"Уйти"/"Убежать"/...) на экране не нашёлся, бой остался
// висеть, и location.php четыре цикла подряд отдавал голый "В бой!" -> arena_go.php: ни статов,
// ни Q-меню, ни дейликов. Драйвер при этом не падает - он послушно ждёт по 16 минут.
// Вывод общий: перебирать слова выхода бесполезно, отказываться надо ТАМ, ГДЕ ЕЩЁ МОЖНО УЙТИ,
// то есть до входа. Сюда же относится любой маршрут в один конец.
async function preTripHpGate(page, label, floor = QUEST_FIGHT_HP_FLOOR) {
  await page
    .goto('http://lbast.ru/location.php', { waitUntil: 'domcontentloaded', timeout: 60000 })
    .catch(() => {});
  const text = await getBodyText(page).catch(() => '');
  noteHpFromPageText(text, `${label}: перед выходом`);
  const frac = hpFractionForGate(parseStats(text));
  if (frac === null || frac < floor) {
    const shown = frac === null
      ? 'HP не читается ни на экране, ни по последнему замеру'
      : `${Math.round(frac * 100)}% < ${Math.round(floor * 100)}%`;
    console.log(`${label}: HP-гейт не пройден (${shown}) -> никуда не иду, вернусь в следующем цикле.`);
    return false;
  }
  return true;
}

// Гейт очереди квестов: решение "идти ли в боевой квест" принимается ДО первого шага, пока
// персонаж стоит в меню заданий. 18.09.2026 два квеста подряд (Харчевня, Корованы) держали свой
// гейт после клика, который уже запирает в бою, и отказ на низком HP оставлял персонажа на
// экране боя без выхода. Здесь страница не меняется (квесты стартуют с открытого Q-меню):
// читаем HP из текущего текста, иначе берём последний замер. Пропускаем только при ИЗВЕСТНОМ
// низком HP; null пропускает дальше - там стоят внутренние гейты квеста.
// Исключительные квесты (Харчевня, Кузница Рума, Галерея) сюда не входят: они ждут HP сами.
const QUEUE_GATED_FIGHT_QUESTS = new Set([
  'Камни Драбаса',
  'Грабим корованы',
  'Гильдия асассинов: банкир',
  'Гильдия асассинов: картина',
  'Гильдия асассинов: торговец',
  'Demon lake quest',
  'Ордо: главарь банды',
  'Ордо: банда',
  'Shipwreck quest',
]);

async function lowHpBeforeFightQuest(page, label) {
  if (!QUEUE_GATED_FIGHT_QUESTS.has(label)) return false;
  const text = await getBodyText(page).catch(() => '');
  const stats = parseStats(text);
  // Q-меню шапку со статами не рендерит, и hpFractionForGate падал на последний замер - а тот
  // обновляется только на страницах со статами. Живой случай 18.09.2026: HP уже 110/380, гейт
  // всё твердил "25%" (замер 96), и так заблокировал бы боевые квесты навсегда. Поэтому без
  // статов на экране меряем свежо во второй вкладке (Q-меню не трогаем).
  if (typeof stats.hpCurrent !== 'number') {
    await readHpFromLocationInNewTab(page); // сам обновляет lastKnownHp (текущее и максимум)
  }
  const frac = hpFractionForGate(stats);
  if (frac === null || frac >= QUEST_FIGHT_HP_FLOOR) return false;
  console.log(`${label}: HP-гейт очереди не пройден (${Math.round(frac * 100)}% < ${Math.round(QUEST_FIGHT_HP_FLOOR * 100)}%) -> квест не начинаю, вернусь в следующем цикле.`);
  return true;
}

async function runQuestStepSafe(page, label, fn) {
  // Режим без боёв (приказ Паши письмом 20.09.2026): из дневных квестов оставляем только мирные.
  if (isNoFightMode() && !PEACEFUL_QUESTS.has(label) && !/^Травы/i.test(label)) {
    console.log(`Quest step skip (режим без боёв): ${label}`);
    return false;
  }
  if (S.characterDownDetected) {
    console.log(`Quest step skip (персонаж выбыл из строя): ${label}`);
    return false;
  }
  if (await lowHpBeforeFightQuest(page, label)) return false;
  try {
    const ok = await fn();
    if (ok) {
      if (label === 'Харчевня' && !S.tavernDoneToday) {
        console.log(`Quest step progress: ${label} (not turned in yet)`);
      } else if (label === 'Штольни' && !S.shtolniDoneToday) {
        console.log(`Quest step progress: ${label} (not finished yet)`);
      } else {
        console.log(`Quest step OK: ${label}`);
      }
      if (label === 'Харчевня') S.tavernFailStreak = 0;
      if (label === 'Штольни') S.shtolniFailStreak = 0;
    } else {
      console.log(`Quest step skip: ${label}`);
    }
    noteHpFromPageText(await getBodyText(page), label);
    return ok;
  } catch (e) {
    console.log(`Quest step error (${label}): ${e.message}`);
    // Текст ошибки шага содержит страницу целиком - HP там обычно видно, и именно так мы
    // ловим смерть, случившуюся внутри провалившегося шага.
    noteHpFromPageText(e.message, label);
    await recoverToCity(page, `${label}: ${e.message}`);
    noteHpFromPageText(await getBodyText(page), label);

    if (label === 'Харчевня') {
      S.tavernFailStreak++;
      if (S.tavernFailStreak >= 2) {
        S.tavernSuppressedUntil = Date.now() + EXCLUSIVE_QUEST_ERROR_BACKOFF_MS;
        console.log('Tavern quest: repeated errors -> backoff 15 min and continue other actions');
      } else {
        console.log(`Tavern quest: error streak=${S.tavernFailStreak}`);
      }
    }
    if (label === 'Штольни') {
      S.shtolniFailStreak++;
      if (S.shtolniFailStreak >= 2) {
        S.shtolniSuppressedUntil = Date.now() + EXCLUSIVE_QUEST_ERROR_BACKOFF_MS;
        console.log('Shtolni quest: repeated errors -> backoff 15 min and continue other actions');
      } else {
        console.log(`Shtolni quest: error streak=${S.shtolniFailStreak}`);
      }
    }

    return false;
  }
}

async function readHpFromLocationInNewTab(page) {
  // 18.09.2026: клик по песчаннику УЖЕ открывает бой, а гейт с ожиданием стоит после него.
  // Пока бой висит, location.php отдаёт голый "В бой!" без статов -> здесь был null каждую
  // минуту, ожидание 40 минут крутилось вслепую без единой строки в логе. Анкета (pers.php)
  // показывает "(HP/max)" даже в висящем бою - она запасной источник.
  // Вкладка закрывается в finally: раньше при обрыве goto она оставалась открытой навсегда.
  let temp = null;
  try {
    temp = await page.context().newPage();
    await temp.goto('http://lbast.ru/location.php', { waitUntil: 'domcontentloaded', timeout: 60000 });
    const stats = parseStats(await temp.locator('body').innerText().catch(() => ''));
    if (typeof stats.hpCurrent === 'number') {
      if (typeof stats.hpMax === 'number') S.lastKnownHp = { current: stats.hpCurrent, max: stats.hpMax, at: Date.now() };
      return stats.hpCurrent;
    }
    await temp.goto('http://lbast.ru/pers.php', { waitUntil: 'domcontentloaded', timeout: 60000 });
    const m = (await temp.locator('body').innerText().catch(() => '')).match(/\((-?\d+)\s*\/\s*(\d+)\)/);
    if (!m) return null;
    S.lastKnownHp = { current: Number(m[1]), max: Number(m[2]), at: Date.now() };
    return Number(m[1]);
  } catch (e) {
    return null;
  } finally {
    if (temp) await temp.close().catch(() => {});
  }
}

async function readReserveFromLocationInNewTab(page) {
  try {
    const ctx = page.context();
    const temp = await ctx.newPage();

    await temp.goto('http://lbast.ru/location.php', {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });

    const text = await temp.locator('body').innerText().catch(() => '');
    const stats = parseStats(text);

    await temp.close().catch(() => {});
    return typeof stats.reserveMinutes === 'number' ? stats.reserveMinutes : stats.cooldown;
  } catch (e) {
    return null;
  }
}

async function getHpCurrentSafe(page) {
  const text = await getBodyText(page);
  const stats = parseStats(text);
  if (stats.hpCurrent !== null) {
    return stats.hpCurrent;
  }

  return await readHpFromLocationInNewTab(page);
}

async function getReserveMinutesSafe(page) {
  const text = await getBodyText(page);
  const stats = parseStats(text);
  if (typeof stats.reserveMinutes === 'number') {
    return stats.reserveMinutes;
  }
  if (typeof stats.cooldown === 'number') {
    return stats.cooldown;
  }

  return await readReserveFromLocationInNewTab(page);
}

async function waitForReserveAtLeast(page, threshold, { waitMs = 7 * 60 * 1000, maxWaits = 20 } = {}) {
  const summarize = (text, limit = 220) => {
    return String(text || '').replace(/\u00A0/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit);
  };

  for (let attempt = 0; attempt <= maxWaits; attempt++) {
    // Re-reading the same page's DOM without reloading it returns the same stale
    // reserve value forever (the header is server-rendered, not live-updating).
    // Reload so the header actually reflects current server state before checking.
    if (attempt > 0) {
      await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
    }

    // While waiting, an incoming attack can appear. Handle it as soon as possible.
    try {
      const text = await getBodyText(page);
      const attackHandled = await handleIncomingAttackIfAny(page, text);
      if (attackHandled) {
        // We may have navigated into/out of fight; continue loop and re-check reserve.
        await pause(page, 800, 1600);
      }
    } catch (e) {
      if (/^hp_big_negative/.test(String(e?.message || ''))) throw e;
      // ignore other errors
    }

    const reserve = await getReserveMinutesSafe(page);
    if (typeof reserve === 'number') {
      console.log(`Reserve check: ${reserve} (need >= ${threshold})`);
      if (reserve >= threshold) return true;
    } else {
      console.log(`Reserve check: could not parse (need >= ${threshold})`);
    }

    if (attempt === maxWaits) {
      return false;
    }

    const minutes = Math.round(waitMs / 60000);
    try {
      const url = page.url();
      const pageText = await getBodyText(page);
      console.log(`Reserve wait context: url=${url} page="${summarize(pageText)}"`);
    } catch (e) {
      // ignore
    }
    console.log(`Reserve too low, wait ${minutes} min...`);
    await fixedPause(page, waitMs);
  }

  return false;
}

async function waitForHpAbove(page, threshold, { waitMs = 5 * 60 * 1000, maxWaits = 24 } = {}) {
  for (let attempt = 0; attempt <= maxWaits; attempt++) {
    // Same staleness issue as the reserve gate: without a reload the DOM keeps
    // showing the HP value from whenever the page was last loaded.
    if (attempt > 0) {
      await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
    }

    const hp = await getHpCurrentSafe(page);
    if (hp !== null) {
      console.log(`HP check: ${hp} (need > ${threshold})`);
      if (hp > threshold) {
        return true;
      }
    } else {
      console.log(`HP check: could not parse (need > ${threshold})`);
    }

    if (attempt === maxWaits) {
      return false;
    }

    const minutes = Math.round(waitMs / 60000);
    console.log(`HP too low, wait ${minutes} min...`);
    await fixedPause(page, waitMs);
  }

  return false;
}

async function tryPerformStepOptional(
  page,
  {
    stepName,
    currentTexts,
    nextTexts,
    waitAfterClickMs,
    waitForCurrentMs = 0,
    waitForNextMs = 0,
    clickFn = null,
    skipIfNextVisible = true,
    force = false,
  } = {}
) {
  if (skipIfNextVisible && nextTexts?.length > 0 && await existsAnyClickable(page, nextTexts)) {
    return true;
  }

  if (!force) {
    let exists = await existsAnyText(page, currentTexts || []);
    if (!exists && waitForCurrentMs > 0) {
      const started = Date.now();
      while (!exists && Date.now() - started < waitForCurrentMs) {
        await pause(page, 150, 250);
        exists = await existsAnyText(page, currentTexts || []);
      }
    }
    if (!exists) {
      return false;
    }
  }

  await performStep(page, {
    stepName,
    currentTexts,
    nextTexts,
    waitAfterClickMs,
    retries: 3,
    waitForNextMs,
    clickFn,
    skipIfNextVisible,
  });

  return true;
}
