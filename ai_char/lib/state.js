// Общее состояние бота: настройки, счётчики дней, persisted state (daily_quests_piraty.state.json).
// ВСЕ изменяемые переменные верхнего уровня живут здесь как поля объекта S (S.lastKnownHp,
// S.tavernDoneToday ...). В CommonJS нет live-binding: `let x` в одном файле, переприсвоенный
// в другом, раздвоился бы. Поэтому только S.x, никаких копий в локальные let верхнего уровня.
// Этот файл грузится первым и ни от кого из lib/ не зависит.
// Выделено из ai_char/module.js (там теперь только сборка экспорта).

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

// Всё изменяемое состояние верхнего уровня. Читать и писать только как S.имя из любого файла.
const S = {};

const DEBUG_SNAPSHOTS_PATH = path.join(__dirname, '..', 'logs', 'debug_snapshots.log');

function setupWindowsConsoleUtf8() {
  if (process.platform !== 'win32') {
    return;
  }

  try {
    execSync('chcp 65001 > nul', {
      stdio: 'ignore',
      windowsHide: true,
      shell: true,
    });
  } catch (e) {
    // Ignore and keep default console settings.
  }

  try {
    process.stdout.setDefaultEncoding('utf8');
    process.stderr.setDefaultEncoding('utf8');
  } catch (e) {
    // Streams may not support changing encoding in some environments.
  }
}

setupWindowsConsoleUtf8();

S.lastHandledMailSignature = '';
const ENABLE_PVP_ALERTS = true;
// Паша, 17.09.2026: "Замени селф ник на свой". Было 'tsunami' - константа досталась файлу от
// кода главного персонажа, и из-за неё детектор входящих атак (ATTACK_LINE_RE ищет
// "использует грамоту ... на <ник>") для AI__ не срабатывал НИ РАЗУ.
const SELF_NICK = 'AI__';
const SELF_NICK_RE = new RegExp(`\\b${SELF_NICK}\\b`, 'i');
const PAUSE_SPEED_FACTOR = 0.5;

S.nextCycleDelayOverrideMs = null;
S.lastCycleStats = null;

// UI stuck detection: if we keep failing to find/click the same step for too long,
// bail out and recover to the city to reset state.
const UI_STUCK_MAX_FAILS = 15;
const UI_STUCK_MAX_MS = 60 * 1000;
S.uiStuckState = { stepName: '', count: 0, firstAt: 0 };

// UGO quest disabled (no longer needed).
// const UGO_MIN_HP = 2000;
// Абсолютный порог 2000 был настроен под HP основного персонажа (Tsunami, тысячи HP).
// У AI__ max HP пока ~300-400 и растёт по мере прокачки — по просьбе Паши (14.09.2026,
// "штольни можешь попробовать, но там довольно сильные боты", позже "порог хп сделай 90%")
// порог задан долей от текущего максимума, а не абсолютным числом.
// 14.09.2026: по прямой просьбе Паши для новой попытки поднято до 100% (обязательно
// полное HP перед стартом/между боями), см. также вставленный HEAL-гейт после первого боя.
const SHTOLNI_MIN_HP_FRACTION = 0.99;
const SHTOLNI_MIN_HP = 250; // fallback только для мест ниже, где нет доступа к hpMax из stats
const SHTOLNI_MIN_RESERVE_MINUTES = Number(process.env.AI_SHTOLNI_MIN_RESERVE || 20);
// Пробный запуск 14.09.2026: первый же бот в штольнях снял 310+40=350 HP за один бой
// (со 100% до отрицательного) — с текущей экипировкой AI__ это не "рискованно", а просто
// поражение. По прямой просьбе Паши ("вижу бот очень сильный... пока не будем их делать")
// квест отключен для AI__ до дальнейших указаний. Маршрут полностью записан в
// LESSONS_AI_CHAR.md ("Штольни — полный маршрут") на случай, если вернёмся к нему позже
// с лучшей экипировкой/уровнем.
// Старое исполнение Штолен. Рабочее - маршрут guides/shtolni.steps (guides/quests.js), там же с
// 21.09.2026 условие «должен быть эль». Это держим выключенным, иначе Штольни пойдут дважды.
const SHTOLNI_ENABLED_FOR_AI = false;
// const UGO_INTERVAL_MS = 65 * 60 * 1000; // "раз в час и 5 минут"
// const UGO_DAILY_LIMIT = 10; // не более 10 раз в день
// let lastUgoRunAt = 0;
// let ugoDayKey = '';
// let ugoRunsToday = 0;

const STATE_PATH = path.join(__dirname, '..', 'daily_quests_piraty.state.json');

function loadStateFromDisk() {
  try {
    const raw = fs.readFileSync(STATE_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (e) {
    return {};
  }
}

function saveStateToDisk(state) {
  try {
    fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2), 'utf8');
  } catch (e) {
    // ignore
  }
}

