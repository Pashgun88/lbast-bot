// Драйвер для персонажа AI__ — раскачка отдельного низкоуровневого персонажа.
// НЕ связан с manager_bot.js / daily_quests_piraty.js (это отдельный аккаунт lbast.ru,
// отдельный профиль браузера ai_char/chrome-profile-ai-char). Основного персонажа не трогает.
//
// Запуск: node ai_char/driver.js
// Переменная окружения AI_MAX_CYCLES (по умолчанию 6) — сколько циклов сделать за запуск.

const { chromium } = require('playwright');
const path = require('path');
const { runGuideQuestsIfDue } = require('./guides/quests');

// dotenv лежал в зависимостях, но его никто не подключал: .env в корне репозитория не читался
// вовсе, и AI_LOGIN/AI_PASS появлялись только если их вручную экспортировали в шелле. До сих
// пор это не всплывало потому, что сессия жила в профиле Chrome и логин не требовался ни разу,
// - но при смерти сессии драйвер молча выходил с кодом 1. Подключаем ДО require('./module'):
// module.js читает process.env на этапе загрузки.
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
// Паша, 19.09.2026 (экономия токенов): нестандартные случаи драйвер сам шлёт в Telegram, а на чат
// отвечает Haiku (chat_autoreply.js) - Claude больше не нужно держать монитор над логом.
require('./telegram_alerts').installAlertHook();
const { handleChatTrigger } = require('./chat_autoreply');
const chatMemory = require('./chat_memory');

const {
  doScenario,
  runDailyQuests,
  getBodyText,
  parseStats,
  handleUnreadMailIfAny,
  pause,
  runAssassinGuildQuestsIfAvailable,
  runGalleryQuestIfAvailable,
  runFishEyeIfDue,
  runPodvalyFarmRound,
  runHarpyFarmRound,
  runBisonFarmRound,
  runBoarFarmRound,
  runDemonLakeQuestIfAvailable,
  runShipwreckQuestIfAvailable,
  runFishRestaurantQuestIfAvailable,
  handleIncomingAttackIfAny,
  ensureHealingGearEquipped,
  ensureBuffAlesActive,
  isAnyBuffAleActive,
  runHerbQuestsIfAvailable,
  runThursdayDailiesIfAvailable,
  runWeekdayHuntsIfDue,
  hasPendingFightQuests,
  escapeStuckSceneIfAny,
  resolvePendingFightIfAny,
  runFishingIfDue,
  fryFishWhileHealing,
  runOrdoQuestsIfAvailable,
  runChatMonitorCycle,
  runStatueOfGloryIfDue,
  runShepotQuestIfAvailable,
  runDovolstvieIfAvailable,
} = require('./module');

const LOGIN = process.env.AI_LOGIN;
const PASS = process.env.AI_PASS;
// Паша: "идём без лимита, потом установим лимит по времени, а не по циклам" - раньше
// был AI_MAX_CYCLES=200, что останавливало фарм после исчерпания счётчика (не баг, но не
// то, что нужно - обнаружено 16.09.2026, когда драйвер тихо доработал до "FINAL STATE" и
// перестал фармить). Infinity по умолчанию убирает этот стоп; переменная окружения всё
// ещё может задать конкретное число, если понадобится вручную ограничить прогон.
const MAX_CYCLES = Number(process.env.AI_MAX_CYCLES || Infinity);

// Наблюдаемая скорость регена (страница профиля пишет "Лечение: 16 hp/мин.").
// Считаем сами, когда персонаж будет здоров, вместо того чтобы гонять его в новые бои с низким HP.
const HEAL_RATE_HP_PER_MIN = 16;

// Одиночные необязательные бои вне сюжетных квестов (Рыбий глаз, будущий "слизняк" и т.п.) —
// по прямой просьбе Паши идти в такой бой только при HP > 50% от максимума, чтобы не ловить
// поражение на ровном месте ради необязательной активности.
// 15.09.2026: живой КО - зашли в бой "Рыбий глаз" на 179/330 (54%), эликсир ни разу не сработал
// (видимо, урон одним ударом перепрыгнул через порог 30%), итог -12 HP. 50% оказалось
// недостаточным запасом против всплеска урона - поднято до 70% (тот же вывод, что раньше
// сделали для банкира асассинов после его живого КО).
const OPTIONAL_FIGHT_MIN_HP_FRACTION = 0.7;
function hasEnoughHpForOptionalFight(stats) {
  if (typeof stats.hpCurrent !== 'number' || typeof stats.hpMax !== 'number') return false;
  return stats.hpCurrent > stats.hpMax * OPTIONAL_FIGHT_MIN_HP_FRACTION;
}

// Единый хелпер для каждого необязательного/дневного шага цикла - зеркалит
// `runQuestStepSafe`/`runNonQQuestSafe` у Tsunami (`daily_quests_piraty.js`): ловит
// ошибку шага, логирует HP после успешного шага, и если оно упало до 0 - сразу уходит в
// waitForHeal вместо того, чтобы гонять дальше по остальным шагам цикла вслепую.
// Раньше этот блок (try/catch + чтение HP + сравнение) был вручную скопирован 8 раз.
// Фарм-сессия. Паша, 18.09.2026: "ты не бегай по 1 бою на бизона и кабана, можешь по часам
// как-то или по полдня". Раньше каждый цикл делал ОДИН бой и потом целый круг проверок квестов,
// статуи, писем, лечения - боёв выходило 4-8 в час. Когда боевые квесты на сегодня закрыты,
// крутим только ферму: бизон, кабан, при HP ниже 70% - лечение в Кулаке Хаоса (там дом) до 95%.
// Длина сессии - AI_FARM_SESSION_MIN (по умолчанию 60 мин, для "полдня" - 360).
const FARM_SESSION_MIN = Number(process.env.AI_FARM_SESSION_MIN || 60);
const FARM_HEAL_TARGET = 0.95;
// До какого HP лечимся, когда ждут квесты с боями (порог входа в них - 70%, берём с запасом).
const QUEST_HEAL_TARGET = 0.85;

