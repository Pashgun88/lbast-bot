// Драйвер для персонажа AI__ — раскачка отдельного низкоуровневого персонажа.
// НЕ связан с manager_bot.js / daily_quests_piraty.js (это отдельный аккаунт lbast.ru,
// отдельный профиль браузера ai_char/chrome-profile-ai-char). Основного персонажа не трогает.
//
// Запуск: node ai_char/driver.js
// Переменная окружения AI_MAX_CYCLES (по умолчанию 6) — сколько циклов сделать за запуск.

const { chromium } = require('playwright');
const path = require('path');

// dotenv лежал в зависимостях, но его никто не подключал: .env в корне репозитория не читался
// вовсе, и AI_LOGIN/AI_PASS появлялись только если их вручную экспортировали в шелле. До сих
// пор это не всплывало потому, что сессия жила в профиле Chrome и логин не требовался ни разу,
// - но при смерти сессии драйвер молча выходил с кодом 1. Подключаем ДО require('./module'):
// module.js читает process.env на этапе загрузки.
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

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
  hasPendingFightQuests,
  escapeStuckSceneIfAny,
  resolvePendingFightIfAny,
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
async function runCycleStep(page, label, fn) {
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
    await new Promise((r) => setTimeout(r, waitMinutes * 60_000));
  }
}

async function loginIfNeeded(page) {
  await page.goto('http://lbast.ru/', { waitUntil: 'domcontentloaded', timeout: 60000 });
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
      try {
        const changed = await runChatMonitorCycle(chatPage, chatRoomState);
        for (const { name, room, text, triggers } of changed) {
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
      r = await runCycleStep(page, 'Дейлики по дню недели', () => runThursdayDailiesIfAvailable(page));
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
      const farmAllowed = hpOkForFarm && !questsPending;
      if (!hpOkForFarm) {
        console.log(`Ферма пропущена: HP ${stats.hpCurrent}/${stats.hpMax} < ${OPTIONAL_FIGHT_MIN_HP_FRACTION * 100}% - это HP нужно квестам.`);
      } else if (questsPending) {
        console.log('Ферма пропущена: есть невыполненные квесты с боями - HP берегу под них.');
      }

      r = await runCycleStep(page, 'Harpy hunt (вторник)', () => {
        if (!farmAllowed) return Promise.resolve(false);
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
        if (!farmAllowed) return Promise.resolve(false);
        if (process.env.AI_DISABLE_PODVALY === '1') return Promise.resolve(false);
        return runBoarFarmRound(page, buffedForFarm);
      });
      didAnything = didAnything || r.didAnything;
      if (r.ko) continue;

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