const persistedState = loadStateFromDisk();
// if (Number.isFinite(persistedState.lastUgoRunAt)) lastUgoRunAt = persistedState.lastUgoRunAt;
// if (typeof persistedState.ugoDayKey === 'string') ugoDayKey = persistedState.ugoDayKey;
// if (Number.isFinite(persistedState.ugoRunsToday)) ugoRunsToday = persistedState.ugoRunsToday;
//
// function persistUgoState() {
//   persistedState.lastUgoRunAt = lastUgoRunAt;
//   persistedState.ugoDayKey = ugoDayKey;
//   persistedState.ugoRunsToday = ugoRunsToday;
//   saveStateToDisk(persistedState);
// }

// Паша, 20.09.2026: «дерево жизни ты только 1 раз делал». Лимит игры - 3 раза в день, а свой
// интервал 4 часа не давал их израсходовать (особенно при простоях). 75 минут: игра сама скажет,
// если рано, а три подхода за день теперь укладываются даже в полдня работы.
const LIFE_TREE_INTERVAL_MS = 75 * 60 * 1000;
const LIFE_TREE_DAILY_LIMIT = 3; // не более 3 раз в день
S.lastLifeTreeRunAt = 0;
S.lifeTreeDayKey = '';
S.lifeTreeRunsToday = 0;

const FISH_EYE_INTERVAL_MS = 25 * 60 * 1000;
const FISH_EYE_DAILY_FIGHT_LIMIT = 10; // 10 раз в день
S.lastFishEyeRunAt = 0;
S.fishEyeDayKey = '';
S.fishEyeFightsToday = 0;
S.fishEyeRewardClaimedToday = false;

// Камни Драбаса: 2 раза в день, кулдаун 4 часа.
const DRABAS_INTERVAL_MS = 4 * 60 * 60 * 1000;
const DRABAS_DAILY_LIMIT = 2;
S.lastDrabasRunAt = 0;
S.drabasDayKey = '';
S.drabasRunsToday = 0;
// 21.09.2026: разведка у укротителя Лариэля (Кулак Хаоса, Рыночная площадь -> Имение укротителя).
// Камни нужны для ментальной связи с ПИТОМЦЕМ, а питомца у AI__ нет - поэтому поиск в ущелье
// отвечает «Пока что вам эти камни ни к чему» и шага «Напасть» на экране не бывает. Питомец
// стоит 2000 дин (решение Паши), до него квест держать бессмысленно: ставим сутки тишины.
S.drabasNoPetUntil = 0;

// Полив винограда: каждые 8 часов.
const VINOGRAD_INTERVAL_MS = 8 * 60 * 60 * 1000;
S.lastVinogradRunAt = 0;
// Продажа жареной рыбы в Лавке боевых ресурсов Стоунгарда (Паша 21.09.2026): раз в 3 дня.
S.lastFishSaleAt = 0;

// Статуя славы: раз в 12-14 часов (случайный интервал в этих пределах).
const STATUE_MIN_INTERVAL_MINUTES = 12 * 60;
const STATUE_MAX_INTERVAL_MINUTES = 14 * 60;
S.lastStatueRunAt = 0;
S.nextStatueDueAt = 0;

// "Шепот" - квест берётся у "Кулак Хаоса", Паша подтвердил 16.09.2026: "запомни как делается
// он периодический" - раз в месяц, не раз в день. Длинный многоэтапный квест (см.
// progressShepotQuest ниже) - stage переживает рестарты процесса, чтобы не проходить заново
// уже пройденные куски после падения/перезапуска. monthKey сбрасывает done/stage раз в
// календарный месяц.
S.shepotMonthKey = '';
S.shepotDoneThisMonth = false;
S.shepotStage = 0;
// Паша, 17.09.2026 (после 3 боёв гаунтлета): "гайд верный, тебе нужно по очереди на предметы
// нажимать" - все 4 кнопки "Использовать <предмет>" видны на экране ОДНОВРЕМЕННО (не гейтятся
// по текущему монстру), поэтому определять нужный предмет по тому, что "есть на экране",
// не работает - код трижды подряд выбирал первый по списку (отвар арайи). Правильный подход:
// жёстко идти по порядку гайда, отслеривая номер боя отдельным счётчиком.
S.shepotGauntletFightsDone = 0;

// Рыбалка: не более 6 успешных уловов в день, кулдаун 2 минуты между попытками —
// пробуем между квестами каждый цикл, пока не наловим лимит. Никогда не запускается из фарма Блейка.
// Также используется во время восстановления в Последнем доме (см. runLastHouseRecovery).
const FISHING_DAILY_CATCH_LIMIT = 6;
const FISHING_ATTEMPT_COOLDOWN_MS = 2 * 60 * 1000;
S.fishingDayKey = '';
S.fishingCatchesToday = 0;
S.lastFishingAttemptAt = 0;