// Сон с 23:00 до 05:00 (Паша, 19.09.2026: «уходи спать с 23:00 по 05:00 - солдатский сон короткий
// но крепкий»). Во сне ни фарма, ни квестов, ни чата. Спать уходит домой, в Кулак Хаоса. Подъём в
// 05:00 плюс 0-15 минут, чтобы не вставать секунда в секунду. Строка в лог раз в 10 минут: сторож
// telegram_alerts иначе примет сон за зависание (лог молчит 15 мин).
const SLEEP_FROM_HOUR = 23;
const SLEEP_TO_HOUR = 5;
function isSleepTime(d = new Date()) {
  const h = d.getHours();
  return h >= SLEEP_FROM_HOUR || h < SLEEP_TO_HOUR;
}
async function sleepUntilMorning(page) {
  const wake = new Date();
  if (wake.getHours() >= SLEEP_FROM_HOUR) wake.setDate(wake.getDate() + 1);
  wake.setHours(SLEEP_TO_HOUR, Math.floor(Math.random() * 16), 0, 0);
  // Висящий бой не оставляем на ночь: во сне HP не лечится, пока бой открыт.
  await resolvePendingFightIfAny(page).catch(() => false);
  await page.goto('http://lbast.ru/location.php?mod=fastway&lway=4', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  const hhmm = (d) => d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  console.log(`Сон: отбой в ${hhmm(new Date())}, дома в Кулаке Хаоса; подъём в ${hhmm(wake)}.`);
  while (Date.now() < wake.getTime()) {
    await new Promise((r) => setTimeout(r, Math.min(10 * 60_000, Math.max(1000, wake.getTime() - Date.now()))));
    if (Date.now() < wake.getTime()) console.log(`Сон: сплю, подъём в ${hhmm(wake)}.`);
  }
  console.log('Сон: подъём!');
}

// 19.09.2026 драйвер ~30 мин стоял в цикле лечения при полном HP (Паша: «кажется страница зависла»):
// вызов страницы (evaluate/innerText) не вернулся, а сторож лога молчал, потому что писал чат.
// Теперь у шагов лечения есть предел: не уложился - пишем «Зависание» (уходит в Telegram) и
// перезагружаем вкладку.
async function withHangGuard(page, label, ms, fn) {
  let timer;
  const hang = new Promise((resolve) => { timer = setTimeout(() => resolve(HANG), ms); });
  const res = await Promise.race([fn(), hang]);
  clearTimeout(timer);
  if (res !== HANG) return res;
  console.log(`Зависание: ${label} не вернулся за ${Math.round(ms / 60000)} мин - перезагружаю вкладку.`);
  await page.goto('about:blank', { timeout: 30000 }).catch(() => {});
  return undefined;
}
const HANG = Symbol('hang');

async function readLocationStats(page) {
  const st = await withHangGuard(page, 'замер HP', 3 * 60_000, async () => {
    await page.goto('http://lbast.ru/location.php', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    return parseStats(await getBodyText(page).catch(() => ''));
  });
  return st || {};
}

// Паша, 18.09.2026: "копи, и смотри, выгоднее всего если кож будет равное количество" (кожи
// под будущий дубильный набор). На старте было 17 кож бизона и 2 кабана. Считаем их по
// инвентарю (не каждый бой даёт кожу) и не ходим на бизона, пока его кож больше кабаньих.
async function readHideCounts(page) {
  await page.goto('http://lbast.ru/inv.php', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  const text = await getBodyText(page).catch(() => '');
  const num = (re) => { const m = text.match(re); return m ? Number(m[1]) : 0; };
  if (!/У вас\s+\d+\s+дин/i.test(text)) return null; // инвентарь не открылся - счёт неизвестен
  return {
    boar: num(/Кожа дикого кабана\s+(\d+)/i),
    bison: num(/Кожа дикого бизона\s+(\d+)/i),
  };
}

async function runFarmSession(page) {
  let hides = await readHideCounts(page);
  if (hides) console.log(`Фарм-сессия: кожи бизон ${hides.bison}, кабан ${hides.boar}.`);
  const deadline = Date.now() + FARM_SESSION_MIN * 60_000;
  let fights = 0;
  let lastMailAt = Date.now();
  console.log(`Фарм-сессия: ${FARM_SESSION_MIN} мин (до ${new Date(deadline).toLocaleTimeString('ru-RU')}).`);
  while (Date.now() < deadline && !isSleepTime()) {
    let st = await readLocationStats(page);
    if (typeof st.hpCurrent !== 'number') {
      // висящий бой или залипшая сцена - разбираем здесь же, не выходя из сессии
      if (await resolvePendingFightIfAny(page).catch(() => false)) continue;
      await escapeStuckSceneIfAny(page).catch(() => false);
      st = await readLocationStats(page);
      if (typeof st.hpCurrent !== 'number') {
        console.log('Фарм-сессия: HP не читается -> пауза минута.');
        await new Promise((r) => setTimeout(r, 60_000));
        continue;
      }
    }
    if (st.hpCurrent <= 0) {
      await waitForHeal(page);
      continue;
    }
    if (st.hpCurrent < st.hpMax * 0.7) {
      // лечимся в Кулаке Хаоса до 95%, замер раз в 2 минуты
      const here = await getBodyText(page).catch(() => '');
      if (!/Кулак Хаоса/i.test(here)) {
        await page.goto('http://lbast.ru/location.php?mod=fastway&lway=4', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
      }
      console.log(`Фарм-сессия: HP ${st.hpCurrent}/${st.hpMax} -> лечусь в Кулаке Хаоса до ${Math.round(FARM_HEAL_TARGET * 100)}%.`);
      // Жарить сразу по приходу, не дожидаясь первого замера через 2 минуты (Паша, 19.09.2026).
      const firstSt = await readLocationStats(page);
      await withHangGuard(page, 'кухня', 5 * 60_000, () => fryFishWhileHealing(page, firstSt).catch(() => {}));
      let lastHealLog = Date.now();
      for (;;) {
        await new Promise((r) => setTimeout(r, 120_000));
        const h = await readLocationStats(page);
        if (typeof h.hpCurrent !== 'number') break;
        if (h.hpCurrent >= h.hpMax * FARM_HEAL_TARGET || Date.now() >= deadline || isSleepTime()) break;
        // признак жизни для сторожа лога (строки чата он не считает)
        if (Date.now() - lastHealLog >= 10 * 60_000) { lastHealLog = Date.now(); console.log(`Лечение: HP ${h.hpCurrent}/${h.hpMax}.`); }
        // Пока лечимся - жарим рыбу на кухне в доме, если резерв полный (Паша, 19.09.2026).
        await withHangGuard(page, 'кухня', 5 * 60_000, () => fryFishWhileHealing(page, h).catch(() => {}));
      }
      continue;
    }
    if (Date.now() - lastMailAt > 15 * 60_000) {
      lastMailAt = Date.now();
      await handleUnreadMailIfAny(page).catch(() => {});
      const h = await readHideCounts(page);
      if (h) {
        hides = h;
        console.log(`Фарм-сессия: кожи бизон ${hides.bison}, кабан ${hides.boar}.`);
      }
    }
    // Рыбалка между боями: попытка раз в 2 минуты, до 6 карасей в день.
    await runFishingIfDue(page).catch((e) => console.log('Фарм-сессия: рыбалка:', e.message));
    const buffed = await isAnyBuffAleActive(page).catch(() => false);
    // Кабан первым; бизон - только пока его кож не больше кабаньих (счёт неизвестен - бьём обоих).
    const k = await runBoarFarmRound(page, buffed).catch((e) => { console.log('Фарм-сессия: кабан:', e.message); return false; });
    if (k) fights += 1;
    let b = false;
    if (!hides || hides.bison <= hides.boar) {
      b = await runBisonFarmRound(page, buffed).catch((e) => { console.log('Фарм-сессия: бизон:', e.message); return false; });
      if (b) fights += 1;
    }
    if (!b && !k) {
      // обе цели на кулдауне или маршрут не прошёл - не долбим сервер, ждём минуту
      await new Promise((r) => setTimeout(r, 60_000));
    }
  }
  console.log(`Фарм-сессия окончена: ${fights} боёв.`);
  return fights > 0;
}

// Режим «без боёв» (письмо Паши 20.09.2026: «Прекрати пока форму не вывозишь ботов, только рыбалка,
// в общем всё что без боя»). Включается файлом-флагом ai_char/no_fight.flag или AI_NO_FIGHT=1 -
// файл проверяется каждый цикл, поэтому режим снимается и включается без перезапуска драйвера.
// Мирное продолжает работать: рыбалка, травы, довольствие, дерево жизни, статуя, кухня, письма, чат.
const { isNoFightMode } = require('./lib/state');
const FIGHT_STEPS = new Set([
  'Шепот quest step', 'assassin quest step', 'Ордо экзекуторс', 'Квесты по гайду',
  'demon lake quest step', 'shipwreck quest step', 'Fish Restaurant quest step', 'Fish Eye step',
  'Дейлики по дню недели', 'Дейлики недели (как у Цунами)', 'Harpy hunt (вторник)',
  'Boar farm round',
  // 'Bison farm round' здесь НЕТ намеренно: Паша 20.09.2026 - «бизона можешь попробовать побить,
  // он слабый». Это единственный бой, разрешённый в режиме без боёв.
]);
let noFightLogged = false;

async function runCycleStep(page, label, fn) {
  if (FIGHT_STEPS.has(label) && isNoFightMode()) {
    if (!noFightLogged) {
      noFightLogged = true;
      console.log('Режим без боёв (приказ Паши письмом): бои и фарм пропускаю, делаю только мирное.');
    }
    return { didAnything: false, ko: false };
  }
  const didAnything = await fn().catch((e) => {
    console.log(`${label} error:`, e.message);
    return false;
  });
  // 17.09.2026, живой инцидент: HP проверялось ТОЛЬКО когда шаг вернул true. Гаунтлет
  // асассинов увёл HP в минус и вернул false -> проверка не выполнилась, и драйвер ещё
  // несколько минут водил мёртвого персонажа по локациям, пока игра отвечала
  // "Восстановите здоровье". Урон возможен и в шаге, который "ничего не сделал"
  // (входящая атака, проигранный бой внутри гаунтлета), поэтому HP читаем ВСЕГДА.
  // Явно возвращаемся на location.php: шаг мог оставить страницу на доске квестов, где
  // шапка со статами не рендерится и parseStats молча вернул бы null (та же ловушка уже
  // описана ниже, в проверке после runDailyQuests).
  await page.goto('http://lbast.ru/location.php', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  let afterStats = parseStats(await getBodyText(page));
  // 17.09.2026, живой случай: null/null ПОСЛЕ явного перехода на location.php означает, что
  // сама локация отдаёт не локацию, а залипшую сцену - шаг увёл персонажа внутрь и не вывел.
  // Дальше весь остаток цикла работает вслепую: "не найдено open quests menu", меню дейликов
  // не читается, ферма пропускается, и так до конца цикла. Так отравил цикл шаг
  // "кораблекрушение". escapeStuckSceneIfAny вызывался ТОЛЬКО в начале цикла, то есть
  // проверял ровно то место, где проблемы ещё нет. Пробуем выбраться там, где симптом виден.
  if (typeof afterStats.hpCurrent !== 'number') {
    // Сначала висящий бой: escapeStuckSceneIfAny боевые экраны обходит намеренно.
    const fought = await resolvePendingFightIfAny(page).catch((e) => {
      console.log(`${label}: разбор висящего боя упал: ${e.message}`);
      return false;
    });
    if (fought) {
      await page.goto('http://lbast.ru/location.php', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
      afterStats = parseStats(await getBodyText(page));
      console.log(`${label}: висящий бой разобран -> HP ${afterStats.hpCurrent}/${afterStats.hpMax}`);
    }
  }
  if (typeof afterStats.hpCurrent !== 'number') {
    const escaped = await escapeStuckSceneIfAny(page).catch(() => false);
    if (escaped) {
      await page.goto('http://lbast.ru/location.php', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
      afterStats = parseStats(await getBodyText(page));
      console.log(`${label}: выбрался из залипшей сцены -> HP ${afterStats.hpCurrent}/${afterStats.hpMax}`);
    }
  }
  console.log(`HP after ${label}:`, afterStats.hpCurrent, '/', afterStats.hpMax);
  if (typeof afterStats.hpCurrent === 'number' && afterStats.hpCurrent <= 0) {
    await waitForHeal(page);
    return { didAnything: Boolean(didAnything), ko: true };
  }
  return { didAnything: Boolean(didAnything), ko: false };
}

async function waitForHeal(page) {
  for (;;) {
    await page.goto('http://lbast.ru/location.php', { waitUntil: 'domcontentloaded', timeout: 60000 });
    const text = await getBodyText(page);
    const stats = parseStats(text);
    if (typeof stats.hpCurrent !== 'number' || typeof stats.hpMax !== 'number') {
      console.log('Не смог прочитать HP для расчёта восстановления, жду 1 минуту и пробую снова.');
      await new Promise((r) => setTimeout(r, 60_000));
      continue;
    }
    if (stats.hpCurrent > 0) {
      console.log(`HP восстановилось: ${stats.hpCurrent}/${stats.hpMax} -> продолжаю.`);
      return stats;
    }
    const needed = stats.hpMax - stats.hpCurrent;
    const waitMinutes = Math.ceil(needed / HEAL_RATE_HP_PER_MIN) + 1;
    const eta = new Date(Date.now() + waitMinutes * 60_000);
    console.log(
      `HP=${stats.hpCurrent}/${stats.hpMax} -> персонаж выбыл из строя. Жду восстановления ~${waitMinutes} мин (до ${eta.toLocaleTimeString('ru-RU')}), браузер остаётся открытым.`
    );
    // Пока восстанавливаемся - домой в Кулак и жарить рыбу, если хватает резерва (Паша, 19.09.2026:
    // «рыбу пожарь пока восстанавливаешься»). Попытка раз в 5 минут; кухня под пределом времени.
    const until = Date.now() + waitMinutes * 60_000;
    let first = true;
    while (Date.now() < until) {
      const cur = await readLocationStats(page);
      if (first && !/Кулак Хаоса/i.test(await getBodyText(page).catch(() => ''))) {
        await page.goto('http://lbast.ru/location.php?mod=fastway&lway=4', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
        await new Promise((r) => setTimeout(r, 8000));
      }
      first = false;
      await withHangGuard(page, 'кухня', 5 * 60_000, () => fryFishWhileHealing(page, cur).catch(() => {}));
      await new Promise((r) => setTimeout(r, Math.min(5 * 60_000, Math.max(0, until - Date.now()))));
    }
  }
}

async function loginIfNeeded(page) {
  // 18.09.2026: один прерванный переход (net::ERR_ABORTED - те же прерывистые сбои, что и в
  // циклах) ронял драйвер ещё на старте. Три попытки с паузой, потом уже честная ошибка.
  for (let attempt = 1; ; attempt += 1) {
    try {
      await page.goto('http://lbast.ru/', { waitUntil: 'domcontentloaded', timeout: 60000 });
      break;
    } catch (e) {
      if (attempt >= 3) throw e;
      console.log(`Старт: переход на lbast.ru не удался (${e.message.split('\n')[0]}), попытка ${attempt}/3 - повторю через 10 с.`);
      await new Promise((r) => setTimeout(r, 10_000));
    }
  }
  const loginInput = page.locator('input[name="login"]');
  if ((await loginInput.count().catch(() => 0)) > 0) {
    if (!LOGIN || !PASS) {
      console.error(
        'Нет сохранённой сессии и не заданы AI_LOGIN/AI_PASS (переменные окружения или .env в корне репо) — учётные данные не хранятся в коде.'
      );
      process.exit(1);
    }
    await loginInput.fill(LOGIN);
    await page.locator('input[name="pass"]').fill(PASS);
    await Promise.all([
      page.waitForLoadState('domcontentloaded'),
      page.locator('input[type=submit]').first().click(),
    ]);
    const igruLink = page.locator('a', { hasText: 'В игру' });
    if ((await igruLink.count().catch(() => 0)) > 0) {
      await Promise.all([
        page.waitForLoadState('domcontentloaded'),
        igruLink.first().click(),
      ]);
    }
    console.log('Logged in as', LOGIN, '-> URL:', page.url());
  }
}

(async () => {
  const userDataDir = path.join(__dirname, 'chrome-profile-ai-char');
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false, // локально можно смотреть на экран; для сервера/без монитора поставь true
    viewport: null,
  });
  const page = context.pages()[0] || (await context.newPage());

  // 18.09.2026, Паша: "у тебя автобан часто выходит, сделай задержку между кликами".
  // Паузы были разбросаны по шагам вручную, а многие переходы (page.goto, замеры HP во
  // второй вкладке, вкладка чата) шли вообще без них. Поэтому ограничитель стоит на уровне
  // браузера: КАЖДАЯ загрузка страницы lbast.ru - клик, переход, любая вкладка - встаёт в
  // общую очередь и уходит не раньше чем через MIN_GAP (+ случайные 0-0.5 с) после предыдущей: 0.5-1 с, Паша: "много, сделай 0.5-1 секунду".
  // Картинки/стили не трогаем - это не действия игрока.
  const MIN_GAP_MS = Number(process.env.AI_MIN_REQUEST_GAP_MS || 500);
  let nextDocSlot = 0;
  await context.route(/lbast\.ru/, async (route) => {
    if (route.request().resourceType() !== 'document') return route.continue().catch(() => {});
    const now = Date.now();
    const at = Math.max(now, nextDocSlot);
    nextDocSlot = at + MIN_GAP_MS + Math.floor(Math.random() * 500);
    if (at > now) await new Promise((r) => setTimeout(r, at - now));
    return route.continue().catch(() => {});
  });

  await loginIfNeeded(page);

  // 16.09.2026, Паша: "можешь в одном окне фармить а в другом держать чат открытым... нужна
  // будет активность на нескольких [комнатах]". Playwright's launchPersistentContext даёт
  // несколько вкладок в одном контексте (общая сессия/куки) - вторая вкладка крутит чат
  // независимо от основного фарм-цикла на `page`, не блокируя и не блокируясь им.
  // Сама эта вкладка только ЗАМЕЧАЕТ изменения (см. runChatMonitorCycle в module.js) и
  // печатает их в лог - реальный ответ в духе персонажа AI__ (нужно прочитать текст, узнать
  // расу/фракцию через getPlayerRaceAndFaction и придумать реплику) остаётся отдельным шагом,
  // который сейчас требует Пашу/Клода в цикле - не пытаемся угадывать шутки автоматически.
  const chatPage = await context.newPage();
  const chatRoomState = {};
  // 16.09.2026, Паша: сначала "уменьши скорость" (было 45с на все 9 комнат без пауз - слишком
  // по-бот-ски), затем "обновляй чаще, если в комнате пошло общение можешь ее обновлять раз в
  // 30 сек" - теперь runChatMonitorCycle сама решает по каждой комнате отдельно (активная -
  // раз в 30с, тихая - раз в 3 мин, см. CHAT_ACTIVE_POLL_MS/CHAT_IDLE_POLL_MS в module.js).
  // Внешний тик просто должен быть достаточно частым, чтобы не проспать 30-секундное окно.
  const CHAT_TICK_MS = 15_000;
  (async function runChatWatchLoop() {
    for (;;) {
      // Во сне чат не читаем и не отвечаем (Паша, 19.09.2026: сон с 23:00 до 05:00).
      if (isSleepTime()) { await new Promise((r) => setTimeout(r, 60_000)); continue; }
      try {
        const changed = await runChatMonitorCycle(chatPage, chatRoomState);
        for (const { name, room, text, triggers } of changed) {
          // Долгая память автоответчика: весь видимый чат комнаты (повторы отсекаются внутри).
          try { chatMemory.ingestRoom(room, text); } catch (e) { console.log('Память чата: ошибка', e.message); }
          console.log(`\n===== CHAT UPDATE: "${name}" (room=${room}) =====`);
          console.log(text.slice(0, 1500));
          console.log('===== END CHAT UPDATE =====\n');

          // Обычный CHAT UPDATE печатается на любое шевеление в комнате, и обращение к нам в
          // нём тонет. Триггеры - отдельный заметный блок: именно по нему видно, что пора
          // писать ответ. Машиночитаемая копия каждого триггера уже ушла в лог строкой
          // CHAT_TRIGGER:<base64> (см. emitChatTrigger в module.js).
          if (Array.isArray(triggers) && triggers.length > 0) {
            for (const t of triggers) {
              console.log(`>>> ПОРА ОТВЕТИТЬ [${t.type}] "${name}": ${t.reason}`);
              if (t.text) console.log(`    ${t.nick}: ${t.text}`);
              if (Array.isArray(t.lines)) for (const l of t.lines) console.log(`    ${l}`);
              handleChatTrigger(t, text);
            }
            console.log('');
          }
        }
      } catch (e) {
        console.log('Chat watch loop error:', e.message);
      }
      await new Promise((r) => setTimeout(r, CHAT_TICK_MS));
    }
  })();

  // Дневные квесты (трактир, Дерево жизни, Грабим корованы) выполняются раз в день —
  // как только все они сделаны, каждый цикл будет возвращать didAnything:false.
  // Долбить сайт заново каждую секунду в этом случае бессмысленно и просто дёргает
  // страницу на экране — ждём подольше, пока не появится что-то новое (кулдаун сбросится).
  let idleStreak = 0;

  for (let i = 1; i <= MAX_CYCLES; i++) {
    if (isSleepTime()) {
      await sleepUntilMorning(page).catch((e) => console.log('Сон: ошибка', e.message));
      continue;
    }
    console.log(`\n===== CYCLE ${i}/${MAX_CYCLES} =====`);
    let didAnything = false;
    try {
      await page.goto('http://lbast.ru/location.php', { waitUntil: 'domcontentloaded', timeout: 60000 });
      await handleUnreadMailIfAny(page);

      // Входящая атака/засада (например, "Бандит") раньше не обрабатывалась вообще -
      // driver.js вызывает runDailyQuests напрямую, а не doScenario, где эта проверка
      // жила у Tsunami. Без неё location.php молча зависал на голом "В бой!" на много
      // циклов подряд (parseStats/openQuestsMenu давали null/[] без единой ошибки) - живой
      // случай 15.09.2026 с "Бандит" обнаружен только ручной проверкой браузера.
      // Персонаж мог остаться внутри квестовой сцены (живой случай: Чулан дома могильщика).
      // Тогда location.php отдаёт экран сцены без шапки и без Q, и весь цикл ниже сыплется
      // в null/null. Выходим из сцены ДО всех проверок.
      await resolvePendingFightIfAny(page).catch((e) => {
        console.log('Pending fight resolve error:', e.message);
      });
      await page.goto('http://lbast.ru/location.php', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
      await escapeStuckSceneIfAny(page).catch((e) => {
        console.log('Escape stuck scene error:', e.message);
      });

      const preAttackText = await getBodyText(page);
      const attackHandled = await handleIncomingAttackIfAny(page, preAttackText).catch((e) => {
        console.log('Incoming attack handling error:', e.message);
        return false;
      });
      // Даже когда вернулось false (например, "Бандит" - не игрок, см. LATIN_NICK_RE),
      // функция могла провести бой и оставить page в произвольном состоянии - всегда
      // возвращаемся на известную страницу перед чтением статов.
      if (/В\s*бой/i.test(preAttackText) || attackHandled) {
        await page.goto('http://lbast.ru/location.php', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
      }

      const text = await getBodyText(page);
      const stats = parseStats(text);
      console.log('stats:', stats);

      if (typeof stats.hpCurrent === 'number' && stats.hpCurrent <= 0) {
        await waitForHeal(page);
        continue;
      }

      // 20.09.2026, Паша: «смотри сколько квестов, почему не делаются?» - почти каждый квест с боем
      // требует 70% HP, а бои самих квестов держат HP ниже. Лечение было только в пустом цикле, а
      // цикл не пустой (травы, довольствие, рыбалка), поэтому HP не догонялось никогда. Теперь:
      // есть незакрытые квесты с боями и HP ниже порога - лечимся сразу, дома в Кулаке, с жаркой.
      if (typeof stats.hpCurrent === 'number' && stats.hpMax > 0
        && stats.hpCurrent < stats.hpMax * OPTIONAL_FIGHT_MIN_HP_FRACTION
        && (hasPendingFightQuests() || isNoFightMode()) && !isSleepTime()) {
        const target = Math.ceil(stats.hpMax * QUEST_HEAL_TARGET);
        console.log(`Лечение под квесты: HP ${stats.hpCurrent}/${stats.hpMax} -> до ${target} (есть квесты с боями).`);
        if (!/Кулак Хаоса/i.test(text)) {
          await page.goto('http://lbast.ru/location.php?mod=fastway&lway=4', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
          await new Promise((r) => setTimeout(r, 8000));
        }
        for (let n = 0; n < 12; n++) {
          const h = await readLocationStats(page);
          if (typeof h.hpCurrent !== 'number' || h.hpCurrent >= target || isSleepTime()) break;
          await withHangGuard(page, 'кухня', 5 * 60_000, () => fryFishWhileHealing(page, h).catch(() => {}));
          console.log(`Лечение под квесты: HP ${h.hpCurrent}/${h.hpMax}.`);
          await new Promise((r) => setTimeout(r, 120_000));
        }
        continue;
      }

      // 15.09.2026, Паша: "не забывай сам одевать" - консьюмерские слоты (Пояс/Подсумок)
      // пустеют после респека статов и раньше их приходилось переэкипировать вручную.
      // Дешёвая самопроверка раз в цикл (просто чтение inv.php?mod=outfit, без боя) -
      // если слот пуст и в инвентаре есть подходящий предмет, экипирует сам.
      await ensureHealingGearEquipped(page).catch((e) => {
        console.log('ensureHealingGearEquipped error:', e.message);
        return false;
      });

      // 16.09.2026, Паша: "есть усилители временные... праздничный эль и эль вырви глаз,
      // можешь использовать их через инвентарь - усиляют на разное время, но будет проще
      // бить ботов". Дешёвая проверка раз в цикл (сама пропускает уже активный бафф,
      // см. tryDrinkBuffAle) - переиспользует ту же логику, что уже была для Штолен.
      await ensureBuffAlesActive(page).catch((e) => {
        console.log('ensureBuffAlesActive error:', e.message);
        return false;
      });
      await page.goto('http://lbast.ru/location.php', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});

      // 16.09.2026, Паша: "у Цунами есть как использовать статую... раз в 12 часов" - логика
      // (runStatueOfGloryIfDue) уже была в module.js, но жила только внутри doScenario(),
      // которую driver.js для AI__ не вызывает - статуя ни разу не срабатывала. Требует
      // членства в клане (появилось только сегодня, "Боги войны") - сама функция сама решает,
      // подошёл ли интервал 12-14 часов, и сама планирует следующий запуск.
      let r = await runCycleStep(page, 'Статуя славы', () => runStatueOfGloryIfDue(page));
      didAnything = didAnything || r.didAnything;
      if (r.ko) continue;

      // 17.09.2026: "Шепот" - раз в месяц, гейтится по shepotDoneThisMonth внутри самой
      // функции. Один логический шаг за вызов (см. комментарий над progressShepotQuestStage в
      // module.js) - не блокирует остальной цикл на весь квест разом, и даёт HP-гейтам шанс
      // сработать МЕЖДУ шагами, а не только один раз перед первым боем (см. инцидент
      // 17.09.2026 в feedback_shtolni_debugging_mistakes.md).
      r = await runCycleStep(page, 'Шепот quest step', () => runShepotQuestIfAvailable(page));
      didAnything = didAnything || r.didAnything;
      if (r.ko) continue;

      // 17.09.2026, Паша: "Довольствие" - короткий ежедневный квест без боя (Амулет ->
      // Дорожный крест -> Казначейство Тригмагистрата -> Получить довольствие -> В игру).
      r = await runCycleStep(page, 'Довольствие quest step', () => runDovolstvieIfAvailable(page));
      didAnything = didAnything || r.didAnything;
      if (r.ko) continue;

      // Приоритет шагов цикла (по духу doScenario у Tsunami): формальные "взятые" квесты
      // гильдии асассинов первыми (не завязаны на счётчик Q, свой дневной лимит) -> разовые
      // квесты (галерея) -> обычные дневные квесты вне Q-меню (Демон озера, Кораблекрушение,
      // Рыбный ресторан) -> необязательные бои с HP-гейтом (Рыбий глаз) -> фарм-филлер
      // (Подвалы) -> Q-меню (Штольни и т.п.) ниже. Каждый шаг - один вызов runCycleStep,
      // который сам ловит ошибку, логирует HP и уходит в waitForHeal при падении в 0.
      r = await runCycleStep(page, 'assassin quest step', () => runAssassinGuildQuestsIfAvailable(page));
      didAnything = didAnything || r.didAnything;
      if (r.ko) continue;

      // Ордо Экзекуторс: мораль в плюс, предметы копим до 6 уровня (Паша, 18.09.2026).
      r = await runCycleStep(page, 'Ордо экзекуторс', () => runOrdoQuestsIfAvailable(page));
      didAnything = didAnything || r.didAnything;
      if (r.ko) continue;

      // Повторяемые квесты по записанному маршруту гайда (Смерть ростовщика, раз в 15 дней).
      // Паша, 18.09.2026: «это не одноразовый квест, потом заскриптуй прохождение».
      r = await runCycleStep(page, 'Квесты по гайду', () => runGuideQuestsIfDue(page));
      didAnything = didAnything || r.didAnything;
      if (r.ko) continue;

      r = await runCycleStep(page, 'gallery quest step', () => runGalleryQuestIfAvailable(page));
      didAnything = didAnything || r.didAnything;
      if (r.ko) continue;

      r = await runCycleStep(page, 'demon lake quest step', () => runDemonLakeQuestIfAvailable(page));
      didAnything = didAnything || r.didAnything;
      if (r.ko) continue;

      r = await runCycleStep(page, 'shipwreck quest step', () => runShipwreckQuestIfAvailable(page));
      didAnything = didAnything || r.didAnything;
      if (r.ko) continue;

      // "Рыбный ресторан" и "Рыбий глаз" включают реальные бои - не лезем ниже 50% HP
      // (см. OPTIONAL_FIGHT_MIN_HP_FRACTION), в остальном тот же runCycleStep.
      r = await runCycleStep(page, 'Fish Restaurant quest step', () => {
        if (!hasEnoughHpForOptionalFight(stats)) {
          console.log(`Fish Restaurant: HP ${stats.hpCurrent}/${stats.hpMax} < ${OPTIONAL_FIGHT_MIN_HP_FRACTION * 100}%, пропускаю (в квесте есть бои).`);
          return Promise.resolve(false);
        }
        return runFishRestaurantQuestIfAvailable(page);
      });
      didAnything = didAnything || r.didAnything;
      if (r.ko) continue;

      r = await runCycleStep(page, 'Fish Eye step', () => {
        if (!hasEnoughHpForOptionalFight(stats)) {
          console.log(`Fish Eye: HP ${stats.hpCurrent}/${stats.hpMax} < ${OPTIONAL_FIGHT_MIN_HP_FRACTION * 100}%, пропускаем необязательный бой.`);
          return Promise.resolve(false);
        }
        return runFishEyeIfDue(page);
      });
      didAnything = didAnything || r.didAnything;
      if (r.ko) continue;

      // "Травы" (Арайя/Шипы дикого кактуса/и т.п.) - по просьбе Паши 15.09.2026, без боя,
      // подтверждено вживую (HP не меняется ни на промахе, ни на шипе) - без HP-гейта.
      r = await runCycleStep(page, 'Herb gathering step', () => runHerbQuestsIfAvailable(page));
      didAnything = didAnything || r.didAnything;
      if (r.ko) continue;

      // "Дейлик" гарпии (16.09.2026, порт с Цунами commit fb9dea7) - день-привязанный бонус
      // (только вторник x3, см. module.js HARPY_HUNT_WEEKDAY), сам решает, сегодня ли его
      // день, и просто возвращает false иначе. Бизон/кабан НИЖЕ - уже обычный repeat-farm
      // без дневного гейта (Паша 16.09.2026: "теперь это обычный фарм").
      // AI_DISABLE_PODVALY=1 переиспользован как общий выключатель (не тратить HP на фарм).
      // 16.09.2026, Паша: "с активным элем можно опустить порог хп до 0.4" - один общий
      // pers.php-чек на весь цикл (не по разу на каждую фарм-функцию), передаётся во все
      // три ниже как параметр buffed.
      // Дейлики по дню недели (сейчас четверг: могильщик/мясник/дом в тупике) - идут ДО
      // фарма: это квесты, а они в приоритете.
      // Рыбалка: караси под будущую кухню в доме (Паша, 18.09.2026). Лимит/кулдаун внутри.
      r = await runCycleStep(page, 'Рыбалка', () => runFishingIfDue(page));
      didAnything = didAnything || r.didAnything;
      if (r.ko) continue;

      r = await runCycleStep(page, 'Дейлики по дню недели', () => runThursdayDailiesIfAvailable(page));
      didAnything = didAnything || r.didAnything;
      if (r.ko) continue;

      // Среда/пятница «как у Цунами» (дух гор, гиены, варан); кабан/бизон/гарпия - в фарме ниже.
      r = await runCycleStep(page, 'Дейлики недели (как у Цунами)', () => runWeekdayHuntsIfDue(page));
      didAnything = didAnything || r.didAnything;
      if (r.ko) continue;

      const buffedForFarm = await isAnyBuffAleActive(page).catch(() => false);

      // Паша, 17.09.2026: "эти квесты не сделаны а ты на бизона пошел... квесты важнее фарма".
      // Живой случай: при активном эле порог фарма падает до HP_FLOOR_WITH_BUFF (0.4), и ферма
      // стачивала HP с 215 до 108 (28%) - после чего НИ ОДИН квест с боем уже не проходил по
      // своему порогу 0.7, и драйвер просто стоял. Теперь ферма имеет право тратить только
      // ИЗЛИШЕК сверх квестового порога: ниже 70% не фармим, даже с элем.
      // Привязывать фарм к "есть ли невыполненные квесты" нельзя: в Q-меню всегда висят
      // Штольни (выключены) и другие незакодированные квесты - фарм отключился бы навсегда.
      // Два условия, и оба обязательны.
      // 1) HP выше квестового порога - иначе ферма добивает то, что нужно квестам.
      // 2) Нет невыполненных квестов с боями. Одного порога мало: живой замер 17.09.2026
      //    показал, что ОДИН бой с бизоном снимает 186 HP (49% от максимума 380). Стартуя
      //    даже с 70%, после фарма мы оказываемся на ~29%, и дейлики с боями срываются -
      //    ровно то, на чём Паша меня и поймал ("эти квесты не сделаны а ты на бизона пошел").
      const hpOkForFarm = hasEnoughHpForOptionalFight(stats);
      const questsPending = hasPendingFightQuests();
      const noFight = isNoFightMode();
      const farmAllowed = hpOkForFarm && !questsPending; // бизон разрешён и в режиме без боёв
      const farmAllowedFull = farmAllowed && !noFight;   // кабан и гарпия - только в обычном режиме
      if (!hpOkForFarm) {
        console.log(`Ферма пропущена: HP ${stats.hpCurrent}/${stats.hpMax} < ${OPTIONAL_FIGHT_MIN_HP_FRACTION * 100}% - это HP нужно квестам.`);
      } else if (questsPending) {
        console.log('Ферма пропущена: есть невыполненные квесты с боями - HP берегу под них.');
      }

      r = await runCycleStep(page, 'Harpy hunt (вторник)', () => {
        if (!farmAllowedFull) return Promise.resolve(false);
        if (process.env.AI_DISABLE_PODVALY === '1') return Promise.resolve(false);
        return runHarpyFarmRound(page, buffedForFarm);
      });
      didAnything = didAnything || r.didAnything;
      if (r.ko) continue;

      r = await runCycleStep(page, 'Bison farm round', () => {
        if (!farmAllowed) return Promise.resolve(false);
        if (process.env.AI_DISABLE_PODVALY === '1') return Promise.resolve(false);
        return runBisonFarmRound(page, buffedForFarm);
      });
      didAnything = didAnything || r.didAnything;
      if (r.ko) continue;

      r = await runCycleStep(page, 'Boar farm round', () => {
        if (!farmAllowedFull) return Promise.resolve(false);
        if (process.env.AI_DISABLE_PODVALY === '1') return Promise.resolve(false);
        return runBoarFarmRound(page, buffedForFarm);
      });
      didAnything = didAnything || r.didAnything;
      if (r.ko) continue;

      // Боевые квесты на сегодня закрыты -> длинная фарм-сессия вместо одного боя за цикл.
      if (!hasPendingFightQuests() && process.env.AI_DISABLE_PODVALY !== '1' && !isNoFightMode()) {
        const farmed = await runFarmSession(page).catch((e) => {
          console.log('Фарм-сессия упала:', e.message);
          return false;
        });
        didAnything = didAnything || farmed;
      }

      if (Number.isFinite(stats.questsAvailable) && stats.questsAvailable > 0) {
        const result = await runDailyQuests(page, stats);
        console.log('runDailyQuests result:', result);
        didAnything = didAnything || !!result?.didAnything;

        // Не верим надписи "Бой завершен!" на глаз — после серии боёв смотрим на HP,
        // которое и так есть в шапке любой страницы. Если оно упало до 0, значит где-то
        // в этой пачке был проигрыш (см. LESSONS_AI_CHAR.md) — останавливаемся, не гоняя вслепую.
        // runDailyQuests (Штольни и т.п.) может оставить page на доске квестов, чей заголовок
        // не рендерит HP/HPMax (та же причина, что чинили в runPodvalyFarmRound) — сначала
        // явно возвращаемся на location.php, иначе parseStats тут молча вернёт null/null и
        // проверка на "упал в ноль после боёв" тихо не сработает ни разу.
        await page.goto('http://lbast.ru/location.php', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
        const afterText = await getBodyText(page);
        const afterStats = parseStats(afterText);
        console.log('HP after quest run:', afterStats.hpCurrent, '/', afterStats.hpMax);
        if (typeof afterStats.hpCurrent === 'number' && afterStats.hpCurrent <= 0) {
          await waitForHeal(page);
        }
      } else {
        console.log('No Q quests available this cycle.');
      }
    } catch (e) {
      console.log('Cycle error:', e.message);
      // 18.09.2026: прерывистые таймауты location.php (1 цикл из 3-6) - автобан или сеть? Без
      // снимка экрана это гадание. Пишем, где стоит вкладка и что на ней видно.
      // Не дольше 5 секунд: на странице с зависшей загрузкой evaluate ждёт бесконечно. 18.09.2026
      // этот самый снимок простоял 30 минут и остановил весь драйвер - диагностика стала поломкой.
      const snap = await Promise.race([
        page.evaluate(() => document.body && document.body.innerText).catch(() => null),
        new Promise((r) => setTimeout(() => r('(снимок не получен за 5 с - загрузка висит)'), 5000)),
      ]);
      console.log(`Cycle error snapshot: url=${page.url()} text=${String(snap || '(нет)').replace(/\s+/g, ' ').slice(0, 300)}`);
    }

    if (didAnything) {
      idleStreak = 0;
      await pause(page, 800, 1500);
    } else {
      idleStreak += 1;
      // 2 мин, 4 мин, 8 мин ... максимум раз в 20 минут (чтобы не пропускать окно,
      // когда HP уже восстановилось до бойеспособного уровня, но следующая проверка
      // ещё далеко). Ограничение по просьбе Паши 14.09.2026: не бездействовать дольше 20 мин.
      let idleMinutes = Math.min(20, 2 ** idleStreak);
      // 18.09.2026, Паша: "почему остановился посреди квеста?" - боевые квесты ждали HP 70%,
      // HP дошло до 80% уже через ~10 минут, а драйвер спал по растущей лестнице 2-4-8 минут.
      // Если простой из-за низкого HP - спим ровно до порога (лечение ~14 hp/мин), не дольше.
      const idleStats = await page
        .goto('http://lbast.ru/location.php', { waitUntil: 'domcontentloaded', timeout: 60000 })
        .then(async () => parseStats(await getBodyText(page)))
        .catch(() => null);
      if (idleStats && typeof idleStats.hpCurrent === 'number' && idleStats.hpMax > 0) {
        const need = Math.ceil(idleStats.hpMax * 0.7);
        if (idleStats.hpCurrent < need) {
          idleMinutes = Math.max(1, Math.min(idleMinutes, Math.ceil((need - idleStats.hpCurrent) / 14)));
          // 18.09.2026, Паша: "купил тебе дом, теперь для быстрого лечения достаточно просто
          // стоять в локации кулак хаоса". Ждём HP не где попало, а там: амулетом в Кулак Хаоса.
          // Скорость лечения там ещё не замерена, поэтому спим не дольше 3 минут и пишем HP
          // в лог - по двум замерам подряд видно, насколько быстрее.
          const here = await getBodyText(page).catch(() => '');
          if (!/Кулак Хаоса/i.test(here)) {
            console.log(`Лечение: HP ${idleStats.hpCurrent}/${idleStats.hpMax} < 70% -> иду в Кулак Хаоса (там дом).`);
            await page.goto('http://lbast.ru/location.php?mod=fastway&lway=4', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
          }
          console.log(`Лечение в Кулаке Хаоса: HP ${idleStats.hpCurrent}/${idleStats.hpMax} в ${new Date().toLocaleTimeString('ru-RU')}`);
          await fryFishWhileHealing(page, idleStats).catch(() => {});
          idleMinutes = Math.min(idleMinutes, 3);
        } else {
          idleMinutes = Math.min(idleMinutes, 2);
        }
      }

      console.log(`Ничего нового делать (${idleStreak} цикл подряд без прогресса) -> следующая проверка через ${idleMinutes} мин.`);
      await new Promise((r) => setTimeout(r, idleMinutes * 60_000));
    }
  }

  const finalText = await getBodyText(page);
  console.log('\n===== FINAL STATE =====');
  console.log(finalText.slice(0, 1500));
  console.log('\n(браузер оставлен открытым — процесс не завершается, чтобы окно не закрылось)');

  // Держим процесс живым, иначе playwright закрывает браузер вместе с node.
  await new Promise(() => {});
})();