// Порог HP, при котором можно продолжать обычные действия (квесты) или биться с Блейком —
// используется и как условие выхода из критического восстановления в Последнем доме.
const BLAKE_MIN_HP = 1800;

// Цель фарма после квестов: 'blake' (по умолчанию) или 'goblins'. Задаётся менеджером через
// переменную окружения FARM_TARGET при запуске сценария (кнопки "Квесты + Блейки" / "Квесты + Гоблины").
const FARM_TARGET = String(process.env.FARM_TARGET || 'blake').toLowerCase() === 'goblins' ? 'goblins' : 'blake';
const FARM_LABEL = FARM_TARGET === 'goblins' ? 'гоблинов' : 'Блейка';
console.log(`Farm target: ${FARM_TARGET}`);


// Квесты без явно указанного кулдауна: 1 раз в день (в памяти процесса).
S.tavernDayKey = '';
S.tavernDoneToday = false;
S.tavernTakenToday = false;
S.tavernFailStreak = 0;
S.tavernSuppressedUntil = 0;
S.tavernFocusStartedAt = 0;
S.shtolniDayKey = '';
S.shtolniDoneToday = false;
S.shtolniTakenToday = false;
S.shtolniFailStreak = 0;
S.shtolniSuppressedUntil = 0;
S.shtolniNoProgressStreak = 0;
S.shtolniLastStage = '';
S.shtolniFocusStartedAt = 0;
S.rumaForgeDayKey = '';
S.rumaForgeDoneToday = false;

// "Довольствие" - короткий ежедневный квест без боя, продиктован Пашей 17.09.2026:
// Амулет -> Дорожный крест -> Казначейство Тригмагистрата -> Получить довольствие -> В игру.
S.dovolstvieDayKey = getDayKeyNow();
S.dovolstvieDoneToday = true; // Паша, 17.09.2026: "сегодня уже сделано"
S.fisherFoodDayKey = '';
S.fisherFoodDoneToday = false;
S.caravanRobberyDayKey = '';
S.caravanRobberyDoneToday = false;

// Гильдия асассинов: 3 независимых задания (банкир/картина/торговец), каждое можно
// выполнять и копить предметы задания раз в день, до достижения 6 уровня для сдачи
// (см. LESSONS_AI_CHAR.md, "Гильдия асассинов"). Отдельный dayKey/doneToday на каждое,
// плюс лимит попыток в день на торговца (он может просто отсутствовать на клетке сейчас).
S.assassinGuildDayKey = '';
const assassinGuildDoneToday = { banker: false, painting: false, merchant: false };
S.assassinMerchantAttemptsToday = 0;
// Когда в последний раз ехали к каравану и не застали его (см. hasPendingFightQuests).
S.assassinMerchantNoCaravanAt = 0;
const ASSASSIN_MERCHANT_MAX_ATTEMPTS_PER_DAY = 6;

// Галерея искусств/лазулиты: одноразовый (не дневной) квест — раз сдан, никогда не
// появится в Q снова. Флаг без day-key, чтобы после первой сдачи диспетчер не ходил
// каждый цикл в Рыбацкую деревню проверять Марсиуса заново.
S.galleryQuestDone = false;

// "Орден Тригмагистров: Охота на демона" (Демон озера) — маршрут записан со слов Паши
// 14.09.2026 (продиктован по памяти, не проверен вживую). Обычный дневной квест.
S.demonLakeDayKey = '';
S.demonLakeDoneToday = false;

// "Кораблекрушение" — маршрут продиктован Пашей 14.09.2026. Обычный дневной квест.
S.shipwreckDayKey = '';
S.shipwreckDoneToday = false;

// "Рыбный ресторан Тёща Кумуса" — журнал наград открывается один раз (не по дням), затем
// каждый день можно пройти ОДНУ ветку из 27 пронумерованных наград. Паша попросил идти по
// порядку номеров (15.09.2026). Маршруты — из гайда Dikaya (zhg_web.php?st_id=224300),
// см. LESSONS_AI_CHAR.md. НЕ проверено вживую (как Демон озера/Кораблекрушение до первого
// реального прогона) - код написан по тексту гайда, каждый шаг матчится через performStep
// с ретраями, чтобы не падать намертво на неточности формулировки кнопки.
S.fishRestaurantJournalOpened = false;
S.fishRestaurantDayKey = '';
S.fishRestaurantDoneToday = false;
S.fishRestaurantNextRewardNumber = 1;
// Паша, 17.09.2026: "рыбный ресторан ты начинал делать и убежал на другой квест". Маршрут
// награды длинный (вереница шагов + 3 боя), и любой упавший шаг раньше просто возвращал
// управление в цикл, который шёл к следующему квесту. Делаем квест эксклюзивным на время
// прохода - как Харчевня/Штольни. НЕ персистим: после рестарта процесса фокус снимается сам,
// иначе упавший маршрут мог бы заблокировать драйвер навсегда.
S.fishRestaurantFocusStartedAt = 0;
S.fishRestaurantSuppressedUntil = 0;

// Дейлики по дню недели (гайд Паши от 17.09.2026). Date.getDay(): 4 = четверг.
const THURSDAY_WEEKDAY = 4;
S.thursdayDailiesDayKey = '';
S.thursdayDailiesDone = {
  gravedigger: false, butcher: false, deadend: false,
  gravediggerBoss: false, deadendBoss: false,
};

// Последний разобранный список Q-меню. runDailyQuests идёт в цикле ПОСЛЕ фарма, поэтому
// решение про ферму принимается по списку из предыдущего цикла - для этого и кэш.
S.lastListedQuestNames = null;

// "Дейлик" гарпии — бонусный бой привязан к конкретному дню недели с фиксированным числом
// боёв, один в один как у Цунами (порт commit fb9dea7, 16.09.2026, EXTRA_DAILY_TASKS/
// getDay()). Date.getDay(): 0=Вс,1=Пн,2=Вт,3=Ср,4=Чт,5=Пт,6=Сб. Гарпия: только вторник (2),
// x3, остальные дни цель просто недоступна (не "уже сделано", а буквально нет дейлика).
// Бизон/кабан НЕ гейтятся по дню - 16.09.2026, Паша: "продолжай фарм на бизоне и кабане
// (теперь это обычный фарм)" - после ручного прохождения дневного бонуса они farmable как
// обычные repeat-farm мобы (см. runBisonFarmRound/runBoarFarmRound), без дневного лимита.
function getWeekday() {
  return new Date().getDay();
}

const HARPY_HUNT_WEEKDAY = 2; // вторник
const HARPY_HUNTS_PER_DAY = 3;

S.harpyHuntDayKey = '';
S.harpyHuntFightsToday = 0;

function resetHuntStateIfNewDay() {
  const key = getDayKeyNow();
  if (S.harpyHuntDayKey !== key) {
    S.harpyHuntDayKey = key;
    S.harpyHuntFightsToday = 0;
  }
}

function parseCooldownError(e) {
  const m = /^fight_target_cooldown:(\d+)$/.exec((e && e.message) || '');
  return m ? Number(m[1]) : null;
}

// Restore "already done today" markers from disk so a restart mid-day doesn't redo completed dailies.
// Each quest's own dayKey check (getDayKeyNow() comparison) already discards stale data once the day rolls over.
function restoreDailyQuestState() {
  const s = persistedState;

  if (Number.isFinite(s.lastLifeTreeRunAt)) S.lastLifeTreeRunAt = s.lastLifeTreeRunAt;
  if (typeof s.lifeTreeDayKey === 'string') S.lifeTreeDayKey = s.lifeTreeDayKey;
  if (Number.isFinite(s.lifeTreeRunsToday)) S.lifeTreeRunsToday = s.lifeTreeRunsToday;

  if (Number.isFinite(s.lastFishEyeRunAt)) S.lastFishEyeRunAt = s.lastFishEyeRunAt;
  if (typeof s.fishEyeDayKey === 'string') S.fishEyeDayKey = s.fishEyeDayKey;
  if (Number.isFinite(s.fishEyeFightsToday)) S.fishEyeFightsToday = s.fishEyeFightsToday;
  if (typeof s.fishEyeRewardClaimedToday === 'boolean') S.fishEyeRewardClaimedToday = s.fishEyeRewardClaimedToday;

  if (Number.isFinite(s.lastDrabasRunAt)) S.lastDrabasRunAt = s.lastDrabasRunAt;
  if (typeof s.drabasDayKey === 'string') S.drabasDayKey = s.drabasDayKey;
  if (Number.isFinite(s.drabasRunsToday)) S.drabasRunsToday = s.drabasRunsToday;
  if (Number.isFinite(s.drabasNoPetUntil)) S.drabasNoPetUntil = s.drabasNoPetUntil;

  if (Number.isFinite(s.lastVinogradRunAt)) S.lastVinogradRunAt = s.lastVinogradRunAt;
  if (Number.isFinite(s.lastFishSaleAt)) S.lastFishSaleAt = s.lastFishSaleAt;

  if (Number.isFinite(s.lastStatueRunAt)) S.lastStatueRunAt = s.lastStatueRunAt;
  if (Number.isFinite(s.nextStatueDueAt)) S.nextStatueDueAt = s.nextStatueDueAt;

  if (typeof s.shepotMonthKey === 'string') S.shepotMonthKey = s.shepotMonthKey;
  if (typeof s.shepotDoneThisMonth === 'boolean') S.shepotDoneThisMonth = s.shepotDoneThisMonth;
  if (Number.isFinite(s.shepotStage)) S.shepotStage = s.shepotStage;
  if (Number.isFinite(s.shepotGauntletFightsDone)) S.shepotGauntletFightsDone = s.shepotGauntletFightsDone;

  if (typeof s.tavernDayKey === 'string') S.tavernDayKey = s.tavernDayKey;
  if (typeof s.tavernDoneToday === 'boolean') S.tavernDoneToday = s.tavernDoneToday;

  if (typeof s.shtolniDayKey === 'string') S.shtolniDayKey = s.shtolniDayKey;
  if (typeof s.shtolniDoneToday === 'boolean') S.shtolniDoneToday = s.shtolniDoneToday;

  if (typeof s.rumaForgeDayKey === 'string') S.rumaForgeDayKey = s.rumaForgeDayKey;
  if (typeof s.rumaForgeDoneToday === 'boolean') S.rumaForgeDoneToday = s.rumaForgeDoneToday;

  if (typeof s.dovolstvieDayKey === 'string') S.dovolstvieDayKey = s.dovolstvieDayKey;
  if (typeof s.dovolstvieDoneToday === 'boolean') S.dovolstvieDoneToday = s.dovolstvieDoneToday;

  if (typeof s.fisherFoodDayKey === 'string') S.fisherFoodDayKey = s.fisherFoodDayKey;
  if (typeof s.fisherFoodDoneToday === 'boolean') S.fisherFoodDoneToday = s.fisherFoodDoneToday;

  if (typeof s.caravanRobberyDayKey === 'string') S.caravanRobberyDayKey = s.caravanRobberyDayKey;
  if (typeof s.caravanRobberyDoneToday === 'boolean') S.caravanRobberyDoneToday = s.caravanRobberyDoneToday;

  if (typeof s.fishingDayKey === 'string') S.fishingDayKey = s.fishingDayKey;
  if (Number.isFinite(s.fishingCatchesToday)) S.fishingCatchesToday = s.fishingCatchesToday;

  if (typeof s.assassinGuildDayKey === 'string') S.assassinGuildDayKey = s.assassinGuildDayKey;
  if (s.assassinGuildDoneToday && typeof s.assassinGuildDoneToday === 'object') {
    Object.assign(assassinGuildDoneToday, s.assassinGuildDoneToday);
  }
  if (Number.isFinite(s.assassinMerchantAttemptsToday)) S.assassinMerchantAttemptsToday = s.assassinMerchantAttemptsToday;

  if (typeof s.galleryQuestDone === 'boolean') S.galleryQuestDone = s.galleryQuestDone;

  if (typeof s.demonLakeDayKey === 'string') S.demonLakeDayKey = s.demonLakeDayKey;
  if (typeof s.demonLakeDoneToday === 'boolean') S.demonLakeDoneToday = s.demonLakeDoneToday;

  if (typeof s.shipwreckDayKey === 'string') S.shipwreckDayKey = s.shipwreckDayKey;
  if (typeof s.shipwreckDoneToday === 'boolean') S.shipwreckDoneToday = s.shipwreckDoneToday;

  if (typeof s.fishRestaurantJournalOpened === 'boolean') S.fishRestaurantJournalOpened = s.fishRestaurantJournalOpened;
  if (typeof s.fishRestaurantDayKey === 'string') S.fishRestaurantDayKey = s.fishRestaurantDayKey;
  if (typeof s.fishRestaurantDoneToday === 'boolean') S.fishRestaurantDoneToday = s.fishRestaurantDoneToday;
  if (Number.isFinite(s.fishRestaurantNextRewardNumber)) S.fishRestaurantNextRewardNumber = s.fishRestaurantNextRewardNumber;
  if (typeof s.thursdayDailiesDayKey === 'string') S.thursdayDailiesDayKey = s.thursdayDailiesDayKey;
  if (s.thursdayDailiesDone && typeof s.thursdayDailiesDone === 'object') {
    S.thursdayDailiesDone = {
      gravedigger: false, butcher: false, deadend: false,
      gravediggerBoss: false, deadendBoss: false,
      ...s.thursdayDailiesDone,
    };
  }

  if (typeof s.harpyHuntDayKey === 'string') S.harpyHuntDayKey = s.harpyHuntDayKey;
  if (Number.isFinite(s.harpyHuntFightsToday)) S.harpyHuntFightsToday = s.harpyHuntFightsToday;
}

restoreDailyQuestState();

function persistDailyQuestState() {
  Object.assign(persistedState, {
    lastLifeTreeRunAt: S.lastLifeTreeRunAt, lifeTreeDayKey: S.lifeTreeDayKey, lifeTreeRunsToday: S.lifeTreeRunsToday,
    lastFishEyeRunAt: S.lastFishEyeRunAt, fishEyeDayKey: S.fishEyeDayKey, fishEyeFightsToday: S.fishEyeFightsToday, fishEyeRewardClaimedToday: S.fishEyeRewardClaimedToday,
    lastDrabasRunAt: S.lastDrabasRunAt, drabasDayKey: S.drabasDayKey, drabasRunsToday: S.drabasRunsToday,
    drabasNoPetUntil: S.drabasNoPetUntil,
    lastVinogradRunAt: S.lastVinogradRunAt,
    lastFishSaleAt: S.lastFishSaleAt,
    lastStatueRunAt: S.lastStatueRunAt, nextStatueDueAt: S.nextStatueDueAt,
    shepotMonthKey: S.shepotMonthKey, shepotDoneThisMonth: S.shepotDoneThisMonth, shepotStage: S.shepotStage, shepotGauntletFightsDone: S.shepotGauntletFightsDone,
    tavernDayKey: S.tavernDayKey, tavernDoneToday: S.tavernDoneToday,
    shtolniDayKey: S.shtolniDayKey, shtolniDoneToday: S.shtolniDoneToday,
    rumaForgeDayKey: S.rumaForgeDayKey, rumaForgeDoneToday: S.rumaForgeDoneToday,
    dovolstvieDayKey: S.dovolstvieDayKey, dovolstvieDoneToday: S.dovolstvieDoneToday,
    fisherFoodDayKey: S.fisherFoodDayKey, fisherFoodDoneToday: S.fisherFoodDoneToday,
    caravanRobberyDayKey: S.caravanRobberyDayKey, caravanRobberyDoneToday: S.caravanRobberyDoneToday,
    fishingDayKey: S.fishingDayKey, fishingCatchesToday: S.fishingCatchesToday,
    assassinGuildDayKey: S.assassinGuildDayKey, assassinGuildDoneToday, assassinMerchantAttemptsToday: S.assassinMerchantAttemptsToday,
    galleryQuestDone: S.galleryQuestDone,
    demonLakeDayKey: S.demonLakeDayKey, demonLakeDoneToday: S.demonLakeDoneToday,
    shipwreckDayKey: S.shipwreckDayKey, shipwreckDoneToday: S.shipwreckDoneToday,
    fishRestaurantJournalOpened: S.fishRestaurantJournalOpened, fishRestaurantDayKey: S.fishRestaurantDayKey, fishRestaurantDoneToday: S.fishRestaurantDoneToday, fishRestaurantNextRewardNumber: S.fishRestaurantNextRewardNumber,
    thursdayDailiesDayKey: S.thursdayDailiesDayKey, thursdayDailiesDone: S.thursdayDailiesDone,
    harpyHuntDayKey: S.harpyHuntDayKey, harpyHuntFightsToday: S.harpyHuntFightsToday,
  });
  saveStateToDisk(persistedState);
}

function resetAssassinGuildDayIfNeeded() {
  const key = getDayKeyNow();
  if (S.assassinGuildDayKey !== key) {
    S.assassinGuildDayKey = key;
    assassinGuildDoneToday.banker = false;
    assassinGuildDoneToday.painting = false;
    assassinGuildDoneToday.merchant = false;
    S.assassinMerchantAttemptsToday = 0;
  }
}

const EXCLUSIVE_QUEST_MAX_ACTIVE_MS = 30 * 60 * 1000; // max focus window
const EXCLUSIVE_QUEST_ERROR_BACKOFF_MS = 15 * 60 * 1000; // pause exclusive quest after repeated errors
const EXCLUSIVE_QUEST_TIMEOUT_BACKOFF_MS = 30 * 60 * 1000; // pause after focus timeout
const EXCLUSIVE_QUEST_CONFLICT_BACKOFF_MS = 5 * 60 * 1000; // pause when blocked by another exclusive quest

function getDayKeyNow() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function getMonthKeyNow() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------------------
// Состояние, которое раньше было объявлено посреди module.js рядом со своим кодом
// (HP-гейты, PvP-оповещения, кухня). Перенесено сюда, чтобы все S.* были в одном месте.
// ---------------------------------------------------------------------------------------

// (из lib/hp.js)
// 17.09.2026, живой инцидент: внутри ОДНОГО вызова runDailyQuests очередь квестов идёт без
// единой проверки HP - драйвер смотрит на него только после всей очереди. Персонаж умер на
// гаунтлете асассинов, и следующие несколько минут драйвер водил труп по локациям и перебирал
// шаги Харчевни, пока игра отвечала "Восстановите здоровье". Навигировать на location.php перед
// каждым шагом нельзя (квесты стартуют с открытого Q-меню, это сломает им контекст), поэтому
// читаем HP из текста страницы, на которой шаг и так закончился, и запоминаем флагом: следующий
// шаг очереди по нему просто пропускается, и очередь обрывается сама.
S.characterDownDetected = false;

// (из lib/hp.js)
// Последнее ДОСТОВЕРНО прочитанное HP. Нужно потому, что боевые экраны ("В бой!") и часть
// квестовых сцен шапку со статами не рендерят, и parseStats там возвращает null. Гейты,
// написанные как `typeof hp === 'number' && hp < max * 0.7`, в этом случае молча пропускают
// бой: все условия ложны. Именно так 17.09.2026 персонаж ушёл в бой с боевым псом на 63% и
// в итоге погиб - в логе нет строки "останавливаюсь перед боем", сразу "бой с боевым псом".
S.lastKnownHp = { current: null, max: null, at: 0 };

// (из lib/pvp.js)
S.lastAttackClickAt = 0;

// (из lib/pvp.js)
S.attackAlertCooldownUntil = 0;

// (из lib/fishing.js)
S.kitchenOutOfFish = false;

// ---------------------------------------------------------------------------------------
// Константы, которые используются в нескольких файлах lib/. Держим их здесь, а не в файле
// темы: только state.js грузится целиком раньше всех, поэтому только отсюда безопасно
// забирать НЕ-функции при require (см. пояснение в module.js).
// ---------------------------------------------------------------------------------------

// (из lib/mail.js)
// Ник ЭТОГО персонажа. ВНИМАНИЕ: SELF_NICK выше = 'tsunami' - он достался файлу от кода
// главного персонажа Цунами, и для AI__ не годится. Для чат-триггеров нужен именно свой ник,
// иначе "обратились ко мне" не сработает ни разу.
// Теперь совпадает с SELF_NICK выше (оба = 'AI__'), но оставлено отдельной константой:
// SELF_NICK участвует в боевых регэкспах, а этот - в разборе чата, и смешивать их не стоит.
const AI_SELF_NICK = 'AI__';

// (из lib/mail.js)
const AI_SELF_NICK_RE = /\bAI__\b/i;

// (из lib/hp.js)
// Общий порог HP для ЛЮБОГО квестового боя. 0.7, а не 0.4: 15.09.2026 один охранник банкира
// снял ~225 HP за бой даже с эликсиром, 17.09.2026 персонаж погиб на Харчевне/Демоне озера,
// зайдя в бой без всякой проверки. Дешевле пропустить квест до следующего цикла, чем лечиться.
const QUEST_FIGHT_HP_FLOOR = 0.7;

// (из lib/stats_decisions.js)
// Below this HP a simple Chaos Fist heal is not enough; go recover at Форпост/Последний дом instead.
const LAST_HOUSE_HP_THRESHOLD = -1500;

// (из lib/recovery.js)
const DEVTOWN_FASTWAY_URL = 'http://lbast.ru/location.php?mod=fastway&lway=8'; // Девтаун

// (из lib/recovery.js)
// Порог "критического HP", на котором в бою жмётся Пояс. Паша, 17.09.2026: "сделай чтобы при
// критическом хп использовался пояс в бою". Было 0.3 - и это уже стоило живого КО (см.
// driver.js, Рыбий глаз 15.09.2026: "эликсир ни разу не сработал, видимо урон одним ударом
// перепрыгнул через порог 30%"). Проверка идёт ПОСЛЕ удара противника, поэтому порог обязан
// быть выше самого крупного одиночного урона, иначе HP перескакивает из "ещё не критично"
// сразу в ноль, и лечиться уже некому. Живой замер: бизон снимает до 186 HP при максимуме
// 380 - это 49%. Отсюда 0.5.
const HEALING_ELIXIR_HP_FRACTION = 0.5;

// (из lib/recovery.js)
// 16.09.2026, Паша: "с активным элем можно опустить порог хп до 0.4" - один общий
// pers.php-чек раз за цикл (не по разу на каждую фарм-функцию), результат передаётся в
// runHarpyFarmRound/runBisonFarmRound/runBoarFarmRound как параметр, чтобы не плодить
// лишние обращения к pers.php на каждый вызов.
const HP_FLOOR_WITH_BUFF = 0.4;

// (из lib/quests_story.js)
const DEMON_LAKE_FASTWAY_URL = 'http://lbast.ru/location.php?mod=fastway&lway=9'; // Дорожный крест

// (из lib/fish_restaurant_quest.js)
// Паша, 17.09.2026: "Рыбный ресторан настроим как закончишь с дейликами". До тех пор квест
// выключен, и это не косметика: его маршрут упирается в ОБЯЗАТЕЛЬНУЮ засаду с пятнистым
// аллигатором. Защита виньеток правильно отказывается жать "В бой!", но игра всё равно
// оставляет бой висеть, а незавершённый бой блокирует игру ЦЕЛИКОМ - 17.09.2026 из-за этого
// подряд упали все три боссовых маршрута четверга (location.php отдавал голый "В бой!").
// Включать только вместе с явной обработкой засады: questFightHpGate + fightLoop.
const FISH_RESTAURANT_ENABLED = false;


// Боевой режим драйвера. Файл-флаг ai_char/no_fight.flag (или AI_NO_FIGHT=1) ограничивает бои:
//   файла нет                -> 'all'    : всё как обычно;
//   в файле слово "single"   -> 'single' : только одиночные боты (Паша 20.09.2026, после руны:
//                                          «Попробуй одиночных ботов бить»), цепочки боёв - нет;
//   файл есть без "single"   -> 'none'   : боёв нет вовсе, кроме бизона (первый приказ 20.09).
// Файл перечитывается раз в 30 секунд - режим меняется без перезапуска драйвера.
const PEACEFUL_QUESTS = new Set(['Дерево жизни', 'Довольствие', 'Еда для рыбака']);
// Квесты, где бои идут ЦЕПОЧКОЙ (между ними не полечиться) - их держим выключенными и в 'single'.
// 21.09.2026: Штольни убраны из этого списка - Паша включил их обратно с условием «должен быть эль»,
// и решает теперь не режим боёв, а наличие эля (проверка в lib/shtolni.js).
const CHAIN_FIGHT_QUESTS = new Set(['Шепот', 'Рыбный ресторан']);
const NO_FIGHT_FLAG_PATH = require('path').join(__dirname, '..', 'no_fight.flag');
let fightModeCache = { at: 0, mode: 'all' };
function getFightMode() {
  if (process.env.AI_NO_FIGHT === '1') return 'none';
  const now = Date.now();
  if (now - fightModeCache.at < 30000) return fightModeCache.mode;
  let mode = 'all';
  try {
    const fs = require('fs');
    if (fs.existsSync(NO_FIGHT_FLAG_PATH)) {
      mode = /single/i.test(fs.readFileSync(NO_FIGHT_FLAG_PATH, 'utf8')) ? 'single' : 'none';
    }
  } catch (e) { mode = 'all'; }
  fightModeCache = { at: now, mode };
  return mode;
}
function isNoFightMode() { return getFightMode() === 'none'; }

module.exports = {
  S, isNoFightMode, getFightMode, PEACEFUL_QUESTS, CHAIN_FIGHT_QUESTS, NO_FIGHT_FLAG_PATH,
  setupWindowsConsoleUtf8, loadStateFromDisk, saveStateToDisk, getWeekday, resetHuntStateIfNewDay,
  parseCooldownError, restoreDailyQuestState, persistDailyQuestState,
  resetAssassinGuildDayIfNeeded, getDayKeyNow, getMonthKeyNow, DEBUG_SNAPSHOTS_PATH,
  ENABLE_PVP_ALERTS, SELF_NICK, SELF_NICK_RE, PAUSE_SPEED_FACTOR, UI_STUCK_MAX_FAILS,
  UI_STUCK_MAX_MS, SHTOLNI_MIN_HP_FRACTION, SHTOLNI_MIN_HP, SHTOLNI_MIN_RESERVE_MINUTES,
  SHTOLNI_ENABLED_FOR_AI, STATE_PATH, persistedState, LIFE_TREE_INTERVAL_MS, LIFE_TREE_DAILY_LIMIT,
  FISH_EYE_INTERVAL_MS, FISH_EYE_DAILY_FIGHT_LIMIT, DRABAS_INTERVAL_MS, DRABAS_DAILY_LIMIT,
  VINOGRAD_INTERVAL_MS, STATUE_MIN_INTERVAL_MINUTES, STATUE_MAX_INTERVAL_MINUTES,
  FISHING_DAILY_CATCH_LIMIT, FISHING_ATTEMPT_COOLDOWN_MS, BLAKE_MIN_HP, FARM_TARGET, FARM_LABEL,
  assassinGuildDoneToday, ASSASSIN_MERCHANT_MAX_ATTEMPTS_PER_DAY, THURSDAY_WEEKDAY,
  HARPY_HUNT_WEEKDAY, HARPY_HUNTS_PER_DAY, EXCLUSIVE_QUEST_MAX_ACTIVE_MS,
  EXCLUSIVE_QUEST_ERROR_BACKOFF_MS, EXCLUSIVE_QUEST_TIMEOUT_BACKOFF_MS,
  EXCLUSIVE_QUEST_CONFLICT_BACKOFF_MS, AI_SELF_NICK, AI_SELF_NICK_RE, QUEST_FIGHT_HP_FLOOR,
  LAST_HOUSE_HP_THRESHOLD, DEVTOWN_FASTWAY_URL, HEALING_ELIXIR_HP_FRACTION, HP_FLOOR_WITH_BUFF,
  DEMON_LAKE_FASTWAY_URL, FISH_RESTAURANT_ENABLED,
};
