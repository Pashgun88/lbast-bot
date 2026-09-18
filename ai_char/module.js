// Scenario: Daily Quests

const { chromium } = require('playwright');
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const DEBUG_SNAPSHOTS_PATH = path.join(__dirname, 'logs', 'debug_snapshots.log');

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

function snapshotText(text, limit = 800) {
  return String(text || '')
    .replace(/\u00A0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, limit);
}

function appendDebugSnapshot(tag, { label = '', url = '', text = '' } = {}) {
  const stamp = new Date().toISOString();
  const snap = snapshotText(text, 1200);
  const header = `[${stamp}] ${tag}${label ? ` | ${label}` : ''}${url ? ` | ${url}` : ''}`;

  try {
    fs.mkdirSync(path.dirname(DEBUG_SNAPSHOTS_PATH), { recursive: true });
    fs.appendFileSync(DEBUG_SNAPSHOTS_PATH, `${header}\n${snap}\n\n`, 'utf8');
  } catch (e) {
    // ignore
  }

  console.log(`${tag}: ${snap}`);
}

let lastHandledMailSignature = '';
const ENABLE_PVP_ALERTS = true;
// Паша, 17.09.2026: "Замени селф ник на свой". Было 'tsunami' - константа досталась файлу от
// кода главного персонажа, и из-за неё детектор входящих атак (ATTACK_LINE_RE ищет
// "использует грамоту ... на <ник>") для AI__ не срабатывал НИ РАЗУ.
const SELF_NICK = 'AI__';
const SELF_NICK_RE = new RegExp(`\\b${SELF_NICK}\\b`, 'i');
const PAUSE_SPEED_FACTOR = 0.5;

let nextCycleDelayOverrideMs = null;
let lastCycleStats = null;

// UI stuck detection: if we keep failing to find/click the same step for too long,
// bail out and recover to the city to reset state.
const UI_STUCK_MAX_FAILS = 15;
const UI_STUCK_MAX_MS = 60 * 1000;
let uiStuckState = { stepName: '', count: 0, firstAt: 0 };

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
const SHTOLNI_ENABLED_FOR_AI = false; // отложено до завтрашнего сброса дневных квестов (14.09.2026, по просьбе Паши)
// const UGO_INTERVAL_MS = 65 * 60 * 1000; // "раз в час и 5 минут"
// const UGO_DAILY_LIMIT = 10; // не более 10 раз в день
// let lastUgoRunAt = 0;
// let ugoDayKey = '';
// let ugoRunsToday = 0;

const STATE_PATH = path.join(__dirname, 'daily_quests_piraty.state.json');

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

const LIFE_TREE_INTERVAL_MS = 4 * 60 * 60 * 1000; // раз в 4 часа
const LIFE_TREE_DAILY_LIMIT = 3; // не более 3 раз в день
let lastLifeTreeRunAt = 0;
let lifeTreeDayKey = '';
let lifeTreeRunsToday = 0;

const FISH_EYE_INTERVAL_MS = 25 * 60 * 1000;
const FISH_EYE_DAILY_FIGHT_LIMIT = 10; // 10 раз в день
let lastFishEyeRunAt = 0;
let fishEyeDayKey = '';
let fishEyeFightsToday = 0;
let fishEyeRewardClaimedToday = false;

// Камни Драбаса: 2 раза в день, кулдаун 4 часа.
const DRABAS_INTERVAL_MS = 4 * 60 * 60 * 1000;
const DRABAS_DAILY_LIMIT = 2;
let lastDrabasRunAt = 0;
let drabasDayKey = '';
let drabasRunsToday = 0;

// Полив винограда: каждые 8 часов.
const VINOGRAD_INTERVAL_MS = 8 * 60 * 60 * 1000;
let lastVinogradRunAt = 0;

// Статуя славы: раз в 12-14 часов (случайный интервал в этих пределах).
const STATUE_MIN_INTERVAL_MINUTES = 12 * 60;
const STATUE_MAX_INTERVAL_MINUTES = 14 * 60;
let lastStatueRunAt = 0;
let nextStatueDueAt = 0;

// "Шепот" - квест берётся у "Кулак Хаоса", Паша подтвердил 16.09.2026: "запомни как делается
// он периодический" - раз в месяц, не раз в день. Длинный многоэтапный квест (см.
// progressShepotQuest ниже) - stage переживает рестарты процесса, чтобы не проходить заново
// уже пройденные куски после падения/перезапуска. monthKey сбрасывает done/stage раз в
// календарный месяц.
let shepotMonthKey = '';
let shepotDoneThisMonth = false;
let shepotStage = 0;
// Паша, 17.09.2026 (после 3 боёв гаунтлета): "гайд верный, тебе нужно по очереди на предметы
// нажимать" - все 4 кнопки "Использовать <предмет>" видны на экране ОДНОВРЕМЕННО (не гейтятся
// по текущему монстру), поэтому определять нужный предмет по тому, что "есть на экране",
// не работает - код трижды подряд выбирал первый по списку (отвар арайи). Правильный подход:
// жёстко идти по порядку гайда, отслеривая номер боя отдельным счётчиком.
let shepotGauntletFightsDone = 0;

// Рыбалка: не более 6 успешных уловов в день, кулдаун 2 минуты между попытками —
// пробуем между квестами каждый цикл, пока не наловим лимит. Никогда не запускается из фарма Блейка.
// Также используется во время восстановления в Последнем доме (см. runLastHouseRecovery).
const FISHING_DAILY_CATCH_LIMIT = 6;
const FISHING_ATTEMPT_COOLDOWN_MS = 2 * 60 * 1000;
let fishingDayKey = '';
let fishingCatchesToday = 0;
let lastFishingAttemptAt = 0;

// Порог HP, при котором можно продолжать обычные действия (квесты) или биться с Блейком —
// используется и как условие выхода из критического восстановления в Последнем доме.
const BLAKE_MIN_HP = 1800;

// Цель фарма после квестов: 'blake' (по умолчанию) или 'goblins'. Задаётся менеджером через
// переменную окружения FARM_TARGET при запуске сценария (кнопки "Квесты + Блейки" / "Квесты + Гоблины").
const FARM_TARGET = String(process.env.FARM_TARGET || 'blake').toLowerCase() === 'goblins' ? 'goblins' : 'blake';
const FARM_LABEL = FARM_TARGET === 'goblins' ? 'гоблинов' : 'Блейка';
console.log(`Farm target: ${FARM_TARGET}`);


// Квесты без явно указанного кулдауна: 1 раз в день (в памяти процесса).
let tavernDayKey = '';
let tavernDoneToday = false;
let tavernTakenToday = false;
let tavernFailStreak = 0;
let tavernSuppressedUntil = 0;
let tavernFocusStartedAt = 0;
let shtolniDayKey = '';
let shtolniDoneToday = false;
let shtolniTakenToday = false;
let shtolniFailStreak = 0;
let shtolniSuppressedUntil = 0;
let shtolniNoProgressStreak = 0;
let shtolniLastStage = '';
let shtolniFocusStartedAt = 0;
let rumaForgeDayKey = '';
let rumaForgeDoneToday = false;

// "Довольствие" - короткий ежедневный квест без боя, продиктован Пашей 17.09.2026:
// Амулет -> Дорожный крест -> Казначейство Тригмагистрата -> Получить довольствие -> В игру.
let dovolstvieDayKey = getDayKeyNow();
let dovolstvieDoneToday = true; // Паша, 17.09.2026: "сегодня уже сделано"
let fisherFoodDayKey = '';
let fisherFoodDoneToday = false;
let caravanRobberyDayKey = '';
let caravanRobberyDoneToday = false;

// Гильдия асассинов: 3 независимых задания (банкир/картина/торговец), каждое можно
// выполнять и копить предметы задания раз в день, до достижения 6 уровня для сдачи
// (см. LESSONS_AI_CHAR.md, "Гильдия асассинов"). Отдельный dayKey/doneToday на каждое,
// плюс лимит попыток в день на торговца (он может просто отсутствовать на клетке сейчас).
let assassinGuildDayKey = '';
const assassinGuildDoneToday = { banker: false, painting: false, merchant: false };
let assassinMerchantAttemptsToday = 0;
// Когда в последний раз ехали к каравану и не застали его (см. hasPendingFightQuests).
let assassinMerchantNoCaravanAt = 0;
const ASSASSIN_MERCHANT_MAX_ATTEMPTS_PER_DAY = 6;

// Галерея искусств/лазулиты: одноразовый (не дневной) квест — раз сдан, никогда не
// появится в Q снова. Флаг без day-key, чтобы после первой сдачи диспетчер не ходил
// каждый цикл в Рыбацкую деревню проверять Марсиуса заново.
let galleryQuestDone = false;

// "Орден Тригмагистров: Охота на демона" (Демон озера) — маршрут записан со слов Паши
// 14.09.2026 (продиктован по памяти, не проверен вживую). Обычный дневной квест.
let demonLakeDayKey = '';
let demonLakeDoneToday = false;

// "Кораблекрушение" — маршрут продиктован Пашей 14.09.2026. Обычный дневной квест.
let shipwreckDayKey = '';
let shipwreckDoneToday = false;

// "Рыбный ресторан Тёща Кумуса" — журнал наград открывается один раз (не по дням), затем
// каждый день можно пройти ОДНУ ветку из 27 пронумерованных наград. Паша попросил идти по
// порядку номеров (15.09.2026). Маршруты — из гайда Dikaya (zhg_web.php?st_id=224300),
// см. LESSONS_AI_CHAR.md. НЕ проверено вживую (как Демон озера/Кораблекрушение до первого
// реального прогона) - код написан по тексту гайда, каждый шаг матчится через performStep
// с ретраями, чтобы не падать намертво на неточности формулировки кнопки.
let fishRestaurantJournalOpened = false;
let fishRestaurantDayKey = '';
let fishRestaurantDoneToday = false;
let fishRestaurantNextRewardNumber = 1;
// Паша, 17.09.2026: "рыбный ресторан ты начинал делать и убежал на другой квест". Маршрут
// награды длинный (вереница шагов + 3 боя), и любой упавший шаг раньше просто возвращал
// управление в цикл, который шёл к следующему квесту. Делаем квест эксклюзивным на время
// прохода - как Харчевня/Штольни. НЕ персистим: после рестарта процесса фокус снимается сам,
// иначе упавший маршрут мог бы заблокировать драйвер навсегда.
let fishRestaurantFocusStartedAt = 0;
let fishRestaurantSuppressedUntil = 0;

// Дейлики по дню недели (гайд Паши от 17.09.2026). Date.getDay(): 4 = четверг.
const THURSDAY_WEEKDAY = 4;
let thursdayDailiesDayKey = '';
let thursdayDailiesDone = {
  gravedigger: false, butcher: false, deadend: false,
  gravediggerBoss: false, deadendBoss: false,
};

// Квесты, которые мы РЕАЛЬНО умеем проходить и в которых есть бои. Нужны, чтобы решать, можно
// ли сейчас тратить HP на ферму. Штольни СОЗНАТЕЛЬНО не включены: квест выключен
// (SHTOLNI_ENABLED_FOR_AI = false) и висит в Q-меню всегда - иначе ферма выключилась бы навсегда.
const IMPLEMENTED_FIGHT_QUESTS = [
  'Харчевня',
  'Камни Драбаса',
  'Грабим корованы',
  'Кузница Рума',
  'Еда для рыбака',
  'Рыбный ресторан',
  'Трактир «Рыбий глаз»',
  // Асассины выключены (мораль в минус) и ферму не держат - см. ASSASSIN_QUESTS_ENABLED.
  'Ордо экзекуторс: Уничтожить главаря банды',
  'Ордо экзекуторс: Уничтожить банду',
];

// Последний разобранный список Q-меню. runDailyQuests идёт в цикле ПОСЛЕ фарма, поэтому
// решение про ферму принимается по списку из предыдущего цикла - для этого и кэш.
let lastListedQuestNames = null;

// Паша, 17.09.2026: "квесты важнее фарма". Одного порога HP мало: живой замер показал, что
// ОДИН бой с бизоном снимает 186 HP (49% от максимума 380). То есть даже стартовав с 70%,
// после фарма персонаж оказывается на ~29% и ни один квест с боем уже не проходит.
// Поэтому ферма ждёт, пока сегодняшние квесты с боями не будут закрыты.
function hasPendingFightQuests() {
  // null = Q-меню в этом процессе ещё ни разу не видели. Считаем, что квесты есть: пропустить
  // один круг фарма дешевле, чем сточить HP и потерять дейлик, который пропадёт вместе с днём.
  if (lastListedQuestNames === null) return true;
  // 18.09.2026, Паша: "почему сейчас не фармит?" - ферма стояла на 354/380, "сберегая HP" под
  // торговца, на которого дневные попытки уже кончились. Такой квест сегодня не пойдёт, и
  // держать ради него ферму бессмысленно.
  // И второе: при 380/380 ферма стояла ради торговца, которого только что не застали на
  // клетке. Ждать HP под квест, который сейчас сделать нельзя, - значит не делать ничего.
  // 30 минут после "каравана нет" торговец ферму не держит (сам он пробуется каждый цикл).
  const merchantOut = assassinMerchantAttemptsToday >= ASSASSIN_MERCHANT_MAX_ATTEMPTS_PER_DAY
    || Date.now() - assassinMerchantNoCaravanAt < 30 * 60 * 1000;
  // Ещё два квеста висят в Q ВСЕГДА и потому держали ферму вечно: выключенный Рыбный
  // ресторан (FISH_RESTAURANT_ENABLED) и Рыбий глаз - он повторяется каждые 25 минут и в
  // цикле всё равно идёт РАНЬШЕ фермы, когда подходит его очередь.
  const skip = (q) => (merchantOut && /торгов/i.test(q))
    || (!FISH_RESTAURANT_ENABLED && q === 'Рыбный ресторан')
    || (q === 'Трактир «Рыбий глаз»' && !canRunFishEyeFightNow());
  return IMPLEMENTED_FIGHT_QUESTS
    .filter((q) => !skip(q))
    .some((q) => isQuestInMenu(lastListedQuestNames, q));
}

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

let harpyHuntDayKey = '';
let harpyHuntFightsToday = 0;

function resetHuntStateIfNewDay() {
  const key = getDayKeyNow();
  if (harpyHuntDayKey !== key) {
    harpyHuntDayKey = key;
    harpyHuntFightsToday = 0;
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

  if (Number.isFinite(s.lastLifeTreeRunAt)) lastLifeTreeRunAt = s.lastLifeTreeRunAt;
  if (typeof s.lifeTreeDayKey === 'string') lifeTreeDayKey = s.lifeTreeDayKey;
  if (Number.isFinite(s.lifeTreeRunsToday)) lifeTreeRunsToday = s.lifeTreeRunsToday;

  if (Number.isFinite(s.lastFishEyeRunAt)) lastFishEyeRunAt = s.lastFishEyeRunAt;
  if (typeof s.fishEyeDayKey === 'string') fishEyeDayKey = s.fishEyeDayKey;
  if (Number.isFinite(s.fishEyeFightsToday)) fishEyeFightsToday = s.fishEyeFightsToday;
  if (typeof s.fishEyeRewardClaimedToday === 'boolean') fishEyeRewardClaimedToday = s.fishEyeRewardClaimedToday;

  if (Number.isFinite(s.lastDrabasRunAt)) lastDrabasRunAt = s.lastDrabasRunAt;
  if (typeof s.drabasDayKey === 'string') drabasDayKey = s.drabasDayKey;
  if (Number.isFinite(s.drabasRunsToday)) drabasRunsToday = s.drabasRunsToday;

  if (Number.isFinite(s.lastVinogradRunAt)) lastVinogradRunAt = s.lastVinogradRunAt;

  if (Number.isFinite(s.lastStatueRunAt)) lastStatueRunAt = s.lastStatueRunAt;
  if (Number.isFinite(s.nextStatueDueAt)) nextStatueDueAt = s.nextStatueDueAt;

  if (typeof s.shepotMonthKey === 'string') shepotMonthKey = s.shepotMonthKey;
  if (typeof s.shepotDoneThisMonth === 'boolean') shepotDoneThisMonth = s.shepotDoneThisMonth;
  if (Number.isFinite(s.shepotStage)) shepotStage = s.shepotStage;
  if (Number.isFinite(s.shepotGauntletFightsDone)) shepotGauntletFightsDone = s.shepotGauntletFightsDone;

  if (typeof s.tavernDayKey === 'string') tavernDayKey = s.tavernDayKey;
  if (typeof s.tavernDoneToday === 'boolean') tavernDoneToday = s.tavernDoneToday;

  if (typeof s.shtolniDayKey === 'string') shtolniDayKey = s.shtolniDayKey;
  if (typeof s.shtolniDoneToday === 'boolean') shtolniDoneToday = s.shtolniDoneToday;

  if (typeof s.rumaForgeDayKey === 'string') rumaForgeDayKey = s.rumaForgeDayKey;
  if (typeof s.rumaForgeDoneToday === 'boolean') rumaForgeDoneToday = s.rumaForgeDoneToday;

  if (typeof s.dovolstvieDayKey === 'string') dovolstvieDayKey = s.dovolstvieDayKey;
  if (typeof s.dovolstvieDoneToday === 'boolean') dovolstvieDoneToday = s.dovolstvieDoneToday;

  if (typeof s.fisherFoodDayKey === 'string') fisherFoodDayKey = s.fisherFoodDayKey;
  if (typeof s.fisherFoodDoneToday === 'boolean') fisherFoodDoneToday = s.fisherFoodDoneToday;

  if (typeof s.caravanRobberyDayKey === 'string') caravanRobberyDayKey = s.caravanRobberyDayKey;
  if (typeof s.caravanRobberyDoneToday === 'boolean') caravanRobberyDoneToday = s.caravanRobberyDoneToday;

  if (typeof s.fishingDayKey === 'string') fishingDayKey = s.fishingDayKey;
  if (Number.isFinite(s.fishingCatchesToday)) fishingCatchesToday = s.fishingCatchesToday;

  if (typeof s.assassinGuildDayKey === 'string') assassinGuildDayKey = s.assassinGuildDayKey;
  if (s.assassinGuildDoneToday && typeof s.assassinGuildDoneToday === 'object') {
    Object.assign(assassinGuildDoneToday, s.assassinGuildDoneToday);
  }
  if (Number.isFinite(s.assassinMerchantAttemptsToday)) assassinMerchantAttemptsToday = s.assassinMerchantAttemptsToday;

  if (typeof s.galleryQuestDone === 'boolean') galleryQuestDone = s.galleryQuestDone;

  if (typeof s.demonLakeDayKey === 'string') demonLakeDayKey = s.demonLakeDayKey;
  if (typeof s.demonLakeDoneToday === 'boolean') demonLakeDoneToday = s.demonLakeDoneToday;

  if (typeof s.shipwreckDayKey === 'string') shipwreckDayKey = s.shipwreckDayKey;
  if (typeof s.shipwreckDoneToday === 'boolean') shipwreckDoneToday = s.shipwreckDoneToday;

  if (typeof s.fishRestaurantJournalOpened === 'boolean') fishRestaurantJournalOpened = s.fishRestaurantJournalOpened;
  if (typeof s.fishRestaurantDayKey === 'string') fishRestaurantDayKey = s.fishRestaurantDayKey;
  if (typeof s.fishRestaurantDoneToday === 'boolean') fishRestaurantDoneToday = s.fishRestaurantDoneToday;
  if (Number.isFinite(s.fishRestaurantNextRewardNumber)) fishRestaurantNextRewardNumber = s.fishRestaurantNextRewardNumber;
  if (typeof s.thursdayDailiesDayKey === 'string') thursdayDailiesDayKey = s.thursdayDailiesDayKey;
  if (s.thursdayDailiesDone && typeof s.thursdayDailiesDone === 'object') {
    thursdayDailiesDone = {
      gravedigger: false, butcher: false, deadend: false,
      gravediggerBoss: false, deadendBoss: false,
      ...s.thursdayDailiesDone,
    };
  }

  if (typeof s.harpyHuntDayKey === 'string') harpyHuntDayKey = s.harpyHuntDayKey;
  if (Number.isFinite(s.harpyHuntFightsToday)) harpyHuntFightsToday = s.harpyHuntFightsToday;
}

restoreDailyQuestState();

function persistDailyQuestState() {
  Object.assign(persistedState, {
    lastLifeTreeRunAt, lifeTreeDayKey, lifeTreeRunsToday,
    lastFishEyeRunAt, fishEyeDayKey, fishEyeFightsToday, fishEyeRewardClaimedToday,
    lastDrabasRunAt, drabasDayKey, drabasRunsToday,
    lastVinogradRunAt,
    lastStatueRunAt, nextStatueDueAt,
    shepotMonthKey, shepotDoneThisMonth, shepotStage, shepotGauntletFightsDone,
    tavernDayKey, tavernDoneToday,
    shtolniDayKey, shtolniDoneToday,
    rumaForgeDayKey, rumaForgeDoneToday,
    dovolstvieDayKey, dovolstvieDoneToday,
    fisherFoodDayKey, fisherFoodDoneToday,
    caravanRobberyDayKey, caravanRobberyDoneToday,
    fishingDayKey, fishingCatchesToday,
    assassinGuildDayKey, assassinGuildDoneToday, assassinMerchantAttemptsToday,
    galleryQuestDone,
    demonLakeDayKey, demonLakeDoneToday,
    shipwreckDayKey, shipwreckDoneToday,
    fishRestaurantJournalOpened, fishRestaurantDayKey, fishRestaurantDoneToday, fishRestaurantNextRewardNumber,
    thursdayDailiesDayKey, thursdayDailiesDone,
    harpyHuntDayKey, harpyHuntFightsToday,
  });
  saveStateToDisk(persistedState);
}

function resetAssassinGuildDayIfNeeded() {
  const key = getDayKeyNow();
  if (assassinGuildDayKey !== key) {
    assassinGuildDayKey = key;
    assassinGuildDoneToday.banker = false;
    assassinGuildDoneToday.painting = false;
    assassinGuildDoneToday.merchant = false;
    assassinMerchantAttemptsToday = 0;
  }
}

const EXCLUSIVE_QUEST_MAX_ACTIVE_MS = 30 * 60 * 1000; // max focus window
const EXCLUSIVE_QUEST_ERROR_BACKOFF_MS = 15 * 60 * 1000; // pause exclusive quest after repeated errors
const EXCLUSIVE_QUEST_TIMEOUT_BACKOFF_MS = 30 * 60 * 1000; // pause after focus timeout
const EXCLUSIVE_QUEST_CONFLICT_BACKOFF_MS = 5 * 60 * 1000; // pause when blocked by another exclusive quest

async function getPageTitleSafe(page) {
  try {
    return await page.title();
  } catch (e) {
    return '';
  }
}

function parseMailCountFromText(text) {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  const match = normalized.match(/Письма\s*\((\d+)\)/i);

  if (!match) {
    return 0;
  }

  return Number(match[1] || 0);
}

// 17.09.2026, найдено измерением: счётчик писем ЕСТЬ на location.php, но лежит в атрибуте
// картинки, а не в тексте страницы:
//   <img src="pics/icons/mail_unread.gif" title="Письма (1)">
// getBodyText возвращает innerText, куда атрибуты не попадают, поэтому parseMailCountFromText
// искал верную строку там, где её физически быть не может, и всегда возвращал 0. Из-за этого
// handleUnreadMailIfAny выходил в первой же строке КАЖДЫЙ цикл и не заметил ни одного письма
// (живая проверка: письмо от Tsunami от 17-09 15:48 висело непрочитанным, в логах - ни строки).
// Признак непрочитанного - сама иконка mail_unread.gif; число берём из её title.
async function readMailCountFromIcon(page) {
  return page
    .evaluate(() => {
      const img = document.querySelector('img[src*="mail_unread"]');
      if (!img) return 0;
      const title = (img.getAttribute('title') || '').replace(/\s+/g, ' ');
      const m = title.match(/Письма\s*\((\d+)\)/i);
      // Иконка непрочитанного есть, а число не разобралось - значит писем хотя бы одно.
      return m ? Number(m[1]) : 1;
    })
    .catch(() => 0);
}

async function getMailCountFromPage(page) {
  const iconCount = await readMailCountFromIcon(page);
  if (iconCount > 0) {
    return {
      count: iconCount,
      sourceText: `mail_unread.gif title="Письма (${iconCount})"`,
    };
  }

  const bodyText = await getBodyText(page);
  const titleText = await getPageTitleSafe(page);

  const bodyCount = parseMailCountFromText(bodyText);
  if (bodyCount > 0) {
    return {
      count: bodyCount,
      sourceText: bodyText,
    };
  }

  const titleCount = parseMailCountFromText(titleText);
  if (titleCount > 0) {
    return {
      count: titleCount,
      sourceText: titleText,
    };
  }

  return {
    count: 0,
    sourceText: bodyText || titleText || '',
  };
}

function emitMailMessage(payload) {
  try {
    const json = JSON.stringify(payload || {});
    const encoded = Buffer.from(json, 'utf8').toString('base64');
    console.log(`MAIL_MESSAGE:${encoded}`);
  } catch (e) {
    console.log(`Не удалось сериализовать письмо: ${e.message}`);
  }
}

function emitPvpAlert(payload) {
  if (!ENABLE_PVP_ALERTS) {
    return;
  }

  try {
    const json = JSON.stringify(payload || {});
    const encoded = Buffer.from(json, 'utf8').toString('base64');
    console.log(`PVP_ALERT:${encoded}`);
  } catch (e) {
    console.log(`Не удалось сериализовать PVP alert: ${e.message}`);
  }
}

// Ник ЭТОГО персонажа. ВНИМАНИЕ: SELF_NICK выше = 'tsunami' - он достался файлу от кода
// главного персонажа Цунами, и для AI__ не годится. Для чат-триггеров нужен именно свой ник,
// иначе "обратились ко мне" не сработает ни разу.
// Теперь совпадает с SELF_NICK выше (оба = 'AI__'), но оставлено отдельной константой:
// SELF_NICK участвует в боевых регэкспах, а этот - в разборе чата, и смешивать их не стоит.
const AI_SELF_NICK = 'AI__';
const AI_SELF_NICK_RE = /\bAI__\b/i;

// Триггер чата - отдельный маркер в логе, по образцу PVP_ALERT/ATTACK_ALERT/MAIL_MESSAGE.
// Нужен потому, что обычные "CHAT UPDATE" печатаются на ЛЮБОЕ изменение комнаты, и обращение
// к нам тонет среди болтовни. CHAT_TRIGGER печатается только когда реально пора вмешаться.
function emitChatTrigger(payload) {
  try {
    const json = JSON.stringify(payload || {});
    const encoded = Buffer.from(json, 'utf8').toString('base64');
    console.log(`CHAT_TRIGGER:${encoded}`);
  } catch (e) {
    console.log(`Не удалось сериализовать chat trigger: ${e.message}`);
  }
}

function buildMailSignature(mail) {
  return [
    String(mail?.sender || '').trim(),
    String(mail?.date || '').trim(),
    String(mail?.body || '').trim().slice(0, 500),
  ].join('|');
}

async function openMailbox(page) {
  // 17.09.2026: раньше шаг жал ссылку по ТЕКСТУ Письма - и не находил её никогда. На
  // location.php почта это ИКОНКА БЕЗ ТЕКСТА (href содержит letters.php), самого слова
  // Письма на странице нет вовсе. Тот же класс ошибки, что был у счётчика непрочитанных:
  // код искал текст там, где его физически не может быть, и молча выходил. Из-за этого
  // письмо детектировалось, но ящик не открывался (Не удалось нажать на Письма).
  // Проверенный способ - брать href по подстроке letters.php (так работает replyToLetter).
  // Когда непрочитанных нет, иконка ведёт на страницу по умолчанию БЕЗ mod=inbox, где
  // списка писем нет - поэтому mod=inbox дописываем явно.
  const hrefs = await page
    .evaluate(() => Array.from(document.querySelectorAll("a"))
      .map((a) => a.getAttribute("href") || "")
      .filter((h) => h.includes("letters.php")))
    .catch(() => []);

  if (!hrefs.length) {
    console.log("Почта: на странице нет ссылки на письма (иконка letters.php не найдена).");
    return false;
  }

  let href = hrefs.find((h) => h.includes("mod=inbox")) || hrefs[0];
  if (!href.includes("mod=inbox")) href = href + "&mod=inbox";
  const url = "http://lbast.ru/" + (href[0] === "/" ? href.slice(1) : href);

  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await pause(page, 1000, 2000);
  return true;
}

async function getMailThreadIndex(page, unreadOnly = false) {
  return await page.evaluate((onlyUnread) => {
    function getStyleText(node) {
      if (!node) {
        return '';
      }

      const inlineStyle = String(node.getAttribute?.('style') || '');
      const computedStyle = window.getComputedStyle(node);

      return [
        inlineStyle,
        computedStyle.color,
        computedStyle.backgroundColor,
        computedStyle.borderLeftColor,
        computedStyle.borderLeftWidth,
        computedStyle.fontWeight,
      ].join(' ').toLowerCase();
    }

    function hasBoldUnreadMarker(anchor) {
      const nodes = [anchor, anchor.parentElement, anchor.closest('td'), anchor.closest('tr')];

      for (const node of nodes) {
        if (!node) {
          continue;
        }

        const fontWeight = window.getComputedStyle(node).fontWeight;
        const numericWeight = Number.parseInt(fontWeight, 10);

        if (!Number.isNaN(numericWeight) && numericWeight >= 600) {
          return true;
        }

        if (/bold/i.test(String(fontWeight))) {
          return true;
        }
      }

      return Boolean(anchor.querySelector('b, strong'));
    }

    function hasRedUnreadMarker(anchor) {
      let current = anchor;

      for (let depth = 0; current && depth < 4; depth += 1) {
        if (/red|rgb\(255,\s*0,\s*0\)|#f00|#ff0000/.test(getStyleText(current))) {
          return true;
        }

        for (const child of Array.from(current.children || [])) {
          if (/red|rgb\(255,\s*0,\s*0\)|#f00|#ff0000/.test(getStyleText(child))) {
            return true;
          }
        }

        current = current.parentElement;
      }

      return false;
    }

    const anchors = Array.from(document.querySelectorAll('a'));
    let bestIndex = -1;
    let bestScore = -1;

    for (let i = 0; i < anchors.length; i++) {
      const a = anchors[i];
      const text = String(a.textContent || '').replace(/\s+/g, ' ').trim();
      const href = String(a.getAttribute('href') || '').trim();
      const row = a.closest('tr') || a.closest('td') || a.parentElement;
      const parentText = String(row?.innerText || a.parentElement?.innerText || '').replace(/\s+/g, ' ').trim();
      const style = [getStyleText(a), getStyleText(a.parentElement), getStyleText(row)].join(' ');

      if (!text) {
        continue;
      }

      if (!/\[\d{2}-\d{2}\s+\d{2}:\d{2}\]/.test(parentText)) {
        continue;
      }

      const hasUnreadStyle = hasBoldUnreadMarker(a) || hasRedUnreadMarker(a);
      if (onlyUnread && !hasUnreadStyle) {
        continue;
      }

      let score = 10;

      if (hasUnreadStyle) {
        score += 20;
      }

      if (/red|ff0000|#f00|#ff0000/.test(style)) {
        score += 8;
      }

      if (/mail|post|msg|message|letter/i.test(href)) {
        score += 5;
      }

      if (text.length >= 3 && text.length <= 40) {
        score += 2;
      }

      if (score > bestScore) {
        bestScore = score;
        bestIndex = i;
      }
    }

    return bestIndex;
  }, unreadOnly);
}

async function clickMailThread(page, unreadOnly = false) {
  const index = await getMailThreadIndex(page, unreadOnly);

  if (index < 0) {
    console.log(unreadOnly
      ? '?? ??????? ????????????? ?????'
      : '?? ??????? ????? ?????? ?? ??????');
    return false;
  }

  try {
    await page.locator('a').nth(index).click({ timeout: 5000 });
    console.log('OK: ?????? ' + (unreadOnly ? '????????????? ??????' : '??????'));
    await pause(page, 1000, 2000);
    return true;
  } catch (e) {
    console.log('?? ??????? ??????? ' + (unreadOnly ? '????????????? ??????' : '??????') + ': ' + e.message);
    return false;
  }
}

function parseLatestMailFromText(text) {
  const normalized = String(text || '')
    .replace(/\r/g, '')
    .replace(/\u00A0/g, ' ')
    .trim();

  const blocks = [];
  const regex = /От:\s*(.+?)\n([\s\S]*?)(?=\nОт:\s*|\nСообщений:|$)/g;

  let match;
  while ((match = regex.exec(normalized)) !== null) {
    const sender = String(match[1] || '').trim();
    const rest = String(match[2] || '').trim();

    const dateMatch = rest.match(/(\d{2}-\d{2}\s+\d{2}:\d{2})/);
    const date = dateMatch ? dateMatch[1] : '';

    let body = rest;

    body = body.replace(/^\d{2}-\d{2}\s+\d{2}:\d{2}\s*(\[[^\]]+\]\s*)*/m, '').trim();
    body = body.replace(/^---\s*/m, '').trim();
    body = body.replace(/\n?Сообщений:\s*[\s\S]*$/m, '').trim();
    body = body.replace(/\n?Удалить цепочку писем[\s\S]*$/m, '').trim();

    blocks.push({
      sender,
      date,
      body,
    });
  }

  if (!blocks.length) {
    return null;
  }

  return blocks[0];
}

async function readCurrentMail(page) {
  const text = await getBodyText(page);
  const parsed = parseLatestMailFromText(text);

  if (!parsed) {
    console.log('Не удалось распарсить письмо на странице');
    return null;
  }

  if (!parsed.body) {
    console.log('Тело письма пустое');
    return null;
  }

  return parsed;
}

async function returnToGame(page) {
  const ok = await clickByTexts(page, ['В игру', 'в игру'], 'В игру');

  if (ok) {
    await pause(page, 1000, 2000);
    return true;
  }

  try {
    await page.goto('http://lbast.ru/location.php', {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });
    await pause(page, 1000, 2000);
    console.log('Вернулся в игру через location.php');
    return true;
  } catch (e) {
    console.log(`Не удалось вернуться в игру: ${e.message}`);
    return false;
  }
}

async function handleUnreadMailIfAny(page) {
  const mailInfo = await getMailCountFromPage(page);
  const mailCount = Number(mailInfo?.count || 0);
  const sourceText = String(mailInfo?.sourceText || '');

  if (mailCount <= 0) {
    return false;
  }

  // 17.09.2026: все сообщения этой функции были побиты кодировкой ("??????? ????? ??????") -
  // то есть даже сработав, она докладывала о письме нечитаемо, и в логе это выглядело как шум.
  console.log('Непрочитанных писем: ' + mailCount);

  let openedMailbox = false;
  const handledSignatures = new Set();
  let handledAny = false;

  try {
    openedMailbox = await openMailbox(page);

    if (!openedMailbox) {
      console.log('Почта: не удалось открыть ящик.');
      return false;
    }

    for (let i = 0; i < mailCount; i++) {
      if (i > 0) {
        openedMailbox = await openMailbox(page);
        if (!openedMailbox) {
          console.log('Почта: не удалось открыть ящик повторно.');
          break;
        }
      }

      const openedThread = await clickMailThread(page, true);
      if (!openedThread) {
        if (i === 0) {
          console.log('Почта: не удалось открыть ни одну непрочитанную переписку.');
          return false;
        }
        break;
      }

      const mail = await readCurrentMail(page);
      if (!mail) {
        console.log('Почта: не удалось прочитать письмо.');
        break;
      }

      const signature = buildMailSignature(mail);
      if (handledSignatures.has(signature)) {
        console.log('Почта: то же самое письмо открылось повторно - прекращаю обход.');
        break;
      }

      handledSignatures.add(signature);
      handledAny = true;

      if (signature === lastHandledMailSignature) {
        console.log('Почта: это письмо уже отправляли в Telegram, пропускаю.');
      } else {
        lastHandledMailSignature = signature;

        emitMailMessage({
          sender: mail.sender,
          body: mail.body,
        });

        // Паша, 17.09.2026: "нужно автоответы сделать по типу как в чате, считай письмо это
        // тригер". MAIL_MESSAGE - машинный маркер для manager_bot.js, в логе он выглядит как
        // строка base64, и глазами его не заметить. Громкий блок печатается ровно в том же
        // формате, что чат-триггеры (>>> ПОРА ОТВЕТИТЬ), чтобы письмо требовало ответа так же
        // заметно, как обращение в клановом зале.
        console.log(`>>> ПОРА ОТВЕТИТЬ [letter] "${mail.sender || 'неизвестный'}": письмо ${i + 1}/${mailCount}`);
        for (const line of String(mail.body || '').split('\n')) {
          if (line.trim()) console.log(`    ${line.trim()}`);
        }
        console.log('');
      }
    }

    return handledAny;
  } catch (e) {
    console.log('Почта: ошибка обработки письма: ' + e.message);
    return false;
  } finally {
    if (openedMailbox) {
      await returnToGame(page);
    }
  }
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function pause(page, min = 500, max = 2000) {
  const scaledMin = Math.max(0, Math.round(min * PAUSE_SPEED_FACTOR));
  const scaledMax = Math.max(scaledMin, Math.round(max * PAUSE_SPEED_FACTOR));
  const delay = randomInt(scaledMin, scaledMax);
  await page.waitForTimeout(delay);
}

async function fixedPause(page, ms) {
  await page.waitForTimeout(ms);
}

function getRandomCycleDelayMs() {
  const minutes = randomInt(14, 21);
  return minutes * 60 * 1000;
}

function isNetworkError(e) {
  const msg = String(e?.message || '');
  return /ERR_NAME_NOT_RESOLVED|ERR_INTERNET_DISCONNECTED|ERR_CONNECTION_(REFUSED|RESET|CLOSED|TIMED_OUT)|ERR_NETWORK_CHANGED|ERR_ADDRESS_UNREACHABLE|net::ERR_/.test(msg);
}

function setNextCycleDelayOverrideMinutes(minMinutes, maxMinutes) {
  const minutes = randomInt(minMinutes, maxMinutes);
  nextCycleDelayOverrideMs = minutes * 60 * 1000;
  return nextCycleDelayOverrideMs;
}

function canRunAnyNonQQuestNow(stats) {
  // Only the truly non-Q priority quests should be considered here.
  // Q-based quests (Life Tree, Drabas, etc.) are handled via runDailyQuests.
  if (isExclusiveQQuestInProgress()) return false;
  // UGO quest disabled (no longer needed).
  // if (stats && stats.hpCurrent !== null && stats.hpCurrent > UGO_MIN_HP && isUgoDue()) return true;
  if (canRunFishEyeRewardNow()) return true;
  if (canRunFishEyeFightNow()) return true;
  return false;
}

function checkExclusiveQuestTimeouts() {
  const now = Date.now();

  if (tavernTakenToday && !tavernDoneToday && tavernFocusStartedAt && now - tavernFocusStartedAt > EXCLUSIVE_QUEST_MAX_ACTIVE_MS) {
    tavernTakenToday = false;
    tavernSuppressedUntil = now + EXCLUSIVE_QUEST_TIMEOUT_BACKOFF_MS;
    tavernFocusStartedAt = 0;
    tavernFailStreak = 0;
    console.log('Tavern quest: focus timeout (30 min) -> release and continue other actions');
  }

  if (shtolniTakenToday && !shtolniDoneToday && shtolniFocusStartedAt && now - shtolniFocusStartedAt > EXCLUSIVE_QUEST_MAX_ACTIVE_MS) {
    shtolniTakenToday = false;
    shtolniSuppressedUntil = now + EXCLUSIVE_QUEST_TIMEOUT_BACKOFF_MS;
    shtolniFocusStartedAt = 0;
    shtolniFailStreak = 0;
    shtolniNoProgressStreak = 0;
    shtolniLastStage = '';
    console.log('Shtolni quest: focus timeout (30 min) -> release and continue other actions');
  }

  if (fishRestaurantFocusStartedAt && now - fishRestaurantFocusStartedAt > EXCLUSIVE_QUEST_MAX_ACTIVE_MS) {
    fishRestaurantFocusStartedAt = 0;
    fishRestaurantSuppressedUntil = now + EXCLUSIVE_QUEST_TIMEOUT_BACKOFF_MS;
    console.log('Fish Restaurant: focus timeout (30 min) -> release and continue other actions');
  }
}

function isExclusiveQQuestInProgress() {
  checkExclusiveQuestTimeouts();
  const now = Date.now();
  const tavernActive = tavernTakenToday && !tavernDoneToday && now >= tavernSuppressedUntil;
  const shtolniActive = shtolniTakenToday && !shtolniDoneToday && now >= shtolniSuppressedUntil;
  const fishRestaurantActive = Boolean(fishRestaurantFocusStartedAt)
    && !fishRestaurantDoneToday
    && now >= fishRestaurantSuppressedUntil;
  return tavernActive || shtolniActive || fishRestaurantActive;
}

function scheduleQuestFollowup(reason) {
  // When we successfully do at least one quest, poll sooner than the default 14-21 min
  // to keep progressing other quests/cooldowns without wasting reserves.
  if (nextCycleDelayOverrideMs !== null) {
    return;
  }
  const ms = setNextCycleDelayOverrideMinutes(2, 4);
  const minutes = Math.round(ms / 60000);
  console.log(`Quest follow-up scheduled: ${minutes} min (${reason})`);
}

// Планирование сна после фарма, когда цикл остановился на локации фарма.
// Если кулдаун ушёл в минус (ресурсы для боя исчерпаны), спим случайные 17-20 минут.
// Иначе (кулдаун ещё есть, но бой не пошёл) — обычный короткий follow-up, если был бой.
function scheduleFarmNextCycle(stats, didFight) {
  const cd = typeof stats?.cooldown === 'number' ? stats.cooldown : stats?.reserveMinutes;
  if (typeof cd === 'number' && cd < 0) {
    scheduleLongRestMinutes(randomInt(17, 20), 'farm_cooldown_recovery');
  } else if (didFight) {
    scheduleQuestFollowup('farm');
  }
}

async function saveSnapshot(page, prefix = 'snapshot') {
  return;
}

async function getBodyText(page) {
  return await page.locator('body').innerText().catch(() => '');
}

function parseStats(text) {
  const normalized = String(text || '')
    .replace(/\u00A0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const qMatch = normalized.match(/\bQ\s*(\d+)\b/i) || normalized.match(/КВЕСТЫ\s*\[(\d+)\]/i);
  const dMatch = normalized.match(/\bD\s*(\d+)\b/i) || normalized.match(/TODO\s*\[(\d+)\]/i);
  const questsAvailable = qMatch ? Number(qMatch[1]) : null;
  const dailyAvailable = dMatch ? Number(dMatch[1]) : null;

  // Pages can contain multiple "HP/reserve"-like tuples (including deltas after fights).
  // Prefer a tuple that looks like a real HP value: 0 <= hpCurrent <= hpMax.
  const patterns = [
    /\(([-]?\d+)\s*\/\s*(\d+)\)\s*\([^)]+\)\s*\(([-]?\d+)\)/g,
    /\(([-]?\d+)\s*\/\s*(\d+)\)\s*\(([-]?\d+)\)/g,
    /([-]?\d+)\s*\/\s*(\d+)[\s\S]{0,50}?\(([-]?\d+)\)/g,
  ];

  const candidates = [];
  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(normalized)) !== null) {
      const hpCurrent = Number(match[1]);
      const hpMax = Number(match[2]);
      const cooldown = Number(match[3]);
      if (!Number.isFinite(hpCurrent) || !Number.isFinite(hpMax) || !Number.isFinite(cooldown)) {
        continue;
      }
      candidates.push({ hpCurrent, hpMax, cooldown });
    }
  }

  if (candidates.length > 0) {
    // Prefer normal HP (hpCurrent <= hpMax); if only overheal candidates exist (e.g. "(3210/3110) (!) (10)"), allow them too.
    let plausible = candidates
      .filter((c) => c.hpMax > 0 && c.hpCurrent >= 0 && c.hpCurrent <= c.hpMax)
      .sort((a, b) => b.hpCurrent - a.hpCurrent);

    if (plausible.length === 0) {
      plausible = candidates
        .filter((c) => c.hpMax > 0 && c.hpCurrent >= 0 && c.hpCurrent <= c.hpMax * 3)
        .sort((a, b) => b.hpMax - a.hpMax);
    }

    // Deeply negative HP is a real state (critical recovery at Последний дом can show e.g.
    // "(-8774/3120)"), not garbage — only fall back to it once the positive-HP tiers above find
    // nothing, so ordinary pages keep preferring a normal HP reading.
    if (plausible.length === 0) {
      plausible = candidates
        .filter((c) => c.hpMax > 0 && c.hpCurrent < 0)
        .sort((a, b) => b.hpCurrent - a.hpCurrent);
    }

    if (plausible.length === 0) {
      // We found numeric tuples, but none of them looked like a real HP bar.
      // This can happen on death pages or some fight summaries. Let the caller fall back.
      return {
        hpCurrent: null,
        hpMax: null,
        cooldown: null,
        reserveMinutes: null,
        questsAvailable,
        dailyAvailable,
      };
    }

    const chosen = plausible[0];
    const cooldown = Number.isFinite(chosen.cooldown) ? chosen.cooldown : null;
    return {
      hpCurrent: chosen.hpCurrent,
      hpMax: chosen.hpMax,
      cooldown,
      reserveMinutes: cooldown,
      questsAvailable,
       dailyAvailable,
     };
   }

  // Newer pages can omit the reserve/cooldown from the header, but still show HP.
  // In that case return HP-only stats and let the caller fill cooldown via a fallback page (e.g. pers.php).
  const hpOnlyPatterns = [
    /\(([-]?\d+)\s*\/\s*(\d+)\)/g,
    /\b([-]?\d+)\s*\/\s*(\d+)\b/g,
  ];

  const hpCandidates = [];
  for (const pattern of hpOnlyPatterns) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(normalized)) !== null) {
      const hpCurrent = Number(match[1]);
      const hpMax = Number(match[2]);
      if (!Number.isFinite(hpCurrent) || !Number.isFinite(hpMax) || hpMax <= 0) {
        continue;
      }
      hpCandidates.push({ hpCurrent, hpMax });
    }
  }

  if (hpCandidates.length > 0) {
    let plausible = hpCandidates
      .filter((c) => c.hpCurrent >= 0 && c.hpCurrent <= c.hpMax)
      .sort((a, b) => b.hpCurrent - a.hpCurrent);
    if (plausible.length === 0) {
      plausible = hpCandidates
        .filter((c) => c.hpCurrent >= 0 && c.hpCurrent <= c.hpMax * 3)
        .sort((a, b) => b.hpMax - a.hpMax);
    }
    const chosen = plausible[0] || hpCandidates[0];

    return {
      hpCurrent: chosen.hpCurrent,
      hpMax: chosen.hpMax,
      cooldown: null,
      reserveMinutes: null,
      questsAvailable,
      dailyAvailable,
    };
  }

  return {
    hpCurrent: null,
    hpMax: null,
    cooldown: null,
    reserveMinutes: null,
    questsAvailable,
    dailyAvailable,
  };
}

function mergeStatsPreferExisting(base, extra) {
  if (!base) {
    return extra || base;
  }
  if (!extra) {
    const fallbackReserve = typeof base.cooldown === 'number' ? base.cooldown : base.reserveMinutes;
    return {
      ...base,
      reserveMinutes:
        typeof base.reserveMinutes === 'number' && base.reserveMinutes >= 0 ? base.reserveMinutes : fallbackReserve ?? null,
    };
  }

  const merged = { ...base };

  if (merged.hpCurrent === null && typeof extra.hpCurrent === 'number') merged.hpCurrent = extra.hpCurrent;
  if (merged.hpMax === null && typeof extra.hpMax === 'number') merged.hpMax = extra.hpMax;
  if (merged.cooldown === null && typeof extra.cooldown === 'number') merged.cooldown = extra.cooldown;

  const baseReserve = typeof merged.reserveMinutes === 'number' ? merged.reserveMinutes : null;
  const extraReserve = typeof extra.reserveMinutes === 'number' ? extra.reserveMinutes : null;
  const cooldownAsReserve = typeof merged.cooldown === 'number' ? merged.cooldown : null;
  merged.reserveMinutes = baseReserve ?? extraReserve ?? cooldownAsReserve;

  if (merged.questsAvailable === null && typeof extra.questsAvailable === 'number') merged.questsAvailable = extra.questsAvailable;
  if (merged.dailyAvailable === null && typeof extra.dailyAvailable === 'number') merged.dailyAvailable = extra.dailyAvailable;

  return merged;
}

async function openQuestsMenu(page, questCount) {
  // If a previous dispatcher (Demon Lake, Shipwreck, ...) already left us on the quest
  // board, the nav header's numeric "Q13" badge is gone from this page, so a fresh
  // click search fails even though we don't need to click anything. Detect that case
  // first instead of assuming the caller navigated back to location.php beforehand.
  if (/mod=quests\b/i.test(page.url())) {
    return true;
  }

  // IMPORTANT: do NOT fall back to a generic "\u041a\u0432\u0435\u0441\u0442\u044b"/"\u043a\u0432\u0435\u0441\u0442\u044b" text match here.
  // `a:has-text("\u043a\u0432\u0435\u0441\u0442\u044b")` is a case-insensitive SUBSTRING match, and pers.php's
  // account menu has a "\u0414\u043e\u0441\u0442\u0443\u043f\u043d\u044b\u0435 \u043a\u0432\u0435\u0441\u0442\u044b" link that also contains "\u043a\u0432\u0435\u0441\u0442\u044b" \u2014 that
  // link leads to the quest CATALOG (pers.php?mod=questinfo, format "Name [\u0441 N \u0443\u0440.]"),
  // not the active quest board (location.php?mod=quests, format "\u2022 Name [\u0438\u043d\u0444\u043e]").
  // Discovered 14.09.2026 when parseQuestNamesFromQMenuText kept returning [] because
  // openQuestsMenu had silently landed on the catalog page instead.
  const variants = [];
  if (Number.isFinite(questCount) && questCount > 0) {
    variants.push(`Q${questCount}`);
  }
  variants.push('Q');

  let ok = await clickByTexts(page, variants, 'open quests menu');
  if (!ok) {
    // The caller may have left `page` on some intermediate view (e.g. a Podvaly
    // "Осмотреть подвалы" result screen) that doesn't render the top-nav "Q" badge
    // at all. One retry from a known-good page fixes this instead of failing the
    // whole daily-quests cycle. Found 14.09.2026 right after a Podvaly round ran
    // out of monsters to attack mid-cycle.
    await page.goto('http://lbast.ru/location.php', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    await pause(page, 500, 1000);
    ok = await clickByTexts(page, variants, 'open quests menu (retry after reset)');
    if (!ok) {
      return false;
    }
  }

  await pause(page, 800, 1600);
  return true;
}



async function resetToQuestMenu(page, questCount) {
  try {
    await page.goto('http://lbast.ru/location.php', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await pause(page, 800, 1600);
    return await openQuestsMenu(page, questCount);
  } catch (e) {
    console.log('Could not reset to quests menu: ' + e.message);
    return false;
  }
}

async function clickInfoForQuest(page, questName) {
  // IMPORTANT: click the [инфо] link that is on the same line as the quest name.
  // Some pages / encodings may display it as mojibake ("èíôî"), so we support both.
  const links = page.locator(
    'a:has-text("инфо"), a:has-text("Инфо"), a:has-text("èíôî"), a:has-text("Èíôî")'
  );
  const total = await links.count().catch(() => 0);
  const target = String(questName || '').toLowerCase();

  for (let i = 0; i < total; i++) {
    const link = links.nth(i);

    const lineText = await link.evaluate((el) => {
      const normalize = (s) => String(s || '').replace(/\u00A0/g, ' ').replace(/\s+/g, ' ').trim();

      // Walk up until we find an ancestor that contains only one "инфо" link.
      let node = el;
      while (node && node.parentElement) {
        const p = node.parentElement;
        const infos = Array.from(p.querySelectorAll('a')).filter((a) => {
          const t = a.textContent || '';
          return /инфо/i.test(t) || /èíôî/i.test(t);
        });
        if (infos.length <= 1) {
          return normalize(p.textContent);
        }
        node = p;
      }

      // Fallback: take nearby siblings until <br> boundaries.
      let text = '';
      const parent = el.parentNode;
      if (!parent) return '';

      // Collect preceding siblings.
      let cur = el.previousSibling;
      while (cur) {
        if (cur.nodeName === 'BR') break;
        text = (cur.textContent || '') + text;
        cur = cur.previousSibling;
      }

      // Also include some following siblings.
      cur = el.nextSibling;
      while (cur) {
        if (cur.nodeName === 'BR') break;
        text = text + (cur.textContent || '');
        cur = cur.nextSibling;
      }

      return normalize(text);
    }).catch(() => '');

    if (!lineText) continue;

    if (lineText.toLowerCase().includes(target)) {
      try {
        await link.click({ timeout: 8000, noWaitAfter: true });
        // The click normally navigates to questinfo; don't hang if it doesn't.
        await page.waitForURL(/mod=questinfo/i, { timeout: 8000 }).catch(() => {});
        console.log(`OK: ${questName} -> info`);
        await pause(page, 800, 1600);
        return true;
      } catch (e) {
        console.log(`Could not click info for ${questName}: ${e.message}`);
      }
    }
  }

  console.log(`Info link not found next to quest: ${questName}`);
  return false;
}


// Анкета (pers.php) показывает строку "Текущее задание: <текст> - отказаться", и отказ ведёт
// на /pers.php?r=NNNN&mod=dropquest. Разобрано вживую 17.09.2026 после жалобы Паши: игра
// пишет "у вас уже есть задание", и новое задание не берётся, пока старое висит.
// ВАЖНО: r= меняется при каждой загрузке страницы, поэтому href НЕ хардкодим - берём ссылку
// на анкету с текущей страницы и кликаем по тексту "отказаться".
function hasAlreadyHasQuestText(text) {
  return /у\s*вас\s*уже\s*есть\s*задание/i.test(String(text || ''));
}

async function readCurrentAssignment(page) {
  const persHref = await page
    .$eval('a[href^="pers.php"]', (a) => a.getAttribute('href'))
    .catch(() => null);
  if (!persHref) return null;

  await page.goto(`http://lbast.ru/${persHref.replace(/^\//, '')}`, {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  await pause(page, 400, 800);

  const text = await getBodyText(page);
  const m = text.match(/Текущее задание:\s*([\s\S]*?)\s*-\s*отказаться/i);
  return { text, assignment: m ? m[1].trim() : null };
}

// Отказ от текущего задания через анкету. Возвращает true, только если задание реально было
// и ссылка отказа нажалась. Это НЕОБРАТИМО - прогресс по заданию теряется, поэтому вызывается
// лишь тогда, когда игра сама сказала "у вас уже есть задание" и иначе квест не сдвинуть.
async function dropCurrentAssignment(page, reason = '') {
  const info = await readCurrentAssignment(page);
  if (!info) {
    console.log('Отказ от задания: не нашёл ссылку на анкету (pers.php) на текущей странице.');
    return false;
  }
  if (!info.assignment) {
    console.log('Отказ от задания: в анкете нет активного задания - отказываться не от чего.');
    await clickByTexts(page, ['В игру', 'в игру'], 'В игру (анкета)');
    return false;
  }

  console.log(`Отказ от задания (${reason}): "${snapshotText(info.assignment, 200)}"`);
  // 17.09.2026, Паша письмом: ты видимо когда от задания отказывался отказался и от статуи,
  // кнопка идентична, но другая строка. Проверено живьём: в анкете есть строка
  // Статуя славы: еще N мин Отказаться со ссылкой mod=statuenull, рядом с Текущее задание.
  // Клик по ТЕКСТУ отказаться - лотерея между ними, и он снял бафф статуи: максимум HP упал
  // 380 -> 340, а я успел заподозрить чужой вход в аккаунт. Целимся по href, а не по надписи.
  const dropHref = await page
    .evaluate(() => {
      const a = Array.from(document.querySelectorAll("a")).find((x) => (x.getAttribute("href") || "").includes("mod=dropquest"));
      return a ? a.getAttribute("href") : null;
    })
    .catch(() => null);

  if (!dropHref) {
    console.log("Отказ от задания: ссылка mod=dropquest не найдена - НИЧЕГО не жму по тексту, чтобы не снять бафф статуи (mod=statuenull).");
    return false;
  }

  await page.goto("http://lbast.ru/" + (dropHref[0] === "/" ? dropHref.slice(1) : dropHref), { waitUntil: "domcontentloaded", timeout: 60000 });
  await pause(page, 800, 1500);
  await clickByTexts(page, ['В игру', 'в игру'], 'В игру (после отказа)');
  await pause(page, 600, 1200);
  console.log('Отказ от задания: выполнено, задание освободилось.');
  return true;
}

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
  if (tavernDayKey !== today) {
    tavernDayKey = today;
    tavernDoneToday = false;
    tavernTakenToday = false;
    tavernFailStreak = 0;
    tavernSuppressedUntil = 0;
    tavernFocusStartedAt = 0;
  }
  if (tavernDoneToday) {
    return false;
  }

  // We are entering the tavern quest flow from the Q menu; treat it as exclusive/in-progress.
  tavernTakenToday = true;
  if (!tavernFocusStartedAt) tavernFocusStartedAt = Date.now();
  let didAnything = false;

  // Always try to take the quest first (as user described). If the take flow isn't available
  // (quest already taken), we proceed to bot steps / turn-in.
  if (!await resetToQuestMenu(page, questCount)) {
    return false;
  }

  const taken = await ensureTavernQuestTaken(page);
  if (taken) {
    tavernTakenToday = true;
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
      tavernDoneToday = true;
      tavernTakenToday = false;
      tavernSuppressedUntil = 0;
      tavernFocusStartedAt = 0;
      persistDailyQuestState();
      return true;
    }
  }

  return didAnything;
}

// 17.09.2026, живой инцидент: внутри ОДНОГО вызова runDailyQuests очередь квестов идёт без
// единой проверки HP - драйвер смотрит на него только после всей очереди. Персонаж умер на
// гаунтлете асассинов, и следующие несколько минут драйвер водил труп по локациям и перебирал
// шаги Харчевни, пока игра отвечала "Восстановите здоровье". Навигировать на location.php перед
// каждым шагом нельзя (квесты стартуют с открытого Q-меню, это сломает им контекст), поэтому
// читаем HP из текста страницы, на которой шаг и так закончился, и запоминаем флагом: следующий
// шаг очереди по нему просто пропускается, и очередь обрывается сама.
let characterDownDetected = false;

// Последнее ДОСТОВЕРНО прочитанное HP. Нужно потому, что боевые экраны ("В бой!") и часть
// квестовых сцен шапку со статами не рендерят, и parseStats там возвращает null. Гейты,
// написанные как `typeof hp === 'number' && hp < max * 0.7`, в этом случае молча пропускают
// бой: все условия ложны. Именно так 17.09.2026 персонаж ушёл в бой с боевым псом на 63% и
// в итоге погиб - в логе нет строки "останавливаюсь перед боем", сразу "бой с боевым псом".
let lastKnownHp = { current: null, max: null, at: 0 };

// Доля HP для гейта перед боем: берём свежее чтение, если оно есть, иначе последнее
// достоверное. null означает "узнать не удалось" - вызывающий ОБЯЗАН считать это запретом боя.
function hpFractionForGate(preStats) {
  const current = typeof preStats?.hpCurrent === 'number' ? preStats.hpCurrent : lastKnownHp.current;
  const max = typeof preStats?.hpMax === 'number' ? preStats.hpMax : lastKnownHp.max;
  if (typeof current !== 'number' || typeof max !== 'number' || max <= 0) return null;
  return current / max;
}

function noteHpFromPageText(text, label) {
  const stats = parseStats(text);
  if (typeof stats.hpCurrent !== 'number') return characterDownDetected;
  lastKnownHp = { current: stats.hpCurrent, max: stats.hpMax, at: Date.now() };
  const wasDown = characterDownDetected;
  characterDownDetected = stats.hpCurrent <= 0;
  if (characterDownDetected && !wasDown) {
    console.log(`ВНИМАНИЕ: после "${label}" HP=${stats.hpCurrent}/${stats.hpMax} - персонаж выбыл из строя, обрываю очередь квестов.`);
  }
  return characterDownDetected;
}

// Общий порог HP для ЛЮБОГО квестового боя. 0.7, а не 0.4: 15.09.2026 один охранник банкира
// снял ~225 HP за бой даже с эликсиром, 17.09.2026 персонаж погиб на Харчевне/Демоне озера,
// зайдя в бой без всякой проверки. Дешевле пропустить квест до следующего цикла, чем лечиться.
const QUEST_FIGHT_HP_FLOOR = 0.7;

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
  if (waitForRecovery && frac !== null && frac < floor && lastKnownHp.max > 0) {
    const need = Math.ceil(lastKnownHp.max * floor);
    console.log(`${label}: HP ${Math.round(frac * 100)}% < ${Math.round(floor * 100)}% -> жду восстановления до ${need}/${lastKnownHp.max}, квест не бросаю.`);
    const deadline = Date.now() + maxWaitMs;
    while (Date.now() < deadline) {
      await fixedPause(page, 60_000);
      const hpNow = await readHpFromLocationInNewTab(page);
      if (typeof hpNow !== 'number') continue;
      lastKnownHp = { current: hpNow, max: lastKnownHp.max, at: Date.now() };
      console.log(`${label}: HP ${hpNow}/${lastKnownHp.max} (нужно ${need})`);
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
  if (characterDownDetected) {
    console.log(`Quest step skip (персонаж выбыл из строя): ${label}`);
    return false;
  }
  if (await lowHpBeforeFightQuest(page, label)) return false;
  try {
    const ok = await fn();
    if (ok) {
      if (label === 'Харчевня' && !tavernDoneToday) {
        console.log(`Quest step progress: ${label} (not turned in yet)`);
      } else if (label === 'Штольни' && !shtolniDoneToday) {
        console.log(`Quest step progress: ${label} (not finished yet)`);
      } else {
        console.log(`Quest step OK: ${label}`);
      }
      if (label === 'Харчевня') tavernFailStreak = 0;
      if (label === 'Штольни') shtolniFailStreak = 0;
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
      tavernFailStreak++;
      if (tavernFailStreak >= 2) {
        tavernSuppressedUntil = Date.now() + EXCLUSIVE_QUEST_ERROR_BACKOFF_MS;
        console.log('Tavern quest: repeated errors -> backoff 15 min and continue other actions');
      } else {
        console.log(`Tavern quest: error streak=${tavernFailStreak}`);
      }
    }
    if (label === 'Штольни') {
      shtolniFailStreak++;
      if (shtolniFailStreak >= 2) {
        shtolniSuppressedUntil = Date.now() + EXCLUSIVE_QUEST_ERROR_BACKOFF_MS;
        console.log('Shtolni quest: repeated errors -> backoff 15 min and continue other actions');
      } else {
        console.log(`Shtolni quest: error streak=${shtolniFailStreak}`);
      }
    }

    return false;
  }
}

function parseQuestNamesFromQMenuText(text) {
  const normalized = String(text || '')
    .replace(/\u00A0/g, ' ')
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .trim();

  const lines = normalized.split('\n').map((l) => l.trim()).filter(Boolean);
  const names = [];

  for (const line of lines) {
    // Example: "• Харчевня [инфо]"
    const match = line.match(/^[•*-]\s*(.+?)\s*\[\s*инфо\s*\]\s*$/i);
    if (match) {
      names.push(String(match[1] || '').trim());
    }
  }

  return names;
}

function normalizeQuestName(name) {
  return String(name || '')
    .replace(/\u00A0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function isQuestInMenu(questNames, targetQuestName) {
  const t = normalizeQuestName(targetQuestName);
  return questNames.some((q) => normalizeQuestName(q) === t);
}

async function clickLinkNextToQuest(page, questName, linkTexts, okLabel) {
  const target = String(questName || '').toLowerCase();

  for (const linkText of linkTexts) {
    const links = page.locator(`a:has-text("${linkText}")`);
    const total = await links.count().catch(() => 0);

    for (let i = 0; i < total; i++) {
      const link = links.nth(i);

      const lineText = await link.evaluate((el) => {
        const normalize = (s) => String(s || '').replace(/\u00A0/g, ' ').replace(/\s+/g, ' ').trim();

        // Similar to clickInfoForQuest: use nearby siblings up to <br> boundaries.
        let text = '';
        const parent = el.parentNode;
        if (!parent) return '';

        let cur = el.previousSibling;
        while (cur) {
          if (cur.nodeName === 'BR') break;
          text = (cur.textContent || '') + text;
          cur = cur.previousSibling;
        }

        cur = el.nextSibling;
        while (cur) {
          if (cur.nodeName === 'BR') break;
          text = text + (cur.textContent || '');
          cur = cur.nextSibling;
        }

        return normalize(text);
      }).catch(() => '');

      if (!lineText) continue;
      if (!lineText.toLowerCase().includes(target)) continue;

      try {
        await link.click({ timeout: 8000, noWaitAfter: true });
        console.log(`OK: ${okLabel} -> ${linkText}`);
        await pause(page, 800, 1600);
        return true;
      } catch (e) {
        console.log(`Could not click ${okLabel} -> ${linkText}: ${e.message}`);
      }
    }
  }

  return false;
}

async function runDailyQuests(page, stats) {
  const questCount = stats?.questsAvailable;
  console.log(`Daily quests detected: Q=${questCount}`);

  // AI__ driver.js calls runDailyQuests directly (not doScenario), so lastCycleStats — read by
  // progressShtolniQuest's HP/reserve gate — would otherwise stay null forever and the gate would
  // always fail with "hp=n/a". Set it here from the stats we were already given.
  lastCycleStats = stats;

  // Сброс флага "персонаж выбыл из строя" по СВЕЖИМ статам начала цикла (драйвер читает их сам
  // и передаёт сюда) - иначе флаг залипнет навсегда: при взведённом флаге runQuestStepSafe и
  // runNonQQuestSafe выходят раньше, чем успевают перечитать HP, и сами его не снимут.
  if (typeof stats?.hpCurrent === 'number') {
    characterDownDetected = stats.hpCurrent <= 0;
  }

  checkExclusiveQuestTimeouts();

  const reserveMinutes = typeof stats?.reserveMinutes === 'number' ? stats.reserveMinutes : stats?.cooldown;

  const opened = await openQuestsMenu(page, questCount);
  if (!opened) {
    console.log('Could not open quests menu (Q is present but no clickable entry found).');
    return { didAnything: false, hasAnyTargetQuest: false };
  }

  let didAnything = false;
  const menuText = await getBodyText(page);
  let listedQuests = parseQuestNamesFromQMenuText(menuText);
  console.log('Q menu quest names:', JSON.stringify(listedQuests));
  lastListedQuestNames = listedQuests; // кэш для решения "можно ли фармить" в следующем цикле
  if (listedQuests.length === 0) {
    appendDebugSnapshot('Q menu parse returned empty list', { label: 'q_menu_empty_parse', url: page.url(), text: menuText });
  }

  // Exclusive quests: while one of these is in progress, do not start any other Q-quests.
  const exclusiveInProgress = [];
  const now = Date.now();
  const tavernSuppressed = now < tavernSuppressedUntil;
  const shtolniSuppressed = now < shtolniSuppressedUntil;
  if (tavernTakenToday && !tavernDoneToday && !tavernSuppressed) exclusiveInProgress.push('Харчевня');
  if (shtolniTakenToday && !shtolniDoneToday && !shtolniSuppressed) exclusiveInProgress.push('Штольни');
  // Рыбного ресторана нет в TARGET_Q_QUESTS, поэтому пока он в фокусе, ни один Q-квест из
  // списка не стартует - именно этого и не хватало: драйвер уходил с недоделанного маршрута.
  if (fishRestaurantFocusStartedAt && !fishRestaurantDoneToday && now >= fishRestaurantSuppressedUntil) {
    exclusiveInProgress.push('Рыбный ресторан');
  }
  const isQQuestAllowed = (questName) => {
    if (exclusiveInProgress.length === 0) return true;
    return exclusiveInProgress.includes(questName);
  };

  const TARGET_Q_QUESTS = [
    'Харчевня',
    'Дерево жизни',
    'Штольни',
    'Камни Драбаса',
    'Кузница Рума',
    'Еда для рыбака',
    'Грабим корованы',
  ];

  const hasAnyTargetQuest = TARGET_Q_QUESTS.some((q) => isQuestInMenu(listedQuests, q));

  if (!tavernSuppressed && isQQuestAllowed('Харчевня') && isQuestInMenu(listedQuests, 'Харчевня') && !(shtolniTakenToday && !shtolniDoneToday)) {
    if (await runQuestStepSafe(page, 'Харчевня', () => progressTavernQuest(page, { initialReserveMinutes: stats?.cooldown, questCount }))) {
      didAnything = true;
    }
    await resetToQuestMenu(page, questCount);
    listedQuests = parseQuestNamesFromQMenuText(await getBodyText(page));

    // If we started / are in progress with an exclusive quest, stop here.
    if (tavernTakenToday && !tavernDoneToday) {
      return { didAnything, hasAnyTargetQuest };
    }
  }

  if (isQQuestAllowed('Дерево жизни') && canRunLifeTreeNow()) {
    if (await runQuestStepSafe(page, 'Дерево жизни', () => progressLifeTreeQuest(page, { questCount }))) {
      didAnything = true;
    }
    await resetToQuestMenu(page, questCount);
    listedQuests = parseQuestNamesFromQMenuText(await getBodyText(page));
  }

  if (!shtolniSuppressed && isQQuestAllowed('Штольни') && isQuestInMenu(listedQuests, 'Штольни') && !(tavernTakenToday && !tavernDoneToday)) {
    // 14.09.2026 (Паша): "по резерву отмени правило, просто жди сколько нужно" — резерв
    // больше не пропускает попытку здесь; progressShtolniQuest сам активно ждёт нужный
    // резерв (waitForReserveAtLeast) после проверки HP-гейта.
    if (await runQuestStepSafe(page, 'Штольни', () => progressShtolniQuest(page))) {
      didAnything = true;
    }
    await resetToQuestMenu(page, questCount);
    listedQuests = parseQuestNamesFromQMenuText(await getBodyText(page));

    // If we started / are in progress with an exclusive quest, stop here.
    if (shtolniTakenToday && !shtolniDoneToday) {
      return { didAnything, hasAnyTargetQuest };
    }
  }

  if (isQQuestAllowed('Камни Драбаса') && isQuestInMenu(listedQuests, 'Камни Драбаса')) {
    if (await runQuestStepSafe(page, 'Камни Драбаса', () => runDrabasQuest(page))) {
      didAnything = true;
    }
    await resetToQuestMenu(page, questCount);
    listedQuests = parseQuestNamesFromQMenuText(await getBodyText(page));
  }

  if (isQQuestAllowed('Кузница Рума') && isQuestInMenu(listedQuests, 'Кузница Рума')) {
    if (await runQuestStepSafe(page, 'Кузница Рума', () => progressRumaForgeQuest(page, { questCount }))) {
      didAnything = true;
    }
    await resetToQuestMenu(page, questCount);
    listedQuests = parseQuestNamesFromQMenuText(await getBodyText(page));
  }

  if (isQQuestAllowed('Еда для рыбака') && isQuestInMenu(listedQuests, 'Еда для рыбака')) {
    if (typeof reserveMinutes !== 'number' || reserveMinutes < 10) {
      console.log(`Quest step skip: Еда для рыбака (need >=10 reserve minutes, have=${reserveMinutes ?? 'n/a'})`);
    } else {
      if (await runQuestStepSafe(page, 'Еда для рыбака', () => progressFisherFoodQuest(page, { questCount }))) {
        didAnything = true;
      }
    }
    await resetToQuestMenu(page, questCount);
    listedQuests = parseQuestNamesFromQMenuText(await getBodyText(page));
  }

  if (isQQuestAllowed('Грабим корованы') && isQuestInMenu(listedQuests, 'Грабим корованы')) {
    if (typeof reserveMinutes !== 'number' || reserveMinutes < 10) {
      console.log(`Quest step skip: Грабим корованы (need >=10 reserve minutes, have=${reserveMinutes ?? 'n/a'})`);
    } else {
      if (await runQuestStepSafe(page, 'Грабим корованы', () => progressCaravanRobberyQuest(page))) {
        didAnything = true;
      }
    }
    await resetToQuestMenu(page, questCount);
    listedQuests = parseQuestNamesFromQMenuText(await getBodyText(page));
  }

  try {
    await page.goto('http://lbast.ru/location.php', {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });
  } catch (e) {
    console.log('Could not return to location.php after quests menu.');
  }

  await pause(page, 800, 1600);
  return { didAnything, hasAnyTargetQuest };
}

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

function canRunLifeTreeNow() {
  const key = getDayKeyNow();
  if (lifeTreeDayKey !== key) {
    lifeTreeDayKey = key;
    lifeTreeRunsToday = 0;
  }

  if (lifeTreeRunsToday >= LIFE_TREE_DAILY_LIMIT) {
    return false;
  }

  if (!lastLifeTreeRunAt) return true;
  return Date.now() - lastLifeTreeRunAt >= LIFE_TREE_INTERVAL_MS;
}

function syncFishEyeDayState() {
  const key = getDayKeyNow();
  if (fishEyeDayKey !== key) {
    fishEyeDayKey = key;
    fishEyeFightsToday = 0;
    fishEyeRewardClaimedToday = false;
  }
}

function syncDrabasDayState() {
  const key = getDayKeyNow();
  if (drabasDayKey !== key) {
    drabasDayKey = key;
    drabasRunsToday = 0;
  }
}

function canRunDrabasNow() {
  syncDrabasDayState();

  if (drabasRunsToday >= DRABAS_DAILY_LIMIT) {
    return false;
  }

  if (!lastDrabasRunAt) return true;
  return Date.now() - lastDrabasRunAt >= DRABAS_INTERVAL_MS;
}

function syncFishingDayState() {
  const key = getDayKeyNow();
  if (fishingDayKey !== key) {
    fishingDayKey = key;
    fishingCatchesToday = 0;
  }
}

function canRunFishingNow() {
  syncFishingDayState();
  if (fishingCatchesToday >= FISHING_DAILY_CATCH_LIMIT) return false;
  if (!lastFishingAttemptAt) return true;
  return Date.now() - lastFishingAttemptAt >= FISHING_ATTEMPT_COOLDOWN_MS;
}

function canRunFishEyeFightNow() {
  syncFishEyeDayState();

  if (fishEyeFightsToday >= FISH_EYE_DAILY_FIGHT_LIMIT) {
    return false;
  }

  if (!lastFishEyeRunAt) return true;
  return Date.now() - lastFishEyeRunAt >= FISH_EYE_INTERVAL_MS;
}

function canRunFishEyeRewardNow() {
  syncFishEyeDayState();
  return fishEyeFightsToday >= FISH_EYE_DAILY_FIGHT_LIMIT && !fishEyeRewardClaimedToday;
}

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

  lastLifeTreeRunAt = Date.now();
  const key = getDayKeyNow();
  if (lifeTreeDayKey !== key) {
    lifeTreeDayKey = key;
    lifeTreeRunsToday = 0;
  }
  lifeTreeRunsToday += 1;
  persistDailyQuestState();

  console.log(`Life Tree quest: done (${lifeTreeRunsToday}/${LIFE_TREE_DAILY_LIMIT} today)`);
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
    lastFishEyeRunAt = Date.now() + waitMinutes * 60 * 1000 - FISH_EYE_INTERVAL_MS;
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
    fishEyeFightsToday = FISH_EYE_DAILY_FIGHT_LIMIT;
    fishEyeRewardClaimedToday = true;
    lastFishEyeRunAt = Date.now();
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
    lastFishEyeRunAt = Date.now() + 15 * 60 * 1000 - FISH_EYE_INTERVAL_MS;
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
    lastFishEyeRunAt = Date.now();
    syncFishEyeDayState();
    fishEyeFightsToday += 1;
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

  lastFishEyeRunAt = Date.now();
  syncFishEyeDayState();
  fishEyeFightsToday += 1;
  persistDailyQuestState();

  console.log(`Fish Eye quest: fight done (${fishEyeFightsToday}/${FISH_EYE_DAILY_FIGHT_LIMIT} today)`);
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
  fishEyeRewardClaimedToday = true;
  persistDailyQuestState();
  console.log('Fish Eye quest: reward claimed (assumed)');
  return true;
}

async function runNonQQuestSafe(page, label, fn) {
  if (characterDownDetected) {
    console.log(`${label}: пропускаю, персонаж выбыл из строя.`);
    return false;
  }
  if (await lowHpBeforeFightQuest(page, label)) return false;
  try {
    const result = await fn();
    noteHpFromPageText(await getBodyText(page), label);
    return result;
  } catch (e) {
    console.log(`${label} error: ${e.message}`);
    noteHpFromPageText(e.message, label);
    await recoverToCity(page, `${label}: ${e.message}`);
    noteHpFromPageText(await getBodyText(page), label);
    return null; // indicates recovery happened
  }
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

  lastDrabasRunAt = Date.now();
  syncDrabasDayState();
  drabasRunsToday += 1;
  persistDailyQuestState();
  console.log(`Drabas quest: done (${drabasRunsToday}/${DRABAS_DAILY_LIMIT} today)`);

  if (await existsAnyText(page, ['\u0412 \u0438\u0433\u0440\u0443', '\u0432 \u0438\u0433\u0440\u0443'])) {
    await clickByTexts(page, ['\u0412 \u0438\u0433\u0440\u0443', '\u0432 \u0438\u0433\u0440\u0443'], '\u0412 \u0438\u0433\u0440\u0443 (after Drabas)');
    await pause(page, 800, 1600);
  }

  return true;
}

async function progressRumaForgeQuest(page, { questCount } = {}) {
  const QUEST = '\u041a\u0443\u0437\u043d\u0438\u0446\u0430 \u0420\u0443\u043c\u0430';

  const today = getDayKeyNow();
  if (rumaForgeDayKey !== today) {
    rumaForgeDayKey = today;
    rumaForgeDoneToday = false;
  }
  if (rumaForgeDoneToday) {
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

  rumaForgeDoneToday = true;
  persistDailyQuestState();
  console.log('Ruma forge quest: done today');
  return true;
}

async function progressFisherFoodQuest(page, { questCount } = {}) {
  const QUEST = '\u0415\u0434\u0430 \u0434\u043b\u044f \u0440\u044b\u0431\u0430\u043a\u0430';

  const today = getDayKeyNow();
  if (fisherFoodDayKey !== today) {
    fisherFoodDayKey = today;
    fisherFoodDoneToday = false;
  }
  if (fisherFoodDoneToday) {
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

  fisherFoodDoneToday = true;
  persistDailyQuestState();
  console.log('Fisher Food quest: done today');
  return true;
}

async function progressCaravanRobberyQuest(page) {
  const QUEST = '\u0413\u0440\u0430\u0431\u0438\u043c \u043a\u043e\u0440\u043e\u0432\u0430\u043d\u044b';

  const today = getDayKeyNow();
  if (caravanRobberyDayKey !== today) {
    caravanRobberyDayKey = today;
    caravanRobberyDoneToday = false;
  }
  if (caravanRobberyDoneToday) {
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

  caravanRobberyDoneToday = true;
  persistDailyQuestState();
  console.log('Caravan Robbery quest: done today');
  return true;
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
      if (typeof stats.hpMax === 'number') lastKnownHp = { current: stats.hpCurrent, max: stats.hpMax, at: Date.now() };
      return stats.hpCurrent;
    }
    await temp.goto('http://lbast.ru/pers.php', { waitUntil: 'domcontentloaded', timeout: 60000 });
    const m = (await temp.locator('body').innerText().catch(() => '')).match(/\((-?\d+)\s*\/\s*(\d+)\)/);
    if (!m) return null;
    lastKnownHp = { current: Number(m[1]), max: Number(m[2]), at: Date.now() };
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
  if (shtolniDayKey !== today) {
    shtolniDayKey = today;
    shtolniDoneToday = false;
    shtolniTakenToday = false;
    shtolniFailStreak = 0;
    shtolniSuppressedUntil = 0;
    shtolniNoProgressStreak = 0;
    shtolniLastStage = '';
    shtolniFocusStartedAt = 0;
  }
  if (shtolniDoneToday) {
    return false;
  }

  // Global safety gates: user-requested constraints for this quest.
  // Enforced both when starting and when continuing an in-progress quest.
  // AI__ (14.09.2026): порог HP задан не абсолютным числом (у AI__ max HP растёт по мере
  // прокачки), а долей от максимума — SHTOLNI_MIN_HP_FRACTION = 0.9 (90% от hpMax).
  const stats = lastCycleStats;
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
  shtolniTakenToday = true;
  if (!shtolniFocusStartedAt) shtolniFocusStartedAt = Date.now();

  // 14.09.2026 (Паша): выпить "Праздничный эль" ЗАРАНЕЕ, ещё на экране инфо-квеста, пока мы
  // не зашли в саму пещеру — раньше это делалось прямо перед первым боем, что означало
  // навигацию в inv.php посреди "сцены" подземелья и, видимо, ломало распознавание предмета.
  await tryDrinkFestiveAle(page);

  const textBefore = await getBodyText(page);
  if (/Вы еще не выполнили другое задание/i.test(textBefore)) {
    console.log('Shtolni quest is blocked by another active quest -> backoff and do not mark as in-progress');
    // Do not keep the exclusive lock for a quest that cannot proceed.
    shtolniTakenToday = false;
    shtolniSuppressedUntil = Date.now() + EXCLUSIVE_QUEST_CONFLICT_BACKOFF_MS;
    shtolniFocusStartedAt = 0;
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
        shtolniNoProgressStreak = 0;
        shtolniLastStage = stage;
      } else if (backOk) {
        if (shtolniLastStage === stage) {
          shtolniNoProgressStreak += 1;
        } else {
          shtolniNoProgressStreak = 1;
        }
        shtolniLastStage = stage;

        // Back off only after many consecutive "only exit" cycles.
        if (shtolniNoProgressStreak >= 6) {
          shtolniSuppressedUntil = Date.now() + EXCLUSIVE_QUEST_ERROR_BACKOFF_MS;
          console.log(`Shtolni quest: no progress streak=${shtolniNoProgressStreak} -> backoff 15 min and continue other actions`);
          appendDebugSnapshot('Shtolni stuck at intro (backoff)', { label: 'shtolni_intro', url: page.url(), text: await getBodyText(page) });
        }
      }
    } else if (stage === 'advanced') {
      shtolniNoProgressStreak = 0;
      shtolniLastStage = stage;
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
        : typeof lastCycleStats?.hpMax === 'number'
        ? lastCycleStats.hpMax
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
    shtolniDoneToday = true;
    shtolniTakenToday = false;
    shtolniSuppressedUntil = 0;
    shtolniFocusStartedAt = 0;
    persistDailyQuestState();
    return true;
  }

  return progressed;
}

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

// Below this HP a simple Chaos Fist heal is not enough; go recover at Форпост/Последний дом instead.
const LAST_HOUSE_HP_THRESHOLD = -1500;

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

function detectPvpFromText(text) {
  if (!ENABLE_PVP_ALERTS) {
    return null;
  }

  const normalized = String(text || '')
    .replace(/\u00A0/g, ' ')
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .trim();

  if (!normalized) {
    return null;
  }

  if (!/\bvs\.?/i.test(normalized)) {
    return null;
  }

  const lines = normalized.split('\n').map((line) => line.trim()).filter(Boolean);
  const vsLines = lines.filter((line) => /\bvs\.?/i.test(line) && SELF_NICK_RE.test(line));

  for (const line of vsLines) {
    const vsRegex = /([A-Za-z][A-Za-z0-9_]{2,30})(?:\[(\d+)\])?\s*vs\.?\s*([A-Za-z][A-Za-z0-9_]{2,30})(?:\[(\d+)\])?/gi;
    let match;

    while ((match = vsRegex.exec(line)) !== null) {
      const leftNick = String(match[1] || '').trim();
      const rightNick = String(match[3] || '').trim();
      if (!leftNick || !rightNick) {
        continue;
      }

      let enemyNick = rightNick;
      let enemyLevel = Number(match[4]);

      if (SELF_NICK_RE.test(rightNick) && !SELF_NICK_RE.test(leftNick)) {
        enemyNick = leftNick;
        enemyLevel = Number(match[2]);
      }

      if (SELF_NICK_RE.test(enemyNick)) {
        continue;
      }

      const parsedLevel = Number.isFinite(enemyLevel) ? enemyLevel : null;

      return {
        enemyNick,
        enemyLevel: parsedLevel,
        fragment: normalized.slice(0, 1200),
      };
    }
  }

  return null;
}

async function notifyIfPvpDetected(page, sourceLabel) {
  const text = await getBodyText(page);
  const pvp = detectPvpFromText(text);

  if (!pvp || !pvp.enemyNick || String(pvp.enemyNick).toLowerCase() === 'unknown') {
    return false;
  }

  emitPvpAlert({
    source: sourceLabel,
    enemyNick: pvp.enemyNick,
    enemyLevel: pvp.enemyLevel,
    fragment: pvp.fragment,
  });

  console.log(`PVP обнаружен (${sourceLabel}): ${pvp.enemyNick}`);
  return true;
}

const ATTACK_LINE_RE = new RegExp(
  `\\b([A-Za-z_][A-Za-z0-9_]*)\\b[^\\n]{0,80}?использует\\s+грамоту[\\s\\S]{0,40}?на\\s+${SELF_NICK}`,
  'i',
);
const ATTACK_BUTTON_TEXTS = ['В бой!', 'в бой!', 'В бой', 'в бой'];

function detectIncomingAttack(text) {
  if (!text) {
    return null;
  }

  const match = ATTACK_LINE_RE.exec(text);
  if (!match) {
    return null;
  }

  const attacker = String(match[1] || '').trim();
  if (!attacker) {
    return null;
  }

  if (SELF_NICK_RE.test(attacker)) {
    return null;
  }

  return attacker;
}

// Fight screens show "VS.\n<Opponent> [level] (hp/max)..." right after the header. Player
// nicknames on lbast.ru are Latin-only (see ATTACK_LINE_RE above); farm NPCs (Блейк, goblins)
// have Cyrillic names. Used to tell a genuine incoming PvP attack apart from our own farm fight
// surfacing the same round-based block/hit zone-select UI.
const VS_OPPONENT_RE = /VS\.\s*\r?\n\s*([A-Za-zА-Яа-яЁё_]+)/i;
const LATIN_NICK_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

function getFightOpponentName(text) {
  const match = VS_OPPONENT_RE.exec(String(text || ''));
  return match ? match[1] : null;
}

function emitAttackAlert(payload) {
  try {
    const json = JSON.stringify(payload || {});
    const encoded = Buffer.from(json, 'utf8').toString('base64');
    console.log(`ATTACK_ALERT:${encoded}`);
  } catch (e) {
    console.log(`Не удалось сериализовать attack alert: ${e.message}`);
  }
}

function isBattleScreenText(text) {
  return /Ударить/i.test(text) || /Бой завершен!/i.test(text);
}

const ATTACK_SCREENSHOT_DIR = path.join(__dirname, 'logs');
let lastAttackClickAt = 0;
let attackAlertCooldownUntil = 0;

function safeFilenamePart(value) {
  const raw = String(value || '').trim();
  if (!raw) return 'unknown';
  return raw
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 80);
}

function formatTimestampForFilename(date) {
  const d = date instanceof Date ? date : new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
}

async function takeAttackScreenshot(page, attackerNick) {
  try {
    fs.mkdirSync(ATTACK_SCREENSHOT_DIR, { recursive: true });
    const ts = formatTimestampForFilename(new Date());
    const nick = safeFilenamePart(attackerNick);
    const filePath = path.join(ATTACK_SCREENSHOT_DIR, `${ts}__attack__${nick}.png`);
    await page.screenshot({ path: filePath, fullPage: true });
    return filePath;
  } catch (e) {
    console.log(`Не удалось сделать скриншот нападения: ${e.message}`);
    return null;
  }
}

async function emitAttackAlertWithScreenshot(page, attackerNick, text, meta = {}) {
  const now = Date.now();
  if (now < attackAlertCooldownUntil) return;

  const screenshotPath = await takeAttackScreenshot(page, attackerNick);

  emitAttackAlert({
    attackerNick,
    screenshotPath,
    occurredAt: new Date().toISOString(),
    fragment: String(text || '').slice(0, 1200),
    firstLogPage: String(text || '').slice(0, 2000),
    ...meta,
  });

  attackAlertCooldownUntil = now + 60 * 1000;
}

function randInt(min, max) {
  const a = Math.ceil(min);
  const b = Math.floor(max);
  return Math.floor(Math.random() * (b - a + 1)) + a;
}

async function clickRandomActionByRegex(page, regex, stepName) {
  // We cannot rely on hasText for <input> controls, so collect candidates and match by
  // innerText/textContent/value attributes.
  const locator = page.locator(
    'a,button,input,select,option,label,[role="button"],[role="link"],[onclick]'
  );
  const handles = await locator.elementHandles().catch(() => []);
  if (!handles || handles.length === 0) return false;

  const matches = [];
  for (const h of handles) {
    try {
      const info = await h.evaluate((el) => {
        const tag = String(el?.tagName || '').toUpperCase();
        const isDisabled = !!el.disabled || el.getAttribute('aria-disabled') === 'true';
        const style = window.getComputedStyle(el);
        const visible =
          style &&
          style.visibility !== 'hidden' &&
          style.display !== 'none' &&
          style.opacity !== '0' &&
          el.getClientRects().length > 0;
        if (tag === 'INPUT') {
          const t = String(el.value || el.getAttribute('value') || '');
          return { tag, text: t, visible, isDisabled };
        }
        if (tag === 'OPTION') {
          const t = String(el.textContent || '');
          return { tag, text: t, visible, isDisabled };
        }
        const t = String(el.innerText || el.textContent || '');
        return { tag, text: t, visible, isDisabled };
      });
      const normalized = String(info?.text || '').replace(/\s+/g, ' ').trim();
      if (!normalized) continue;
      if (!info?.visible) continue;
      if (info?.isDisabled) continue;
      if (regex.test(normalized)) {
        matches.push({ h, label: normalized.slice(0, 80), tag: info?.tag || '' });
      }
    } catch (e) {
      // ignore
    }
  }

  if (matches.length === 0) return false;

  const idx = randInt(0, matches.length - 1);
  const chosen = matches[idx];
  try {
    if (chosen.tag === 'SELECT') {
      // .click() only opens the dropdown without changing the value — must evaluate to set selectedIndex.
      const optText = await chosen.h.evaluate((el) => {
        const opts = Array.from(el.options || []);
        if (!opts.length) return null;
        const i = Math.floor(Math.random() * opts.length);
        el.selectedIndex = i;
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return (opts[i].textContent || opts[i].value || '').trim();
      });
      if (optText == null) return false;
      console.log(`OK: ${stepName} -> SELECT option "${optText}" (random ${idx + 1}/${matches.length})`);
      return true;
    }
    await chosen.h.click({ timeout: 3000 });
    console.log(`OK: ${stepName} -> ${chosen.label} (tag=${chosen.tag} random ${idx + 1}/${matches.length})`);
    return true;
  } catch (e) {
    console.log(`Не смог кликнуть ${stepName} (random): ${e.message}`);
    return false;
  }
}

async function runIncomingAttackPvpLoop(page) {
  // When defending against an incoming attack, the fight UI can offer "where to hit" and
  // "where to block". We do random actions on a slow timer to look human-like.
  const DONE_RE = /(Бой\s*завершен!|Вернуться|вернуться|Вы\s+погибли|Восстановите\s+здоровье)/i;
  const HIT_RE = /(Удар|Атак|Attack|Hit|Бить)/i;
  const BLOCK_RE = /(Блок|Защит|Defense|Block|Прикрыть)/i;
  const ZONES_RE = /(голов|тулов|корпус|ног|живот|рук|плеч|шея)/i;

  for (let i = 0; i < 200; i++) {
    const text = await getBodyText(page);
    if (DONE_RE.test(text)) {
      return;
    }

    // Prefer explicit block/hit controls if present.
    const blockOk =
      await clickRandomActionByRegex(page, BLOCK_RE, 'Incoming attack: block') ||
      await clickRandomActionByRegex(page, ZONES_RE, 'Incoming attack: block (zones)');

    await pause(page, 300, 900);

    const hitOk =
      await clickRandomActionByRegex(page, HIT_RE, 'Incoming attack: hit') ||
      await clickRandomActionByRegex(page, ZONES_RE, 'Incoming attack: hit (zones)');

    if (!blockOk && !hitOk) {
      // Not a PvP fight UI (or controls not detectable) -> do nothing here.
      return;
    }

    // Submit the selected zones by clicking "Ударить".
    await pause(page, 200, 500);
    await clickByTexts(page, ['Ударить', 'ударить'], 'Incoming attack: Ударить').catch(() => {});

    const waitSec = randInt(100, 115);
    console.log(`Incoming attack: next random turn in ${waitSec}s`);
    await fixedPause(page, waitSec * 1000);
  }
}

async function handleIncomingAttackIfAny(page, bodyText = null) {
  const text = bodyText || await getBodyText(page);
  if (isBattleScreenText(text)) return false;

  if (!/В\s*бой/i.test(text)) return false;

  // If HP is already massively negative, skip the fight — recover first (Последний дом: station
  // rotation + fishing, same as the main HP-recovery path), not the old blind Chaos+90min wait.
  const preHpMatch = text.match(/\((-?\d+)\s*\/\s*(\d+)\)/);
  const preHpVal = preHpMatch ? Number(preHpMatch[1]) : null;
  if (Number.isFinite(preHpVal) && shouldGoLastHouseByStats({ hpCurrent: preHpVal })) {
    console.log(`Pre-attack: HP already < ${LAST_HOUSE_HP_THRESHOLD} (${preHpVal}) -> skip fight, recover at Последний дом`);
    await runLastHouseRecovery(page);
    return true;
  }

  const now = Date.now();
  if (now - lastAttackClickAt < 1500) return false;

  const clicked = await clickByTexts(page, ATTACK_BUTTON_TEXTS, 'Incoming attack');
  if (!clicked) return false;

  lastAttackClickAt = Date.now();
  await pause(page, 700, 1400);

  const afterText = await getBodyText(page);

  // "В бой" also covers our own farm fight surfacing this same round-based block/hit zone-select
  // UI (Blake/goblins can present the identical PvP-style multi-round format). Player nicknames on
  // lbast.ru are Latin-only (see ATTACK_LINE_RE); a Cyrillic "VS." opponent (e.g. "Блейк") means
  // this is NOT a hostile attack -> don't alert or log it as one, and let the cycle continue
  // normally afterward (farm accounting) instead of ending the cycle like a real attack does.
  const opponentName = getFightOpponentName(afterText);
  // Раньше НЕизвестное имя противника считалось настоящим игроком (: true), и бой начинался
  // без всякой проверки HP. 17.09.2026 именно так был начат бой с корованом на 39% HP: гейт
  // квеста отказался от боя, но экран остался, а здесь имя не распозналось. Неизвестного
  // противника считаем НЕ игроком - это почти всегда наш собственный квестовый/фермовый моб,
  // и такой бой проходит через HP-гейт ниже. Настоящее нападение игрока имя даёт.
  const isRealAttacker = opponentName ? LATIN_NICK_RE.test(opponentName) : false;

  if (!isRealAttacker) {
    console.log(`"В бой" -> противник "${opponentName}" (не игрок) -> это бой с ${FARM_LABEL}, не атака`);
    // 15.09.2026, живой баг: этот бой - НЕ настоящий PvP (нет смысла "тянуть время, чтобы
    // выглядеть по-человечески" против оппонента, который не является игроком - никто не
    // ждёт свой ход). runIncomingAttackPvpLoop растягивал даже простого квестового пса
    // (Гильдия асассинов: картина) на ~100-115 сек между ударами - используем обычный
    // быстрый fightLoop вместо медленной PvP-паузы.
    // Это НАШ бой (ферма или квестовый моб), а не навязанное нападение - от него можно
    // отказаться, и на 59% HP именно так и надо. Настоящий PvP гейтить нельзя (игра не даст
    // уйти, и отказ = бесплатный удар по нам), поэтому проверка стоит только в этой ветке.
    if (!(await questFightHpGate(page, `"В бой" (${opponentName || 'не игрок'})`))) {
      return false;
    }
    await fightLoop(page).catch(() => {});
    try {
      await page.goto('http://lbast.ru/location.php', { waitUntil: 'domcontentloaded', timeout: 60000 });
      await pause(page, 800, 1600);
    } catch (e) {
      // ignore — best-effort return to a normal page, downstream retry logic will recover.
    }
    return false;
  }

  if (!isBattleScreenText(afterText)) {
    const attackerAfter = detectIncomingAttack(afterText);
    if (attackerAfter) {
      await emitAttackAlertWithScreenshot(page, attackerAfter, afterText, { reason: 'line_match_after_click' });
    }
  }

  if (/В\s*бой/i.test(afterText)) {
    const clickedAgain = await clickByTexts(page, ATTACK_BUTTON_TEXTS, 'Incoming attack (confirm)');
    if (clickedAgain) {
      await pause(page, 700, 1400);
    }
  }

  // If the incoming attack leads to a PvP-like fight UI, do random block+hit turns.
  await runIncomingAttackPvpLoop(page).catch(() => {});

  // After handling an incoming attack, immediately check HP and recover in the same cycle instead
  // of silently ending the cycle and leaving the character at negative HP for a full random sleep
  // (up to ~21 min) until the next cycle's top-of-doScenario check would catch it. Same two-tier
  // logic as the top of doScenario: deep negative -> Последний дом (stations + fishing), moderate
  // negative -> quick Кулак хаоса heal.
  try {
    await page.goto('http://lbast.ru/location.php', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await pause(page, 800, 1600);
    const locText = await getBodyText(page);
    const m = locText.match(/\((-?\d+)\s*\/\s*(\d+)\)/);
    const hpVal = m ? Number(m[1]) : null;
    if (Number.isFinite(hpVal) && shouldGoLastHouseByStats({ hpCurrent: hpVal })) {
      console.log(`Post-attack: HP < ${LAST_HOUSE_HP_THRESHOLD} (${hpVal}) -> recover at Последний дом`);
      await runLastHouseRecovery(page);
    } else if (Number.isFinite(hpVal) && shouldGoChaosByStats({ hpCurrent: hpVal })) {
      console.log(`Post-attack: HP below zero (${hpVal}) -> quick heal via Кулак хаоса`);
      await goToChaosByAmulet(page);
    }
  } catch (e) {
    // Recovery itself failed (e.g. "Форпост" not found from a transient page-load race) — don't
    // fail the whole cycle over it, but don't silently sit on it either: at this point HP can be
    // deeply critical, so a full default ~21 min sleep before the next attempt is too long. Log it
    // and retry soon instead of relying on the caller's default cycle delay.
    console.log(`Post-attack recovery failed (${e.message}) -> retry soon`);
    scheduleLongRestMinutes(2, 'post_attack_recovery_failed');
  }

  return true;
}

// 16.09.2026: link/button text on lbast.ru sometimes contains a literal ASCII `"` (e.g.
// 'Ответить "да"', 'Таверна "Три поросенка"') - interpolating that straight into a
// double-quoted CSS string (`a:has-text("${text}")`) breaks the selector's own quoting and
// silently matches nothing (no error, just "не найдено ни одного варианта"). Hit this bug
// twice live this session before finally fixing it here instead of working around it with a
// shorter substring each time.
function escapeCssStringLiteral(str) {
  return String(str || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function buildSelectorsForText(text) {
  // Use these selectors when we intend to CLICK something.
  // Avoid `text=` for clicking because it can match non-clickable text and lead to wrong clicks
  // (e.g. hitting "Настройка" or other nearby labels).
  // IMPORTANT: append Playwright's `:visible` pseudo-class. Some location pages render a
  // second, hidden copy of the nav (display:none, 0x0 rect — looks like leftover
  // responsive/mobile markup) BEFORE the real one in DOM order. `.first()` on an unfiltered
  // selector then grabs the invisible clone forever, and every click on it times out with
  // "element is not visible" no matter how long we wait. Found 15.09.2026 on the "Конь" nav
  // link, but the same hidden-duplicate pattern can affect any nav link on such a page.
  const escaped = escapeCssStringLiteral(text);
  return [
    `a:has-text("${escaped}"):visible`,
    `button:has-text("${escaped}"):visible`,
    `input[value="${escaped}"]:visible`,
  ];
}

function buildSelectorsForClickableDetect(text) {
  // Use these selectors when we want to DETECT that a clickable action is available.
  // Some lbast pages use non-standard clickable elements.
  const escaped = escapeCssStringLiteral(text);
  return [
    ...buildSelectorsForText(text),
    `[onclick]:has-text("${escaped}")`,
    `[role="link"]:has-text("${escaped}")`,
    `[role="button"]:has-text("${escaped}")`,
  ];
}

function buildSelectorsForTextAny(text) {
  // Use these selectors when we only want to DETECT that text exists on the page.
  return [...buildSelectorsForText(text), `text=${text}`];
}

function escapeRegexLiteral(str) {
  return String(str || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// 16.09.2026, Паша: "если под текстом одна кнопка то сразу ее нажать - все равно выбора нет".
// Общая логика для линейных сюжетных цепочек (диалоги/квестовые сцены, где на экране всегда
// ровно один осмысленный переход) - убираем служебные пункты шапки/меню сайта и, если остаётся
// РОВНО одна содержательная ссылка, кликаем её без необходимости знать точный текст заранее.
// Изначально была написана как одноразовая copy-paste функция внутри временного скрипта для
// Дня 3 "Жертвоприношения" (см. feedback_shtolni_debugging_mistakes) - теперь общий хелпер.
const NAV_SERVICE_WORDS = [
  // "Aмулет" (латинская A, U+0041) - известный баг верстки сайта, ссылка иногда рендерится
  // с латинской буквой вместо кириллической "Амулет" (см. feedback_shtolni_debugging_mistakes) -
  // без обоих вариантов фильтр пропускает её как "содержательную" ссылку и ломает
  // одно-кнопочные экраны ложной неоднозначностью.
  'Чат', 'В игру', 'Обновить', 'Амулет', 'Aмулет', 'Конь', 'Форум', 'ЖГ', 'Карта', 'Кланы',
  'Бои', 'Выход', 'Размер текста', 'Помощь', 'Галерея', 'Кто здесь?', 'Уйти',
];

async function clickOnlySensibleOption(page, label = 'единственный вариант') {
  const links = (await page.locator('a').allTextContents()).map((t) => t.trim()).filter(Boolean);
  const candidates = links.filter(
    (l) =>
      l.length > 3 &&
      !NAV_SERVICE_WORDS.some((w) => l === w || l.includes(w)) &&
      // Персонажный ник со статами в шапке, напр. "AI__ (380/380)" - ссылка на pers.php,
      // не игровой выбор.
      !/^[\wА-Яа-яЁё_]+\s*\(\d+\/\d+\)$/.test(l)
  );
  const unique = [...new Set(candidates)];
  if (unique.length !== 1) {
    return { clicked: false, reason: unique.length === 0 ? 'no_candidates' : 'ambiguous', candidates: unique };
  }
  const target = unique[0];
  const ok = await clickByTexts(page, [target], `${label}: "${target}"`);
  return { clicked: ok, target, candidates: unique };
}

async function existsAnyText(page, texts) {
  for (const text of texts) {
    const selectors = buildSelectorsForTextAny(text);
    for (const selector of selectors) {
      const count = await page.locator(selector).first().count().catch(() => 0);
      if (count > 0) {
        return true;
      }
    }
  }
  return false;
}

async function existsAnyClickable(page, texts) {
  for (const text of texts) {
    const selectors = buildSelectorsForClickableDetect(text);
    for (const selector of selectors) {
      const count = await page.locator(selector).first().count().catch(() => 0);
      if (count > 0) {
        return true;
      }
    }
  }
  return false;
}

async function clickByTexts(page, texts, stepName) {
  for (const text of texts) {
    const variants = buildSelectorsForText(text);

    for (const selector of variants) {
      const locator = page.locator(selector).first();
      const count = await locator.count().catch(() => 0);

      if (count > 0) {
        try {
          // Many lbast actions don't trigger a real navigation, and Playwright can time out
          // waiting for "scheduled navigations". We handle progression in performStep instead.
          await locator.click({ timeout: 8000, noWaitAfter: true });
          console.log(`OK: ${stepName} -> ${text}`);
          // Reset stuck detection on any successful click.
          uiStuckState = { stepName: '', count: 0, firstAt: 0 };
          return true;
        } catch (e) {
          console.log(`Не смог кликнуть ${stepName} -> ${text}: ${e.message}`);
        }
      }
    }
  }

  console.log(`Не найдено для шага "${stepName}" ни одного варианта: ${texts.join(', ')}`);

  // Update stuck detector (only for repeated failures of the same step name).
  const now = Date.now();
  if (uiStuckState.stepName === stepName) {
    uiStuckState.count += 1;
  } else {
    uiStuckState = { stepName, count: 1, firstAt: now };
  }

  const elapsed = now - (uiStuckState.firstAt || now);
  if (uiStuckState.count >= UI_STUCK_MAX_FAILS || elapsed >= UI_STUCK_MAX_MS) {
    throw new Error(`ui_stuck:${stepName}`);
  }

  return false;
}

async function clickByTextsLoose(page, texts, stepName) {
  // First, try the safe click targets (a/button/input).
  const ok = await clickByTexts(page, texts, stepName);
  if (ok) return true;

  // Fallback: click a unique exact-text match (any element). Use only when unique to avoid misclicking.
  for (const text of texts) {
    const locator = page.locator(`text=${text}`);
    const count = await locator.count().catch(() => 0);
    if (count === 1) {
      try {
        await locator.first().click({ timeout: 8000, noWaitAfter: true });
        console.log(`OK: ${stepName} -> ${text} (loose)`);
        return true;
      } catch (e) {
        console.log(`Не смог кликнуть ${stepName} -> ${text} (loose): ${e.message}`);
      }
    }
  }

  return false;
}

// Last resort for buttons confirmed real in-game but that clickByTextsLoose still can't click
// (e.g. its "must be the only match" safety check refuses due to a hidden duplicate/tooltip).
// Clicks the first match regardless of count, with force to bypass any overlay.
async function clickByTextsForced(page, texts, stepName) {
  const ok = await clickByTextsLoose(page, texts, stepName);
  if (ok) return true;

  for (const text of texts) {
    const locator = page.locator(`text=${text}`).first();
    const count = await locator.count().catch(() => 0);
    if (count > 0) {
      try {
        await locator.click({ timeout: 8000, force: true, noWaitAfter: true });
        console.log(`OK: ${stepName} -> ${text} (forced)`);
        return true;
      } catch (e) {
        console.log(`Не смог кликнуть ${stepName} -> ${text} (forced): ${e.message}`);
      }
    }
  }

  return false;
}

async function clickByKeywords(page, keywords, stepName) {
  for (const keyword of keywords) {
    const kw = String(keyword || '').trim();
    if (!kw) continue;

    // Prefer clickable targets.
    const clickable = page.locator(`a:has-text("${kw}"), button:has-text("${kw}"), input[value="${kw}"]`).first();
    const clickableCount = await clickable.count().catch(() => 0);
    if (clickableCount > 0) {
      try {
        await clickable.click({ timeout: 8000, noWaitAfter: true });
        console.log(`OK: ${stepName} -> ${kw} (keyword)`);
        return true;
      } catch (e) {
        console.log(`Не смог кликнуть ${stepName} -> ${kw} (keyword): ${e.message}`);
      }
    }

    // Fallback: regex text match (handles extra spaces/line breaks).
    const re = escapeRegexLiteral(kw);
    const any = page.locator(`text=/${re}/i`).first();
    const anyCount = await any.count().catch(() => 0);
    if (anyCount > 0) {
      try {
        await any.click({ timeout: 8000, noWaitAfter: true });
        console.log(`OK: ${stepName} -> ${kw} (keyword-regex)`);
        return true;
      } catch (e) {
        console.log(`Не смог кликнуть ${stepName} -> ${kw} (keyword-regex): ${e.message}`);
      }
    }
  }

  return false;
}

async function clickByNormalizedIncludes(page, keywords, stepName) {
  const kws = (keywords || []).map((k) => String(k || '').trim().toLowerCase()).filter(Boolean);
  if (kws.length === 0) return false;

  try {
    const clicked = await page.evaluate((needles) => {
      const normalize = (s) => String(s || '')
        .replace(/\u00A0/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();

      const matchesAll = (hay) => needles.every((n) => hay.includes(n));

      const isVisible = (el) => {
        try {
          const style = window.getComputedStyle(el);
          if (!style) return true;
          if (style.visibility === 'hidden' || style.display === 'none') return false;
          const rect = el.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        } catch (e) {
          return true;
        }
      };

      const candidates = [
        ...Array.from(document.querySelectorAll('a')),
        ...Array.from(document.querySelectorAll('button')),
        ...Array.from(document.querySelectorAll('input')),
        // Some lbast pages use non-standard clickable elements.
        ...Array.from(document.querySelectorAll('[onclick]')),
        ...Array.from(document.querySelectorAll('[role="link"], [role="button"]')),
      ];

      for (const el of candidates) {
        let text = '';
        if (el.tagName === 'INPUT') {
          text = el.value || '';
        } else {
          text = el.textContent || '';
        }

        const norm = normalize(text);
        if (!norm) continue;
        if (!matchesAll(norm)) continue;
        if (!isVisible(el)) continue;

        try {
          el.click();
          return true;
        } catch (e) {
          // continue
        }
      }

      return false;
    }, kws);

    if (clicked) {
      console.log(`OK: ${stepName} -> ${keywords.join(' ')} (normalized)`);
      return true;
    }
  } catch (e) {
    console.log(`Не смог кликнуть ${stepName} (normalized): ${e.message}`);
  }

  return false;
}

async function performStep(page, config) {
  const {
    stepName,
    currentTexts,
    nextTexts = [],
    waitAfterClickMs = null,
    retries = 3,
    waitForNextMs = 0,
    clickFn = null,
    skipIfNextVisible = true,
  } = config;

  const snapshot = (text) => String(text || '')
    .replace(/\u00A0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500);

  // Occasionally a navigation lands on a nearly-empty page (just the clock, no menu links) — the
  // step can't find anything to click and would fail. Reload location.php once to recover; only
  // the first step of a route lives on location.php, so deeper steps stay unaffected.
  let didBlankReload = false;

  for (let attempt = 1; attempt <= retries; attempt++) {
    console.log(`Шаг "${stepName}", попытка ${attempt}/${retries}`);

    if (skipIfNextVisible && nextTexts.length > 0 && await existsAnyClickable(page, nextTexts)) {
      console.log(`Следующий шаг для "${stepName}" уже виден, пропускаю текущий шаг`);
      return true;
    }

    const urlBeforeClick = page.url();
    const textBeforeClick = nextTexts.length === 0 ? snapshot(await getBodyText(page)) : null;
    const clicker = clickFn || clickByTexts;
    const clicked = await clicker(page, currentTexts, stepName);

    if (clicked) {
      if (waitAfterClickMs) {
        console.log(`Жду ${Math.round(waitAfterClickMs / 1000)} секунд после "${stepName}"`);
        await fixedPause(page, waitAfterClickMs);
      } else {
        await pause(page, 800, 1800);
      }

      if (waitForNextMs > 0 && nextTexts.length > 0) {
        const started = Date.now();
        while (Date.now() - started < waitForNextMs) {
          if (await existsAnyClickable(page, nextTexts)) {
            console.log(`OK: после "${stepName}" появился следующий шаг`);
            return true;
          }
          await pause(page, 150, 250);
        }
      }

      const urlAfterClick = page.url();
      if (urlAfterClick && urlAfterClick !== urlBeforeClick) {
        if (waitForNextMs > 0 && nextTexts.length > 0) {
          const started = Date.now();
          while (Date.now() - started < waitForNextMs) {
            if (await existsAnyClickable(page, nextTexts)) {
              console.log(`OK: после "${stepName}" появился следующий шаг`);
              return true;
            }
            await pause(page, 150, 250);
          }
        }
        console.log(`OK: после "${stepName}" изменился URL`);
        return true;
      }

      if (textBeforeClick !== null) {
        const textAfterClick = snapshot(await getBodyText(page));
        if (textAfterClick !== textBeforeClick) {
          if (waitForNextMs > 0 && nextTexts.length > 0) {
            const started = Date.now();
            while (Date.now() - started < waitForNextMs) {
              if (await existsAnyClickable(page, nextTexts)) {
                console.log(`OK: после "${stepName}" появился следующий шаг`);
                return true;
              }
              await pause(page, 150, 250);
            }
          }
          console.log(`OK: после "${stepName}" изменился текст страницы`);
          return true;
        }
      }

      const nextExists = nextTexts.length > 0 ? await existsAnyClickable(page, nextTexts) : false;
      const currentStillExists = await existsAnyText(page, currentTexts);

      if (nextExists) {
        console.log(`OK: после "${stepName}" появился следующий шаг`);
        return true;
      }

      if (!currentStillExists) {
        if (nextTexts.length > 0) {
          console.log(`"${stepName}" исчез со страницы, но следующий шаг не появился -> пробую еще раз`);
          await pause(page, 1000, 2000);
          continue;
        }

        console.log(`OK: "${stepName}" исчез со страницы, считаю шаг успешным`);
        return true;
      }

      console.log(`После "${stepName}" страница не обновилась как ожидалось, пробую еще раз`);
      await pause(page, 1000, 2000);
      continue;
    }

    if (nextTexts.length > 0 && await existsAnyText(page, nextTexts)) {
      console.log(`Хотя "${stepName}" не подтвердился, следующий шаг уже есть. Иду дальше.`);
      return true;
    }

    // Blank-page recovery: if the page has almost no content (e.g. only the clock rendered),
    // reload location.php once and retry from a clean state instead of burning all retries.
    if (!didBlankReload) {
      const bodyNow = snapshot(await getBodyText(page));
      if (bodyNow.replace(/\s+/g, '').length < 30) {
        didBlankReload = true;
        console.log(`Шаг "${stepName}": страница почти пустая ("${bodyNow}") -> перезагружаю location.php`);
        try {
          await page.goto('http://lbast.ru/location.php', { waitUntil: 'domcontentloaded', timeout: 60000 });
          await pause(page, 1000, 2000);
        } catch (e) {
          console.log(`Не удалось перезагрузить location.php: ${e.message}`);
        }
        continue;
      }
    }

    await pause(page, 1200, 2200);
  }

  if (nextTexts.length > 0 && await existsAnyText(page, nextTexts)) {
    console.log(`Перед ошибкой обнаружен следующий шаг для "${stepName}". Считаю шаг успешным.`);
    return true;
  }

  const failUrl = page.url();
  const failText = snapshot(await getBodyText(page));
  throw new Error(`Не найден или не выполнен шаг "${stepName}" (url=${failUrl}) (page="${failText}")`);
}

function isGoblinsLocation(text) {
  return /Осмотреть шахты/i.test(String(text || '')) || /Горы Дарии/i.test(String(text || ''));
}

async function goRouteToGoblins(page) {
  const HORSE = '\u041a\u043e\u043d\u044c';
  const DARIA = '\u0413\u043e\u0440\u044b \u0414\u0430\u0440\u0438\u0438';
  const V_PUTI = '\u0412 \u043f\u0443\u0442\u0438';
  const V_PUTI_ESHE = '\u0412 \u043f\u0443\u0442\u0438 \u0435\u0449\u0435';
  const V_PUTI_ESHYO = '\u0412 \u043f\u0443\u0442\u0438 \u0435\u0449\u0451';
  const NORTH = '\u0418\u0434\u0442\u0438 \u043d\u0430 \u0441\u0435\u0432\u0435\u0440';
  const MINES = '\u041e\u0441\u043c\u043e\u0442\u0440\u0435\u0442\u044c \u0448\u0430\u0445\u0442\u044b';
  const UDAR = '\u0423\u0434\u0430\u0440\u0438\u0442\u044c';
  const DONE = '\u0411\u043e\u0439 \u0437\u0430\u0432\u0435\u0440\u0448\u0435\u043d!';

  await performStep(page, {
    stepName: HORSE,
    currentTexts: [HORSE, HORSE.toLowerCase()],
    nextTexts: [DARIA, DARIA.toLowerCase()],
    retries: 3,
  });

  await performStep(page, {
    stepName: DARIA,
    currentTexts: [DARIA, DARIA.toLowerCase()],
    waitAfterClickMs: 7000,
    nextTexts: [
      V_PUTI,
      V_PUTI.toLowerCase(),
      V_PUTI_ESHE,
      V_PUTI_ESHE.toLowerCase(),
      V_PUTI_ESHYO,
      V_PUTI_ESHYO.toLowerCase(),
      NORTH,
      NORTH.toLowerCase(),
      MINES,
      MINES.toLowerCase(),
      UDAR,
      UDAR.toLowerCase(),
      DONE,
    ],
    retries: 3,
  });

  await tryPerformStepOptional(page, {
    stepName: V_PUTI,
    currentTexts: [
      V_PUTI_ESHE,
      V_PUTI_ESHE.toLowerCase(),
      V_PUTI_ESHYO,
      V_PUTI_ESHYO.toLowerCase(),
      V_PUTI,
      V_PUTI.toLowerCase(),
    ],
    nextTexts: [NORTH, NORTH.toLowerCase(), MINES, MINES.toLowerCase(), UDAR, UDAR.toLowerCase(), DONE],
  });

  await tryPerformStepOptional(page, {
    stepName: NORTH,
    currentTexts: [NORTH, NORTH.toLowerCase()],
    nextTexts: [MINES, MINES.toLowerCase(), UDAR, UDAR.toLowerCase(), DONE],
  });

  await pause(page, 800, 1600);
}

async function openGoblinFight(page) {
  const MINES = '\u041e\u0441\u043c\u043e\u0442\u0440\u0435\u0442\u044c \u0448\u0430\u0445\u0442\u044b';
  const V_BOY = '\u0412 \u0431\u043e\u0439!';
  const UDAR = '\u0423\u0434\u0430\u0440\u0438\u0442\u044c';
  const DONE = '\u0411\u043e\u0439 \u0437\u0430\u0432\u0435\u0440\u0448\u0435\u043d!';

  const text = await getBodyText(page);
  if (!new RegExp(UDAR, 'i').test(text) && !new RegExp(DONE, 'i').test(text)) {
    await tryPerformStepOptional(page, {
      stepName: MINES,
      currentTexts: [MINES, MINES.toLowerCase()],
      nextTexts: [V_BOY, V_BOY.toLowerCase(), '\u0412 \u0431\u043e\u0439', '\u0432 \u0431\u043e\u0439', UDAR, UDAR.toLowerCase(), DONE],
    });
  }

  const textAfterMines = await getBodyText(page);
  if ((/\u0412 \u0431\u043e\u0439!/i.test(textAfterMines) || /\u0412 \u0431\u043e\u0439\\b/i.test(textAfterMines)) && !new RegExp(UDAR, 'i').test(textAfterMines)) {
    await performStep(page, {
      stepName: V_BOY,
      currentTexts: [
        V_BOY,
        V_BOY.toLowerCase(),
        '\u0412 \u0431\u043e\u0439',
        '\u0432 \u0431\u043e\u0439',
        '\u0412\u0441\u0442\u0443\u043f\u0438\u0442\u044c \u0432 \u0431\u043e\u0439',
        '\u0432\u0441\u0442\u0443\u043f\u0438\u0442\u044c \u0432 \u0431\u043e\u0439',
        '\u041f\u0440\u0438\u043d\u044f\u0442\u044c \u0431\u043e\u0439',
        '\u043f\u0440\u0438\u043d\u044f\u0442\u044c \u0431\u043e\u0439',
      ],
      nextTexts: [UDAR, UDAR.toLowerCase(), DONE],
      retries: 4,
    });
  }

  await pause(page, 1000, 2000);
}

async function ensureGoblinFightScreen(page) {
  const UDAR_RE = /\u0423\u0434\u0430\u0440\u0438\u0442\u044c/i;
  const DONE_RE = /\u0411\u043e\u0439\u0020\u0437\u0430\u0432\u0435\u0440\u0448\u0435\u043d!/i;
  const AMULET = '\u0410\u043c\u0443\u043b\u0435\u0442';
  const LAST_PORTAL = '\u041f\u043e\u0441\u043b\u0435\u0434\u043d\u0438\u0439 \u043f\u043e\u0440\u0442\u0430\u043b';

  const text = await getBodyText(page);
  if (UDAR_RE.test(text) || DONE_RE.test(text)) return;

  // If we accidentally landed on a fastway page (e.g. after clicking "Амулет"),
  // return back to the previous location before trying to click "Конь".
  if (/mod=fastway/i.test(page.url()) || /Последний портал/i.test(text)) {
    if (await clickByTexts(page, ['Вернуться', 'вернуться'], 'Вернуться')) {
      await pause(page, 800, 1600);
    }
  }

  if (isGoblinsLocation(text)) {
    await openGoblinFight(page);
    return;
  }

  // Preferred: Амулет -> Последний портал
  const amuletOk = await clickByTexts(page, [AMULET, AMULET.toLowerCase()], AMULET);
  if (amuletOk) {
    await pause(page, 800, 2000);
    const portalOk = await clickByTexts(page, [LAST_PORTAL, LAST_PORTAL.toLowerCase()], LAST_PORTAL);
    if (portalOk) {
      await pause(page, 800, 2000);
      const afterPortalText = await getBodyText(page);
      if (isGoblinsLocation(afterPortalText)) {
        await openGoblinFight(page);
        return;
      }
      console.log('Goblin last portal did not reach mines -> routing manually.');
    } else {
      await clickByTexts(page, ['Вернуться', 'вернуться'], 'Вернуться');
      await pause(page, 800, 1600);
    }
  }

  // Fallback: manual route.
  await page.goto('http://lbast.ru/location.php', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await pause(page, 1000, 2000);
  await goRouteToGoblins(page);
  await openGoblinFight(page);
}

// Blake farming route (ported from bleyk.js): Амулет -> Девтаун -> На восток, в ремесленный
// район -> Идти на восток -> портовый район -> Пристань -> лодка на остров Блейка -> Идти на
// север -> Зайти в хижину -> бой. The first leg is identical to the Fish Eye route.
async function goRouteToBlake(page) {
  console.log('Иду по маршруту к Блейку');

  const AMULET    = 'Амулет';
  const DEVTOWN   = 'Девтаун';
  const EAST_CRAFT = 'На восток, в ремесленный район';
  const GO_EAST   = 'Идти на восток';
  const PORT      = 'портовый район';
  const PIER      = 'Пристань';
  const BOAT      = 'Взять лодку до острова Блейка за 10 дин';
  const NEXT      = 'Далее';
  const NORTH     = 'Идти на север';
  const HUT       = 'Зайти в хижину';

  const amuletOk = await clickByTexts(page, [AMULET, AMULET.toLowerCase()], AMULET);
  if (amuletOk) await pause(page, 800, 1600);

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
    nextTexts: [PORT, PORT.toLowerCase(), PIER, PIER.toLowerCase()],
    retries: 4,
  });

  if (await existsAnyText(page, [PIER, PIER.toLowerCase()])) {
    console.log('После "Идти на восток" уже видна Пристань, шаг "портовый район" пропускаю');
  } else {
    await performStep(page, {
      stepName: PORT,
      currentTexts: [PORT, PORT.toLowerCase()],
      nextTexts: [PIER, PIER.toLowerCase()],
      retries: 4,
    });
  }

  await performStep(page, {
    stepName: PIER,
    currentTexts: [PIER, PIER.toLowerCase()],
    nextTexts: [BOAT, BOAT.toLowerCase()],
    retries: 4,
  });

  await performStep(page, {
    stepName: BOAT,
    currentTexts: [BOAT, BOAT.toLowerCase()],
    waitAfterClickMs: 7000,
    nextTexts: [NEXT, NEXT.toLowerCase(), NORTH, NORTH.toLowerCase()],
    retries: 3,
  });

  if (await existsAnyText(page, [NORTH, NORTH.toLowerCase()])) {
    console.log('После лодки уже доступен шаг "Идти на север", шаг "Далее" пропускаю');
  } else {
    await performStep(page, {
      stepName: NEXT,
      currentTexts: [NEXT, NEXT.toLowerCase()],
      nextTexts: [NORTH, NORTH.toLowerCase()],
      retries: 3,
    });
  }

  await performStep(page, {
    stepName: NORTH,
    currentTexts: [NORTH, NORTH.toLowerCase()],
    nextTexts: [HUT, HUT.toLowerCase()],
    retries: 3,
  });

  await performStep(page, {
    stepName: HUT,
    currentTexts: [HUT, HUT.toLowerCase()],
    nextTexts: ['Ударить', 'ударить', 'В бой', 'в бой', 'Бой завершен!'],
    retries: 3,
  });
}

async function openBlakeFight(page) {
  console.log('Открываю бой на Блейке');

  const HUT = 'Зайти в хижину';
  const UDAR_RE = /Ударить/i;
  const DONE_RE = /Бой завершен!/i;

  const text = await getBodyText(page);

  if (UDAR_RE.test(text) || DONE_RE.test(text)) {
    console.log('Экран боя уже открыт');
    return;
  }

  if (new RegExp(HUT, 'i').test(text)) {
    await performStep(page, {
      stepName: HUT,
      currentTexts: [HUT, HUT.toLowerCase()],
      nextTexts: ['В бой', 'в бой', 'Ударить', 'ударить', 'Бой завершен!'],
      retries: 3,
    });
    await pause(page, 800, 1600);
  }

  const refreshedText = await getBodyText(page);
  if (/В\s*бой/i.test(refreshedText) && !UDAR_RE.test(refreshedText)) {
    await performStep(page, {
      stepName: 'В бой',
      currentTexts: ['В бой', 'в бой'],
      nextTexts: ['Ударить', 'ударить', 'Бой завершен!'],
      retries: 3,
    });
    await pause(page, 1000, 2000);
  }
}

function isBlakeLocation(text) {
  return /Зайти в хижину/i.test(String(text || ''));
}

async function ensureBlakeFightScreen(page) {
  const UDAR_RE = /Ударить/i;
  const DONE_RE = /Бой завершен!/i;

  const text = await getBodyText(page);
  if (UDAR_RE.test(text) || DONE_RE.test(text)) return;

  if (isBlakeLocation(text) || /В\s*бой/i.test(text)) {
    await openBlakeFight(page);
    return;
  }

  await goRouteToBlake(page);
  await openBlakeFight(page);
}

// Farm-target-aware wrappers: pick Blake or goblins depending on FARM_TARGET so doScenario's
// farm loop stays generic. Goblins reach their spot via the same Амулет -> Последний портал
// shortcut, so the "stay put and resume next cycle" behaviour works for both.
function shouldFightFarmByStats(stats) {
  return FARM_TARGET === 'goblins' ? shouldFightByStats(stats) : shouldFightBlakeByStats(stats);
}

function isFarmLocation(text) {
  return FARM_TARGET === 'goblins' ? isGoblinsLocation(text) : isBlakeLocation(text);
}

async function ensureFarmFightScreen(page) {
  return FARM_TARGET === 'goblins' ? ensureGoblinFightScreen(page) : ensureBlakeFightScreen(page);
}

const STONEGUARD_FASTWAY_URL = 'http://lbast.ru/location.php?r=6174&mod=fastway&lway=2';
const CITY_FASTWAY_URL = 'http://lbast.ru/location.php?r=7900&mod=fastway&lway=2';
// Ссылка "Амулет" в верхнем меню сайта написана с ЛАТИНСКОЙ "A" (U+0041), а не кириллической
// "А" (U+0410) - клик по тексту "Амулет" на этом аккаунте систематически не находит ссылку
// (см. LESSONS_AI_CHAR.md, "Технические баги"). Обходной путь везде, где раньше кликали
// Амулет -> конкретное направление: переходить прямо по URL mod=fastway&lway=N.
const CHAOS_FASTWAY_URL = 'http://lbast.ru/location.php?mod=fastway&lway=4'; // Кулак Хаоса
const DEVTOWN_FASTWAY_URL = 'http://lbast.ru/location.php?mod=fastway&lway=8'; // Девтаун

async function navigateFastway(page, url, label) {
  try {
    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });
    console.log(`OK: Fastway -> ${label}`);
    await pause(page, 1000, 2000);
    return true;
  } catch (e) {
    console.log(`Не удалось перейти ${label} через Fastway: ${e.message}`);
    return false;
  }
}

async function goToStoneguardViaFastway(page, label = 'Стоунгард') {
  return navigateFastway(page, STONEGUARD_FASTWAY_URL, label);
}

async function goToCityViaFastway(page, label = 'city_fastway') {
  return navigateFastway(page, CITY_FASTWAY_URL, label);
}

async function recoverToCity(page, reason) {
  console.log(`Recover to city (${reason})`);

  const ok = await goToCityViaFastway(page, 'city_fastway_recovery');
  if (ok) {
    return true;
  }

  try {
    await page.goto(CITY_FASTWAY_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await pause(page, 800, 1600);
    return true;
  } catch (e) {
    return false;
  }
}

function scheduleLongRestMinutes(minutes, reason) {
  nextCycleDelayOverrideMs = minutes * 60 * 1000;
  console.log(`Long rest scheduled: ${minutes} min (${reason})`);
}

// "Эликсир лечения (HP+40)" (oid=1005), экипированный в подсумок (inv.php?mod=put_on),
// появляется в бою через кнопку "Пояс" (arena_go.php?poyas=1) как ссылка
// "Использовать Эликсир лечения (HP+40)" (arena_go.php?poyas=1&zapoyasom=1005).
// Найдено и подтверждено вживую 14.09.2026 после подсказки Паши про квест "Дерево жизни".
const HEALING_ELIXIR_ITEM_ID = '1005';
// Порог "критического HP", на котором в бою жмётся Пояс. Паша, 17.09.2026: "сделай чтобы при
// критическом хп использовался пояс в бою". Было 0.3 - и это уже стоило живого КО (см.
// driver.js, Рыбий глаз 15.09.2026: "эликсир ни разу не сработал, видимо урон одним ударом
// перепрыгнул через порог 30%"). Проверка идёт ПОСЛЕ удара противника, поэтому порог обязан
// быть выше самого крупного одиночного урона, иначе HP перескакивает из "ещё не критично"
// сразу в ноль, и лечиться уже некому. Живой замер: бизон снимает до 186 HP при максимуме
// 380 - это 49%. Отсюда 0.5.
const HEALING_ELIXIR_HP_FRACTION = 0.5;

// 15.09.2026, Паша: "не забывай сам одевать" - после респека статов (Снять все -> сброс)
// консьюмерские слоты (Пояс/Подсумок) остаются пустыми, если их явно не переэкипировать -
// раньше это делалось вручную (то Пашей, то диагностическим скриптом), и не всегда
// вспоминали сразу. Периодическая самопроверка вместо того, чтобы полагаться на то, что
// кто-то заметит пустой слот: если Пояс или Подсумок пустует, ищем в инвентаре (invMod=3,
// с обходом всех cpage=) строку "Оберег воина"/"Эликсир лечения" с "Экипировать" и жмём.
// Никогда не трогает слот, если там уже что-то есть - только заполняет пустые.
const HEALING_SLOT_ITEM_NAMES = ['Оберег воина', 'Эликсир лечения'];

function isOutfitSlotEmpty(outfitText, slotLabel) {
  const lines = outfitText.split('\n').map((l) => l.trim());
  const line = lines.find((l) => l.startsWith(`${slotLabel}:`));
  if (!line) return false; // slot not found on page at all - don't guess
  const rest = line.slice(slotLabel.length + 1).trim();
  return rest.length === 0;
}

async function ensureHealingGearEquipped(page) {
  await page.goto('http://lbast.ru/inv.php?mod=outfit', { waitUntil: 'domcontentloaded', timeout: 60000 });
  const outfitText = await getBodyText(page);
  const beltEmpty = isOutfitSlotEmpty(outfitText, 'Пояс');
  const pouchEmpty = isOutfitSlotEmpty(outfitText, 'Подсумок');
  if (!beltEmpty && !pouchEmpty) return false;

  let equippedSomething = false;
  for (let cpage = 1; cpage <= 5; cpage++) {
    const url = cpage === 1
      ? 'http://lbast.ru/inv.php?invMod=3'
      : `http://lbast.ru/inv.php?invMod=3&cpage=${cpage}`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    const hrefs = await page.evaluate((names) => {
      const rows = Array.from(document.querySelectorAll('a'));
      const found = [];
      for (const a of rows) {
        if (a.textContent && a.textContent.trim() === 'Экипировать') {
          const row = a.closest('tr') || a.parentElement;
          const rowText = row ? row.textContent : '';
          if (names.some((n) => rowText.includes(n))) {
            found.push(a.getAttribute('href'));
          }
        }
      }
      return found;
    }, HEALING_SLOT_ITEM_NAMES).catch(() => []);

    if (hrefs.length === 0) continue;
    for (const href of hrefs) {
      const fullUrl = href.startsWith('http') ? href : `http://lbast.ru/${href.replace(/^\//, '')}`;
      await page.goto(fullUrl, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
      console.log('ensureHealingGearEquipped: экипировал предмет ->', fullUrl);
      equippedSomething = true;
      await pause(page, 500, 900);
    }
    // Re-check whether both slots are now filled before scanning more pages.
    await page.goto('http://lbast.ru/inv.php?mod=outfit', { waitUntil: 'domcontentloaded', timeout: 60000 });
    const recheck = await getBodyText(page);
    if (!isOutfitSlotEmpty(recheck, 'Пояс') && !isOutfitSlotEmpty(recheck, 'Подсумок')) break;
  }
  return equippedSomething;
}

// 15.09.2026, живой баг: когда эликсиров в инвентаре больше нет, эта страница отвечает
// "Предмет не найден!" (обычный 200 OK, не сетевая ошибка - try/catch её не ловит) и НЕ
// возвращает в бой - ни "Ударить", ни "В бой", ни "Сбросить пары" на ней нет. Раньше
// функция считала это успехом (`return true`), fightLoop продолжал ждать боевую кнопку и
// зависал на 10 итераций (`fight_not_reached`), оставляя location.php потом застрявшим на
// голом "В бой!" на много циклов подряд. Теперь проверяем текст ответа явно.
async function tryUseHealingElixir(page) {
  try {
    await page.goto(`http://lbast.ru/arena_go.php?poyas=1&zapoyasom=${HEALING_ELIXIR_ITEM_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });
    const text = await getBodyText(page);
    if (/Предмет не найден/i.test(text)) {
      console.log('Эликсир лечения: закончился в инвентаре ("Предмет не найден!") -> возвращаюсь в бой без лечения.');
      // Эта страница - тупик (нет ни "Ударить", ни "В бой"), нужно вернуться на сам бой.
      await page.goBack({ waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
      return false;
    }
    console.log('Used Эликсир лечения (HP+40) mid-fight.');
    return true;
  } catch (e) {
    return false;
  }
}

// Надеть следующий эликсир СРАЗУ ПОСЛЕ использования. Паша, 17.09.2026: "пояс не пустой
// потому что я экипировал. А ты сделай автоэкипировку после использования".
// Дыра была в моменте: ensureHealingGearEquipped вызывается раз в цикл, в самом его начале,
// то есть уже ПОСЛЕ боя. Использовав эликсир в бою, персонаж оставался с пустым подсумком до
// конца боя - хотя в инвентаре лежали ещё две штуки. Чинить надо там, где слот пустеет.
// Берём предмет из Избранного: Паша завёл его туда специально ("в инвентаре в избранное внёс,
// как зайдёшь - кликнешь на предмет и он оденется"), и ссылка там сразу ведёт на mod=put_on,
// без обхода страниц invMod=3 с их постраничностью.
// ВАЖНО: перед уходом в инвентарь запоминаем URL боя и возвращаемся на него, иначе бой
// останется висеть (см. LESSONS: читающая функция обязана вернуть страницу обратно).
async function equipNextHealingElixir(page) {
  const backUrl = page.url();
  try {
    await page.goto('http://lbast.ru/inv.php?mod=starred', { waitUntil: 'domcontentloaded', timeout: 60000 });
    const href = await page.evaluate(() => {
      const a = Array.from(document.querySelectorAll('a')).find(
        (x) => (x.getAttribute('href') || '').includes('mod=put_on')
          && /Эликсир лечения/i.test(x.textContent || ''),
      );
      return a ? a.getAttribute('href') : null;
    });
    if (!href) {
      console.log('Эликсир лечения: в Избранном надеть нечего (закончились?).');
      return false;
    }
    await page.goto(`http://lbast.ru/${href.replace(/^\//, '')}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    console.log('Эликсир лечения: надел следующий из Избранного.');
    return true;
  } catch (e) {
    console.log('equipNextHealingElixir error:', e.message);
    return false;
  } finally {
    await page.goto(backUrl, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  }
}

// Временные усилители из инвентаря (не боевые предметы, расходники) - дают бафф к статам
// на ограниченное время, статус виден в pers.php как "<название> ещё N мин." (подтверждено
// live 15-16.09.2026: "Состояние AI__: вырви глаз" уже был виден на боевом экране, значит
// эль вырви глаз кем-то использовался раньше и статус-текст в этом формате реален).
// 16.09.2026, Паша: "в игре есть усилители временные... праздничный эль и эль вырви глаз,
// можешь использовать их через инвентарь - усиляют на разное время, но будет проще бить
// ботов" - обобщили однократную функцию под Праздничный эль (была только для Штолен,
// 14.09.2026) на список из обоих элей, вызывается перед началом фарм-сессии (не в каждом
// бою - бафф держится долго, повторное использование при уже активном статусе - трата
// расходника впустую).
// 17.09.2026, живой баг: код искал эль в инвентаре ТОЧНЫМ сравнением строк и потому никогда
// его не находил ("Эль вырви глаз: не найден в инвентаре (закончился?)" в каждом запуске), хотя
// эль лежал на месте - реальное имя предмета в инвентаре пишется с кавычками и заглавной буквой:
// Эль "Вырви глаз". Сравниваем нормализованно (без кавычек, регистра и лишних пробелов).
function normalizeItemName(s) {
  return String(s || '').replace(/[«»"'`]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

const BUFF_ALE_ITEM_NAMES = ['Праздничный эль', 'Эль "Вырви глаз"'];

async function tryDrinkBuffAle(page, aleName) {
  const currentUrl = page.url();
  try {
    await page.goto('http://lbast.ru/pers.php', { waitUntil: 'domcontentloaded', timeout: 60000 });
    const persText = await getBodyText(page);
    // "Праздничный эль" -> "праздничный эль", Эль "Вырви глаз" -> "вырви глаз" (статус в
    // pers.php использует короткое имя эффекта, не полное название предмета; кавычки из
    // названия предмета в статусе не встречаются - снимаем их нормализацией).
    const statusName = normalizeItemName(aleName).replace(/^эль\s+/, '');
    if (new RegExp(`${statusName}\\s+ещ[её]`, 'i').test(persText)) {
      console.log(`${aleName}: уже активен, повторно не пьём.`);
      await page.goto(currentUrl, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
      return false;
    }

    await page.goto('http://lbast.ru/inv.php', { waitUntil: 'domcontentloaded', timeout: 60000 });
    const links = await page.locator('a').evaluateAll((els) =>
      els.map((e) => ({ t: e.textContent.trim(), href: e.getAttribute('href') })).filter((x) => x.t)
    );
    const idx = links.findIndex((l) => normalizeItemName(l.t) === normalizeItemName(aleName));
    if (idx === -1) {
      console.log(`${aleName}: не найден в инвентаре (закончился?).`);
      await page.goto(currentUrl, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
      return false;
    }
    const useLink = links.slice(idx, idx + 4).find((l) => l.t === 'Использовать');
    if (!useLink) {
      console.log(`${aleName}: не нашёл кнопку "Использовать" рядом с элем.`);
      await page.goto(currentUrl, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
      return false;
    }
    const useUrl = useLink.href.startsWith('http') ? useLink.href : 'http://lbast.ru/' + useLink.href.replace(/^\//, '');
    await page.goto(useUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    console.log(`Выпит ${aleName}.`);
    await page.goto(currentUrl, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    return true;
  } catch (e) {
    console.log(`tryDrinkBuffAle(${aleName}) error:`, e.message);
    await page.goto(currentUrl, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    return false;
  }
}

// Обходит оба эля раз за вызов - используется на старте фарм-сессии, не в каждом бою.
async function ensureBuffAlesActive(page) {
  let usedAny = false;
  for (const aleName of BUFF_ALE_ITEM_NAMES) {
    const used = await tryDrinkBuffAle(page, aleName);
    if (used) usedAny = true;
    await pause(page, 500, 1000);
  }
  return usedAny;
}

// 16.09.2026, Паша: "с активным элем можно опустить порог хп до 0.4" - один общий
// pers.php-чек раз за цикл (не по разу на каждую фарм-функцию), результат передаётся в
// runHarpyFarmRound/runBisonFarmRound/runBoarFarmRound как параметр, чтобы не плодить
// лишние обращения к pers.php на каждый вызов.
const HP_FLOOR_WITH_BUFF = 0.4;

async function isAnyBuffAleActive(page) {
  const currentUrl = page.url();
  try {
    await page.goto('http://lbast.ru/pers.php', { waitUntil: 'domcontentloaded', timeout: 60000 });
    const text = await getBodyText(page);
    const active = BUFF_ALE_ITEM_NAMES.some((aleName) => {
      const statusName = normalizeItemName(aleName).replace(/^эль\s+/, '');
      return new RegExp(`${statusName}\\s+ещ[её]`, 'i').test(text);
    });
    await page.goto(currentUrl, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    return active;
  } catch (e) {
    await page.goto(currentUrl, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    return false;
  }
}

// Обратная совместимость с существующим вызовом для Штолен (не трогаем этот путь).
async function tryDrinkFestiveAle(page) {
  return tryDrinkBuffAle(page, 'Праздничный эль');
}

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

async function useRecovery(page) {
  const success = await goToStoneguardViaFastway(page, 'Стоунгард (восстановление)');
  if (!success) {
    console.log('Не удалось попасть в Стоунгард через Fastway, вернусь на главную страницу.');
  }
}

async function goToChaosByAmulet(page) {
  // \u041a\u043b\u0438\u043a \u043f\u043e \u0442\u0435\u043a\u0441\u0442\u0443 "\u0410\u043c\u0443\u043b\u0435\u0442" \u0441\u0438\u0441\u0442\u0435\u043c\u0430\u0442\u0438\u0447\u0435\u0441\u043a\u0438 \u043d\u0435 \u043d\u0430\u0445\u043e\u0434\u0438\u0442 \u0441\u0441\u044b\u043b\u043a\u0443 (\u0441\u043c. CHAOS_FASTWAY_URL \u043a\u043e\u043c\u043c\u0435\u043d\u0442\u0430\u0440\u0438\u0439
  // \u0432\u044b\u0448\u0435) - \u043f\u0435\u0440\u0435\u0445\u043e\u0434\u0438\u043c \u043f\u0440\u044f\u043c\u043e \u043f\u043e fastway URL, \u043c\u0438\u043d\u0443\u044f \u0441\u0430\u043c\u0443 \u0441\u0441\u044b\u043b\u043a\u0443 "\u0410\u043c\u0443\u043b\u0435\u0442" \u0438 \u043f\u043e\u0434\u043c\u0435\u043d\u044e \u0446\u0435\u043b\u0438\u043a\u043e\u043c.
  await navigateFastway(page, CHAOS_FASTWAY_URL, '\u041a\u0443\u043b\u0430\u043a \u0425\u0430\u043e\u0441\u0430');
}

// The number in "Лечение: N hp/мин" is itself a link that refreshes HP/cooldown; its text
// changes every time, so we find it by walking to the nearest <a> on the same line as "Лечение".
async function clickHealingRefreshLink(page) {
  const links = page.locator('a');
  const total = await links.count().catch(() => 0);

  for (let i = 0; i < total; i++) {
    const link = links.nth(i);

    const lineText = await link.evaluate((el) => {
      const normalize = (s) => String(s || '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();

      let text = '';
      let cur = el.previousSibling;
      while (cur) {
        if (cur.nodeName === 'BR') break;
        text = (cur.textContent || '') + text;
        cur = cur.previousSibling;
      }
      cur = el.nextSibling;
      while (cur) {
        if (cur.nodeName === 'BR') break;
        text = text + (cur.textContent || '');
        cur = cur.nextSibling;
      }
      return normalize(text);
    }).catch(() => '');

    if (/Лечение/i.test(lineText)) {
      try {
        await link.click({ timeout: 8000, noWaitAfter: true });
        console.log('OK: обновил HP/кулдаун по ссылке "Лечение"');
        await pause(page, 800, 1600);
        return true;
      } catch (e) {
        console.log(`Не удалось кликнуть по ссылке "Лечение": ${e.message}`);
      }
    }
  }

  console.log('Ссылка "Лечение" не найдена, читаю статы как есть');
  return false;
}

const LAST_HOUSE_MAX_ITERATIONS = 200;

async function runLastHouseRecovery(page) {
  console.log('Последний дом: HP критично низкое, иду восстанавливаться (Форпост -> Последний дом)');

  const OUTPOST = 'Форпост';
  const LAST_HOUSE = 'Последний дом';
  const V_IGRU = 'В игру';

  const STATIONS = [
    'Исп. кухню',
    'Исп. самогонный аппарат',
    'Исп. набор травника',
  ];

  // Station cooldowns are long (20-25 min) but fishing's own cooldown is only 2 min. Sleeping the
  // full station wait in one blocking call would starve fishing of almost all its opportunities
  // during a long recovery (observed: ~5 casts across ~110 min instead of ~50) since the loop only
  // re-checks canRunFishingNow() once per iteration. Sleep in short chunks and bail out early the
  // moment fishing becomes available again, so the loop returns to it promptly instead of waiting
  // out the whole station cooldown first.
  async function waitStationCooldown(waitMinutes, reason) {
    console.log(`Последний дом: ${reason}, жду ${waitMinutes} мин (проверяю рыбалку каждые ~2 мин)`);
    const totalMs = waitMinutes * 60 * 1000;
    const chunkMs = 2 * 60 * 1000;
    let waited = 0;
    while (waited < totalMs) {
      const step = Math.min(chunkMs, totalMs - waited);
      await fixedPause(page, step);
      waited += step;
      if (canRunFishingNow()) {
        console.log('Последний дом: рыбалка снова доступна -> прерываю ожидание кулдауна станции');
        return;
      }
    }
  }

  async function enterLastHouse() {
    await performStep(page, {
      stepName: OUTPOST,
      currentTexts: [OUTPOST, OUTPOST.toLowerCase()],
      nextTexts: [LAST_HOUSE, LAST_HOUSE.toLowerCase()],
      retries: 3,
    });

    await performStep(page, {
      stepName: LAST_HOUSE,
      currentTexts: [LAST_HOUSE, LAST_HOUSE.toLowerCase()],
      retries: 3,
    });
  }

  await enterLastHouse();

  let stationIndex = 0;

  for (let i = 0; i < LAST_HOUSE_MAX_ITERATIONS; i++) {
    await clickHealingRefreshLink(page);
    let stats = parseStats(await getBodyText(page));

    if (typeof stats.hpCurrent === 'number' && stats.hpCurrent >= BLAKE_MIN_HP) {
      console.log(`Последний дом: HP восстановлено до ${stats.hpCurrent} (>= ${BLAKE_MIN_HP}) -> выхожу`);
      break;
    }

    // Combine station use with fishing: whenever fishing is due (daily catches left, 2-minute
    // cooldown elapsed), take that detour instead of a station, then jump to Кулак хаоса
    // (fastest heal) and come back to the Последний дом station rotation.
    if (canRunFishingNow()) {
      console.log('Последний дом: пробую совместить с рыбалкой');
      await runFishingViaLastPortalOrRoute(page);
      await enterLastHouse();
      continue;
    }

    const stationText = STATIONS[stationIndex % STATIONS.length];
    const used = await clickByTexts(page, [stationText, stationText.toLowerCase()], stationText);

    if (!used) {
      console.log(`Последний дом: не удалось использовать "${stationText}", жду и пробую снова`);
      await pause(page, 2000, 4000);
      continue;
    }

    stationIndex += 1;
    await pause(page, 800, 1600);

    await clickByTexts(page, ['Назад', 'назад'], 'Назад');
    await pause(page, 800, 1600);

    await clickHealingRefreshLink(page);
    const afterStats = parseStats(await getBodyText(page));
    const cooldown = typeof afterStats.cooldown === 'number' ? afterStats.cooldown : afterStats.reserveMinutes;

    if (typeof cooldown === 'number' && cooldown < 0) {
      // The cooldown value itself isn't a reliable minutes-to-wait figure (it doesn't regen
      // 1:1 per minute) — just wait a fixed 20-25 min, same as the "unparseable" fallback below.
      const waitMinutes = 20 + Math.floor(Math.random() * 6);
      await waitStationCooldown(waitMinutes, `кулдаун ушёл в минус (${cooldown})`);
    } else if (typeof cooldown !== 'number') {
      // Couldn't read the cooldown at all (e.g. header format didn't match) — rather than hammer
      // the loop with instant retries, back off a fixed 20-25 min like a normal cooldown wait.
      const waitMinutes = 20 + Math.floor(Math.random() * 6);
      await waitStationCooldown(waitMinutes, 'не удалось прочитать кулдаун');
    }
  }

  const returned = await clickByTexts(page, [V_IGRU, V_IGRU.toLowerCase()], V_IGRU);
  if (returned) {
    await pause(page, 800, 1600);
  } else {
    console.log('Последний дом: кнопка "В игру" не найдена, возвращаюсь через Стоунгард');
    await useRecovery(page);
  }
}

async function getStatsFromPage(page, label, providedText = null) {
  const text = providedText || await getBodyText(page);
  const stats = parseStats(text);
  console.log(`${label}:`, stats);
  return { text, stats };
}

async function goToLocationAndReadStats(page, label) {
  await page.goto('http://lbast.ru/location.php', {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  await pause(page, 1000, 2000);

  let text = await getBodyText(page);
  let attackHandled = await handleIncomingAttackIfAny(page, text);
  if (attackHandled) {
    return { text, stats: null, attackHandled: true };
  }

  // Death / critically low HP pages can show negative HP like "(-15705/2950)" and break stat parsing.
  // Recover immediately by moving to Chaos/Stoneguard and then re-reading stats.
  const negHpMatch = text.match(/\((-?\d+)\s*\/\s*(\d+)\)/);
  const negHpValue = negHpMatch ? Number(negHpMatch[1]) : null;
  const isNegativeHp = Number.isFinite(negHpValue) && negHpValue < 0;
  if (isNegativeHp || /Восстановите здоровье/i.test(text)) {
    const why = isNegativeHp ? `negative_hp:${negHpValue}` : 'restore_health_prompt';
    console.log(`Detected death/critical state on location.php (${why}) -> trying Chaos recovery`);
    try {
      await goToChaosByAmulet(page);
      await pause(page, 1000, 2000);
    } catch (e) {
      console.log('Chaos recovery failed: ' + e.message);
    }

    await page.goto('http://lbast.ru/location.php', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await pause(page, 1000, 2000);
    text = await getBodyText(page);
    attackHandled = await handleIncomingAttackIfAny(page, text);
    if (attackHandled) {
      return { text, stats: null, attackHandled: true };
    }

    // If HP is still critically negative after the quick Chaos Fist, do a full recovery
    // at Форпост/Последний дом instead of just sleeping it off.
    const postNeg = text.match(/\((-?\d+)\s*\/\s*(\d+)\)/);
    const postNegValue = postNeg ? Number(postNeg[1]) : null;
    if (Number.isFinite(postNegValue) && postNegValue < LAST_HOUSE_HP_THRESHOLD) {
      console.log(`HP still critical after Chaos (${postNegValue}) -> Форпост/Последний дом`);
      await runLastHouseRecovery(page);
      await page.goto('http://lbast.ru/location.php', { waitUntil: 'domcontentloaded', timeout: 60000 });
      await pause(page, 1000, 2000);
      text = await getBodyText(page);
      attackHandled = await handleIncomingAttackIfAny(page, text);
      if (attackHandled) {
        return { text, stats: null, attackHandled: true };
      }
    }
  }

  let read = await getStatsFromPage(page, label, text);

  // lbast can occasionally return a partial/transient page where stats are not present.
  // Retry once before failing the cycle.
  if (read?.stats?.hpCurrent === null || read?.stats?.cooldown === null) {
    // If we are on a fight screen, try to finish the fight and re-read stats.
    if (/\\bВ\\s+бой\\b|\\bВ\\s+бой!\\b|Ударить|Бой\\s+завершен!/i.test(text)) {
      try {
        await fightLoop(page);
        await pause(page, 800, 1600);
        text = await getBodyText(page);
        read = await getStatsFromPage(page, `${label} (post-fight)`, text);
        if (read?.stats?.hpCurrent !== null && read?.stats?.cooldown !== null) {
          return { ...read, attackHandled: false };
        }
      } catch (e) {
        // Fall back to the standard retry flow below.
      }
    }

    // Some pages no longer display cooldown/reserve in the header (e.g. "Tsunami (2759/2870) Q9 D7").
    // Fill missing cooldown via pers.php and return back to location.php.
    if (read?.stats?.cooldown === null) {
      try {
        console.log('Cooldown missing on location.php -> trying pers.php fallback');
        await pause(page, 500, 1200);
        await page.goto('http://lbast.ru/pers.php', { waitUntil: 'domcontentloaded', timeout: 60000 });
        await pause(page, 800, 1600);

        const persText = await getBodyText(page);
        const persRead = await getStatsFromPage(page, `${label} (pers.php)`, persText);

        const mergedStats = mergeStatsPreferExisting(read.stats, persRead.stats);

        await pause(page, 500, 1200);
        await page.goto('http://lbast.ru/location.php', { waitUntil: 'domcontentloaded', timeout: 60000 });
        await pause(page, 1000, 2000);

        text = await getBodyText(page);
        attackHandled = await handleIncomingAttackIfAny(page, text);
        if (attackHandled) {
          return { text, stats: null, attackHandled: true };
        }

        if (mergedStats?.hpCurrent !== null && mergedStats?.cooldown !== null) {
          return { text, stats: mergedStats, attackHandled: false };
        }

        // If fallback did not help, keep going with the legacy retry flow below.
        read = { text, stats: mergedStats };
      } catch (e) {
        if (/^hp_big_negative/.test(String(e?.message || ''))) throw e;
        console.log('pers.php fallback failed: ' + e.message);
        // Continue with the legacy retry flow below.
      }
    }

    appendDebugSnapshot('Stats parse failed (pre-retry)', { label, url: page.url(), text });
    console.log('Stats parse failed -> retry location.php once');
    await pause(page, 800, 1600);
    await page.goto('http://lbast.ru/location.php', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await pause(page, 1000, 2000);

    text = await getBodyText(page);
    attackHandled = await handleIncomingAttackIfAny(page, text);
    if (attackHandled) {
      return { text, stats: null, attackHandled: true };
    }

    read = await getStatsFromPage(page, `${label} (retry)`, text);
    if (read?.stats?.hpCurrent === null || read?.stats?.cooldown === null) {
      appendDebugSnapshot('Stats parse failed (post-retry)', { label: `${label} (retry)`, url: page.url(), text });
    }
  }

  return { ...read, attackHandled: false };
}

async function runVinogradTask(page) {
  console.log('Виноград: начинаю маршрут Конь -> Эльтауэр -> В пути -> В город (север) -> Виноградники -> Полить виноград -> В игру');

  const HORSE    = 'Конь';
  const ELTAUER  = 'Эльтауэр';
  const V_PUTI   = 'В пути';
  const V_PUTI_E = 'В пути еще';
  const V_PUTI_Y = 'В пути ещё';
  const NORTH    = 'В город (север)';
  const VINO     = 'Виноградники';
  const WATER    = 'Полить виноград';
  const V_IGRU   = 'В игру';

  await performStep(page, {
    stepName: HORSE,
    currentTexts: [HORSE, HORSE.toLowerCase()],
    nextTexts: [ELTAUER, ELTAUER.toLowerCase()],
    retries: 3,
  });

  // После выбора Эльтауэра нужно 7 сек — затем появляется "В пути" или сразу "В пути еще"
  await performStep(page, {
    stepName: ELTAUER,
    currentTexts: [ELTAUER, ELTAUER.toLowerCase()],
    waitAfterClickMs: 7000,
    nextTexts: [
      V_PUTI, V_PUTI.toLowerCase(),
      V_PUTI_E, V_PUTI_E.toLowerCase(),
      V_PUTI_Y, V_PUTI_Y.toLowerCase(),
      NORTH, NORTH.toLowerCase(),
    ],
    retries: 3,
  });

  // Кликаем "В пути" (подтверждение) и ждём до 30 сек пока появится "В город (север)"
  await tryPerformStepOptional(page, {
    stepName: V_PUTI,
    currentTexts: [
      V_PUTI_E, V_PUTI_E.toLowerCase(),
      V_PUTI_Y, V_PUTI_Y.toLowerCase(),
      V_PUTI, V_PUTI.toLowerCase(),
    ],
    nextTexts: [NORTH, NORTH.toLowerCase()],
    waitForNextMs: 30000,
  });

  await performStep(page, {
    stepName: NORTH,
    currentTexts: [NORTH, NORTH.toLowerCase(), 'в город север', 'В город север'],
    nextTexts: [VINO, VINO.toLowerCase()],
    retries: 3,
  });

  // Sometimes "В город (север)" already lands directly on the vineyard page
  // (recognizable by "Посадить семя винограда"/"Сделать вино"), so the "Виноградники"
  // link isn't there to click — skip straight to checking for the water option.
  const preVinoText = await getBodyText(page);
  const alreadyOnVineyardPage =
    /Посадить семя винограда/i.test(preVinoText) || /Сделать вино/i.test(preVinoText);

  if (!alreadyOnVineyardPage) {
    // "Посадить семя винограда"/"Сделать вино" are always on the vineyard page, watering or
    // not — treat arriving there as success even if "Полить виноград" itself isn't offered.
    await performStep(page, {
      stepName: VINO,
      currentTexts: [VINO, VINO.toLowerCase()],
      nextTexts: [
        WATER, WATER.toLowerCase(),
        'Посадить семя винограда', 'посадить семя винограда',
        'Сделать вино', 'сделать вино',
      ],
      retries: 3,
    });
  }

  // Watering can be unavailable (e.g. "Сделать вино (квестзапрет 6ч)" shown instead) —
  // that's a normal state, not an error. Just bail out; VINOGRAD_INTERVAL_MS handles retiming.
  const vineyardText = await getBodyText(page);
  if (!/Полить виноград/i.test(vineyardText)) {
    console.log('Виноград: полить сейчас нельзя (не готово/квестзапрет) — это нормально, следующая попытка через 8 часов');
    await clickByTexts(page, [V_IGRU, V_IGRU.toLowerCase()], V_IGRU).catch(() => {});
    return;
  }

  await performStep(page, {
    stepName: WATER,
    currentTexts: [WATER, WATER.toLowerCase()],
    nextTexts: [V_IGRU, V_IGRU.toLowerCase()],
    retries: 3,
    skipIfNextVisible: false,
  });

  await performStep(page, {
    stepName: V_IGRU,
    currentTexts: [V_IGRU, V_IGRU.toLowerCase()],
    nextTexts: [],
    retries: 3,
  });
}

function isStatueOfGloryDue() {
  if (!lastStatueRunAt || !nextStatueDueAt) {
    return true;
  }
  return Date.now() >= nextStatueDueAt;
}

function scheduleNextStatueOfGlory() {
  lastStatueRunAt = Date.now();
  const minutes = randomInt(STATUE_MIN_INTERVAL_MINUTES, STATUE_MAX_INTERVAL_MINUTES);
  nextStatueDueAt = lastStatueRunAt + minutes * 60 * 1000;
  persistDailyQuestState();
}

async function runStatueOfGloryTask(page) {
  console.log('Статуя славы: начинаю маршрут Конь -> Клановый замок -> Идти к замку -> Статуя славы -> В игру');

  const HORSE       = 'Конь';
  const CLAN_CASTLE = 'Клановый замок';
  const V_PUTI      = 'В пути';
  const V_PUTI_E    = 'В пути еще';
  const V_PUTI_Y    = 'В пути ещё';
  const TO_CASTLE   = 'Идти к замку';
  // На странице замка кнопка называется "Статуя Cлавы", где "C" — ЛАТИНСКАЯ буква (U+0043), а
  // не кириллическая "С", плюс вторая буква заглавная. Поэтому ищем по первому слову "Статуя"
  // (чистая кириллица, однозначное) — оно уникально на странице замка и матчится как подстрока.
  const STATUE      = 'Статуя';
  // Confirmed real success message — "В игру" is always in the top nav (present even before the
  // click), so it can't be used to tell whether the click actually worked.
  const STATUE_DONE = 'Мощь статуи будет поддерживать вас в бою';
  const V_IGRU      = 'В игру';

  await performStep(page, {
    stepName: HORSE,
    currentTexts: [HORSE, HORSE.toLowerCase()],
    nextTexts: [CLAN_CASTLE, CLAN_CASTLE.toLowerCase()],
    retries: 3,
  });

  // После выбора клановый замок нужно 7 сек — затем появляется экран поездки
  // ("В пути"/"В пути еще"), и только после подтверждения — "Идти к замку".
  await performStep(page, {
    stepName: CLAN_CASTLE,
    currentTexts: [CLAN_CASTLE, CLAN_CASTLE.toLowerCase()],
    waitAfterClickMs: 7000,
    nextTexts: [
      V_PUTI, V_PUTI.toLowerCase(),
      V_PUTI_E, V_PUTI_E.toLowerCase(),
      V_PUTI_Y, V_PUTI_Y.toLowerCase(),
      TO_CASTLE, TO_CASTLE.toLowerCase(),
    ],
    retries: 3,
  });

  // Кликаем "В пути" (подтверждение) и ждём до 30 сек пока появится "Идти к замку".
  await tryPerformStepOptional(page, {
    stepName: V_PUTI,
    currentTexts: [
      V_PUTI_E, V_PUTI_E.toLowerCase(),
      V_PUTI_Y, V_PUTI_Y.toLowerCase(),
      V_PUTI, V_PUTI.toLowerCase(),
    ],
    nextTexts: [TO_CASTLE, TO_CASTLE.toLowerCase()],
    waitForNextMs: 30000,
  });

  await performStep(page, {
    stepName: TO_CASTLE,
    currentTexts: [TO_CASTLE, TO_CASTLE.toLowerCase()],
    nextTexts: [STATUE, STATUE.toLowerCase()],
    retries: 3,
  });

  await performStep(page, {
    stepName: STATUE,
    currentTexts: [STATUE, STATUE.toLowerCase()],
    nextTexts: [STATUE_DONE, STATUE_DONE.toLowerCase()],
    retries: 3,
    skipIfNextVisible: false,
    // The button isn't a plain a/button/input element, and clickByTextsLoose's "must be the only
    // match" safety check was still refusing to click it — force through as a last resort.
    clickFn: clickByTextsForced,
  });

  await performStep(page, {
    stepName: V_IGRU,
    currentTexts: [V_IGRU, V_IGRU.toLowerCase()],
    nextTexts: [],
    retries: 3,
  });
}

// Рыбалка (ловим карасей на кухню для Последнего дома): Конь -> Клановый замок -> В пути ->
// Идти на север -> Рыбачить -> Забросить удочку -> В игру. Первые шаги совпадают со Статуей
// славы вплоть до подтверждения поездки, дальше маршрут расходится.
function isFishingSpotLocation(text) {
  return /Рыбачить/i.test(String(text || ''));
}

// Конь -> Клановый замок -> В пути (7 сек) -> Идти на север -> [Рыбачить видно на странице].
async function goRouteToFishingSpot(page) {
  const HORSE       = 'Конь';
  const CLAN_CASTLE  = 'Клановый замок';
  const V_PUTI       = 'В пути';
  const V_PUTI_E     = 'В пути еще';
  const V_PUTI_Y     = 'В пути ещё';
  const NORTH        = 'Идти на север';
  const FISH_SPOT     = 'Рыбачить';

  await performStep(page, {
    stepName: HORSE,
    currentTexts: [HORSE, HORSE.toLowerCase()],
    nextTexts: [CLAN_CASTLE, CLAN_CASTLE.toLowerCase()],
    retries: 3,
  });

  // После выбора клановый замок нужно 7 сек — затем появляется экран поездки
  // ("В пути"/"В пути еще"), и только после подтверждения — "Идти на север".
  await performStep(page, {
    stepName: CLAN_CASTLE,
    currentTexts: [CLAN_CASTLE, CLAN_CASTLE.toLowerCase()],
    waitAfterClickMs: 7000,
    nextTexts: [
      V_PUTI, V_PUTI.toLowerCase(),
      V_PUTI_E, V_PUTI_E.toLowerCase(),
      V_PUTI_Y, V_PUTI_Y.toLowerCase(),
      NORTH, NORTH.toLowerCase(),
    ],
    retries: 3,
  });

  // Кликаем "В пути" (подтверждение) и ждём до 30 сек пока появится "Идти на север".
  await tryPerformStepOptional(page, {
    stepName: V_PUTI,
    currentTexts: [
      V_PUTI_E, V_PUTI_E.toLowerCase(),
      V_PUTI_Y, V_PUTI_Y.toLowerCase(),
      V_PUTI, V_PUTI.toLowerCase(),
    ],
    nextTexts: [NORTH, NORTH.toLowerCase()],
    waitForNextMs: 30000,
  });

  await performStep(page, {
    stepName: NORTH,
    currentTexts: [NORTH, NORTH.toLowerCase()],
    nextTexts: [FISH_SPOT, FISH_SPOT.toLowerCase()],
    retries: 3,
  });
}

// Post-fishing result screen usually has "В игру", but sometimes the game returns straight to the
// normal location view (Ивовое озеро с навигацией Амулет|Конь), where "В игру" isn't present.
// Click it if there; otherwise we're already back in the game — don't throw. Fall back to location.php.
async function leaveFishingResultToGame(page) {
  const clicked = await clickByTexts(page, ['В игру', 'в игру'], 'В игру (после рыбалки)');
  if (clicked) {
    await pause(page, 800, 1600);
    return;
  }

  const text = await getBodyText(page);
  if (/Амулет/i.test(text) || /Рыбачить/i.test(text)) {
    // Уже на обычной странице локации (есть навигация Амулет / действие Рыбачить) — всё ок.
    return;
  }

  try {
    await page.goto('http://lbast.ru/location.php', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await pause(page, 800, 1600);
  } catch (e) { /* ignore */ }
}

// Assumes we're already at the fishing spot ("Рыбачить" visible). Does NOT navigate away
// afterward — the caller decides where to go next (В игру, or Кулак хаоса during recovery).
// Экран ожидания поклёва: "Подождем еще <nobr id=pbar>N</nobr> сек" + ссылка "Ждать" (go=1).
// Ждём отсчёт и подсекаем; если экран повторился (рано или новый отсчёт) — до 3 раз.
// Живой прогон 18.09.2026: после подсечки бывает ещё экран "Что-то не клюет, но вы же терпеливый
// рыбак, подождем… Ждать" без отсчёта — жмём "Ждать", пока он есть (до 8 раз), без отсчёта ждём 3 с.
async function finishFishingBiteWait(page) {
  // 4, не 8: круг "не клюет" -> отсчёт ~115 с повторяется, 8 кругов держали драйвер 16 минут без
  // улова. Удочка остаётся заброшенной, следующий заход продолжит ожидание (alreadyCast).
  for (let i = 0; i < 4; i++) {
    const text = await getBodyText(page);
    if (/вытаскиваете из воды/i.test(text)) return;
    const mm = text.match(/Подождем еще\s*(\d+)\s*сек/i);
    const waitingScreen = mm || /подсекай|не клюет|подождем/i.test(text);
    if (!waitingScreen) return;
    const secs = mm ? Number(mm[1]) + 1 : 3;
    console.log(`Рыбалка: жду поклёва ${secs} сек, потом "Ждать" (${i + 1}/4).`);
    await page.waitForTimeout(secs * 1000);
    const href = await page.evaluate(() => {
      const a = Array.from(document.querySelectorAll('a')).find((x) => /^Ждать$/i.test((x.innerText || '').trim()));
      return a ? a.getAttribute('href') : null;
    }).catch(() => null);
    if (!href) return;
    await page.goto(`http://lbast.ru/${href.replace(/^\//, '')}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(800);
  }
}

async function castFishingRodAndDetectCatch(page) {
  const FISH_SPOT = 'Рыбачить';
  const CAST = 'Забросить удочку';

  await performStep(page, {
    stepName: FISH_SPOT,
    currentTexts: [FISH_SPOT, FISH_SPOT.toLowerCase()],
    nextTexts: [CAST, CAST.toLowerCase()],
    retries: 3,
  });

  // Дневной лимит рыбы кончился: после "Рыбачить" игра показывает "Похоже, вы выловили всю рыбу,
  // приходите завтра" вместо кнопки "Забросить удочку". Наш счётчик может ещё показывать <6 (лимит
  // считается на сервере), поэтому выставляем его в лимит, чтобы canRunFishingNow больше не гонял
  // на рыбалку, и выходим чисто — без ошибки и общего бэкоффа "Retry after N min".
  // 18.09.2026: экран рыбалки иногда приходит почти пустым (одно время) и дорисовывается позже —
  // ждём до 8 с, пока появится одно из известных состояний, иначе performStep перезагрузит
  // location.php и потеряет экран.
  let afterRodText = await getBodyText(page);
  for (let i = 0; i < 16 && !/Забросить удочку|Ждать|выловили\s+всю\s+рыбу/i.test(afterRodText); i++) {
    await page.waitForTimeout(500);
    afterRodText = await getBodyText(page);
  }
  if (/выловили\s+всю\s+рыбу/i.test(afterRodText)) {
    console.log('Рыбалка: на сегодня рыба закончилась ("выловили всю рыбу") -> отмечаю лимит и выхожу');
    syncFishingDayState();
    fishingCatchesToday = FISHING_DAILY_CATCH_LIMIT;
    lastFishingAttemptAt = Date.now();
    persistDailyQuestState();
    await leaveFishingResultToGame(page);
    return false;
  }

  // Удочка уже заброшена (прошлый заход ушёл, не дождавшись) — сразу к ожиданию поклёва.
  const alreadyCast = !/Забросить удочку/i.test(afterRodText) && /Подождем еще|Ждать/.test(afterRodText);
  if (!alreadyCast) {
    await performStep(page, {
      stepName: CAST,
      currentTexts: [CAST, CAST.toLowerCase()],
      nextTexts: [],
      retries: 3,
      skipIfNextVisible: false,
    });
  }

  // 18.09.2026, разобрано по сохранённому HTML: после заброса игра показывает "Подождем еще
  // <N> сек, авось клюнет" с отсчётом (по нулю -> "подсекай!") и ссылку "Ждать" (go=1) — это и
  // есть подсечка. Ждём N+1 сек и жмём "Ждать". Раньше код сразу читал этот экран, находил в
  // шутке под ним слово "карасей" и засчитывал улов, которого не было.
  await finishFishingBiteWait(page);

  // Confirmed real success text: "...Вы с легким усилием вытаскиваете из воды карася! Далее".
  const resultText = await getBodyText(page);
  // Не просто "карас" где угодно: экран ожидания показывает шутку "— Карасей ловил", что дало бы
  // ложный улов. Засчитываем только фразу вытаскивания рыбы.
  const caught = /вытаскиваете из воды/i.test(resultText);

  lastFishingAttemptAt = Date.now();

  if (caught) {
    syncFishingDayState();
    fishingCatchesToday += 1;
    persistDailyQuestState();
    console.log(`Рыбалка: поймали карася (${fishingCatchesToday}/${FISHING_DAILY_CATCH_LIMIT} today)`);
  } else {
    // Текст результата в лог: проверка улова стала строгой ("вытаскиваете из воды"), и если игра
    // пишет улов иначе, это должно быть видно, а не молча считаться промахом.
    console.log(`Рыбалка: не повезло в этот раз ("${snapshotText(resultText, 200)}")`);
  }

  // The result (catch or miss) is usually a separate confirmation screen with "В игру", but the
  // game sometimes drops us straight back to the location view (no "В игру"). Handle both cleanly.
  await leaveFishingResultToGame(page);

  return caught;
}

// Used between quests: full route there, fish once, return to the city.
// castFishingRodAndDetectCatch already clicks "В игру" at the end, landing back on the main
// location page.
// 18.09.2026, Паша: "первым в дом купим кухню... там можно будет жарить рыбу и продавать,
// можешь включить рыбалку". Маршрут и счётчики рыбалки жили только в doScenario (коде
// Tsunami), а драйвер AI__ его не вызывает - рыбалка у AI__ не шла ни разу. Эта обёртка
// сама проверяет дневной лимит (6 карасей) и кулдаун (2 мин).
async function runFishingIfDue(page) {
  if (!canRunFishingNow()) return false;
  await runFishingTask(page);
  return true;
}
async function runFishingTask(page) {
  console.log('Рыбалка: начинаю маршрут Конь -> Клановый замок -> В пути -> Идти на север -> Рыбачить -> Забросить удочку -> В игру');

  await goRouteToFishingSpot(page);
  await castFishingRodAndDetectCatch(page);
}

// Used during critical-HP recovery (Последний дом): try the "Последний портал" shortcut first
// (same pattern as goblins — if it lands at the fishing spot, great; otherwise the full manual
// route). After fishing, jump to Кулак хаоса (fastest heal) instead of returning to the city.
async function runFishingViaLastPortalOrRoute(page) {
  console.log('Рыбалка (во время восстановления): пробую Последний портал');

  const AMULET = 'Амулет';
  const LAST_PORTAL = 'Последний портал';

  const amuletOk = await clickByTexts(page, [AMULET, AMULET.toLowerCase()], AMULET);
  if (amuletOk) {
    await pause(page, 800, 2000);
    const portalOk = await clickByTexts(page, [LAST_PORTAL, LAST_PORTAL.toLowerCase()], LAST_PORTAL);
    if (portalOk) {
      await pause(page, 800, 2000);
      const afterPortalText = await getBodyText(page);
      if (isFishingSpotLocation(afterPortalText)) {
        await castFishingRodAndDetectCatch(page);
        await goToChaosByAmulet(page);
        return;
      }
      console.log('Fishing last portal did not reach the fishing spot -> routing manually.');
    } else {
      await clickByTexts(page, ['Вернуться', 'вернуться'], 'Вернуться');
      await pause(page, 800, 1600);
    }
  }

  // Fallback: manual route.
  await page.goto('http://lbast.ru/location.php', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await pause(page, 1000, 2000);
  await goRouteToFishingSpot(page);
  await castFishingRodAndDetectCatch(page);
  await goToChaosByAmulet(page);
}

async function doScenario(page) {
  let read = await goToLocationAndReadStats(page, 'stats before action');
  if (read.attackHandled) {
    return;
  }
  let stats = read.stats;
  lastCycleStats = stats;

  await handleUnreadMailIfAny(page);

  read = await goToLocationAndReadStats(page, 'stats after mail check');
  if (read.attackHandled) {
    return;
  }
  stats = read.stats;
  lastCycleStats = stats;

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
  const vinogradDue = Date.now() - lastVinogradRunAt >= VINOGRAD_INTERVAL_MS;
  if (/Виноград/i.test(read.text || '') || vinogradDue) {
    console.log(`Виноград: ${vinogradDue ? 'прошло 8 часов' : 'обнаружено задание'}, выполняю маршрут`);
    await runVinogradTask(page);
    lastVinogradRunAt = Date.now();
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
    lastCycleStats = stats;
  }

  // Exclusive Q quests (Tavern / Shtolni): while one is in progress, do not start any other flows
  // (Ugo, Fish Eye, goblins). Keep focusing until the quest is finished.
  if (isExclusiveQQuestInProgress()) {
    // Shtolni safety gates: do not grind steps while reserve/HP are below the configured thresholds.
    if (shtolniTakenToday && !shtolniDoneToday) {
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
    if (shtolniTakenToday && !shtolniDoneToday) {
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
      lastFishEyeRunAt = Date.now();
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
      lastFishEyeRunAt = Date.now();
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
      nextCycleDelayOverrideMs = 10 * 1000;
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

// 15.09.2026, финальный найденный корень сегодняшних сбоев банкира: "obj=44" (Гильдия
// асассинов) рендерит СОВЕРШЕННО ПУСТУЮ страницу (даже без списка заданий), если открыть
// его напрямую URL'ом, находясь не на своей клетке - объект живёт на "Западные ворота"
// Стоунгарда, и без физического захода туда сначала (Стоунгард -> Западные ворота ->
// Гильдия асассинов) go=1&zad=N молча ничего не делает. Раньше это иногда "работало"
// случайно, если персонаж уже был на воротах от предыдущего действия - отсюда
// непоследовательные результаты весь день.
async function goToAssassinGuildBuilding(page) {
  await page.goto('http://lbast.ru/location.php?mod=fastway&lway=2', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await pause(page, 800, 1500);
  await clickByTexts(page, ['Западные ворота'], 'Западные ворота');
  await pause(page, 800, 1500);
}

async function acceptAssassinGuildQuest(page, zad) {
  await goToAssassinGuildBuilding(page);
  await page.goto(`http://lbast.ru/loc.php?obj=44&go=1&zad=${zad}`, {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  await pause(page, 900, 1500);

  // 17.09.2026: этот шаг был НЕМЫМ - он не проверял, взялось ли задание, и не писал в лог
  // ни строки. Из-за этого сообщение о том, что цель не появилась, выглядело загадкой:
  // непонятно, ответила ли гильдия, отказала ли и почему. Немой шаг в середине цепочки
  // превращает любой сбой ниже по течению в необъяснимый.
  const respText = await getBodyText(page).catch(() => '');
  const flat = String(respText || '').split(String.fromCharCode(10)).join(' ').trim().slice(0, 220);
  console.log(`Гильдия асассинов: ответ на взятие задания zad=${zad}: ${flat || '(ПУСТАЯ СТРАНИЦА)'}`);
  return respText;
}

// 15.09.2026, живой регресс: сначала пытался снимать блокер "ответственного задания" ПЕРЕД
// каждым accept - но если этот самый банкир/картина/торговец уже В ПРОЦЕССЕ (сам занимает
// слот, персонаж на середине гаунтлета с охранниками), это ошибочно сбрасывало СОБСТВЕННЫЙ
// незавершённый прогресс квеста при каждой повторной попытке, снова и снова начиная его с
// нуля. Правильный порядок: сначала проверить цель на месте БЕЗ переприёма (если квест уже
// наш и активен - она будет видна, ничего не трогаем); только если её нет - принять
// (и лишь если это тоже не помогло - тогда уже искать чужой блокер и снимать именно его).
async function ensureAssassinQuestTaken(page, zad, targetTexts) {
  await goToAssassinGuildQuestSpot(page, zad);
  if (await existsAnyText(page, targetTexts)) {
    return true;
  }

  await acceptAssassinGuildQuest(page, zad);
  await goToAssassinGuildQuestSpot(page, zad);
  if (await existsAnyText(page, targetTexts)) {
    return true;
  }

  const dropped = await ensureNoStuckResponsibleTask(page);
  if (!dropped) {
    return false;
  }
  await acceptAssassinGuildQuest(page, zad);
  await goToAssassinGuildQuestSpot(page, zad);
  return existsAnyText(page, targetTexts);
}

// Прямой goto на quest-шорткат коня иногда приземляется на промежуточный экран поездки
// ("Вы скачете вперед... В пути еще N сек.") вместо конечной локации — ждём и обновляем
// страницу, пока не доедем (обычно 3-7 сек, см. остальные Конь-маршруты в этом файле).
async function waitOutHorseTravel(page, url, maxAttempts = 8) {
  for (let i = 0; i < maxAttempts; i++) {
    const text = await getBodyText(page);
    if (!/В\s*пути/i.test(text)) {
      return;
    }
    await pause(page, 2000, 3000);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  }
}

async function goToAssassinGuildQuestSpot(page, zad) {
  const url = `http://lbast.ru/location.php?mod=konj&lway=q2_${zad}`;
  await page.goto(url, {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  await pause(page, 900, 1500);
  await waitOutHorseTravel(page, url);
}

async function progressAssassinBankerQuest(page) {
  const taken = await ensureAssassinQuestTaken(page, 3, ['Идти к дому', 'идти к дому']);

  // Похоже, каждое задание гильдии выполнимо не чаще раза в день: если цель на клетке
  // не появилась даже после честной попытки принять и снять чужой блокер, задание уже
  // сделано сегодня — это не ошибка, а нормальный дневной лимит.
  // 17.09.2026: раньше здесь стояло `return true` с рассуждением "не нашёл цель - похоже,
  // уже сделано". Это и есть источник ложных флагов: тот же самый отрицательный сигнал даёт
  // гибель в гаунтлете, неудачная поездка на коне и чужой блокер в анкете. "Не смог
  // убедиться" - не "сделано". О выполненности судит меню Q в runAssassinGuildQuestsIfAvailable.
  if (!taken) {
    console.log('Assassin quest (банкир): цель "Идти к дому" не появилась - не берусь судить, сделано ли; решает меню Q.');
    return false;
  }

  // 15.09.2026, живой баг: "Идти к дому" может успешно появиться и сработать (квест ещё
  // числится не сданным в state.json, напр. после ручного вмешательства Паши), но "Дом
  // банкира" сам сообщает "Вы уже выполняли это задание сегодня." вместо реального
  // гаунтлета - раньше это било в "Не найден шаг Идти в спальню" -> Quest step error ->
  // Recover to city каждый цикл подряд, вместо того чтобы просто пометить готово.
  if (await existsAnyText(page, ['Вы уже выполняли это задание сегодня'])) {
    console.log('Assassin quest (банкир): "Вы уже выполняли это задание сегодня" — считаю сделанным.');
    return true;
  }

  // 15.09.2026, живой прогон: реальность не совпала с изначально закодированным маршрутом -
  // "Зайти в дом"/"Идти вперед" не появлялись вовсе, "Войти в ворота" был только на первом
  // заходе, и боёв с охранником оказалось явно больше одного-двух (не выяснено точное число
  // без риска). Вместо жёсткого счётчика - адаптивный цикл: "Идти к дому" (+опциональные
  // "Войти в ворота"/"Зайти в дом"/"Идти вперед", если появятся) -> бой, если есть -> повтор,
  // пока не появится "Идти в спальню" (следующий реальный шаг) или не сработает страховочный
  // лимит попыток. HP-гейт перед каждым боем - не лезем в драку ниже 70% макс (см. просьбу
  // Паши "не забывай про хп, с низким не заходи в бой"; порог поднят после реального
  // KO ниже в этом же коде).
  const MAX_GUARD_FIGHTS = 6;
  for (let attempt = 1; attempt <= MAX_GUARD_FIGHTS; attempt += 1) {
    if (await existsAnyText(page, ['Идти в спальню', 'идти в спальню', 'Идти к банкиру', 'идти к банкиру'])) {
      break;
    }
    if (await existsAnyText(page, ['Вы уже выполняли это задание сегодня'])) {
      console.log('Assassin quest (банкир): "Вы уже выполняли это задание сегодня" (обнаружено в гаунтлете) — считаю сделанным.');
      return true;
    }

    // 15.09.2026, живой инцидент: один охранник (С:44,И:37,Л:30,Бр:37, урон 55-63) один раз
    // унёс HP с 210ish до -15 ДАЖЕ с эликсиром (+40) применённым в процессе - обычный порог
    // 40% тут недостаточен, слишком близко к тому, что один бой реально может забрать больше
    // половины макс. HP. Порог поднят до 70% специально для этого квеста.
    const preText = await getBodyText(page);
    const preStats = parseStats(preText);
    noteHpFromPageText(preText, 'банкир: перед боем');
    const guardFrac = hpFractionForGate(preStats);
    if (guardFrac === null || guardFrac < 0.7) {
      const shown = guardFrac === null ? 'HP не читается ни на экране, ни по последнему замеру' : `${Math.round(guardFrac * 100)}% < 70%`;
      console.log(`Assassin quest (банкир): HP-гейт не пройден (${shown}) -> останавливаюсь перед боем, продолжу позже ("Продолжить квест" сохранит прогресс).`);
      return false;
    }

    await tryPerformStepOptional(page, { stepName: 'Идти к дому', currentTexts: ['Идти к дому', 'идти к дому'] });
    await tryPerformStepOptional(page, { stepName: 'Войти в ворота', currentTexts: ['Войти в ворота', 'войти в ворота'] });
    await tryPerformStepOptional(page, { stepName: 'Зайти в дом', currentTexts: ['Зайти в дом', 'зайти в дом'] });
    await tryPerformStepOptional(page, { stepName: 'Идти вперед', currentTexts: ['Идти вперед', 'идти вперед', 'Идти вперёд', 'идти вперёд'] });

    if (await existsAnyText(page, ['Идти в спальню', 'идти в спальню'])) {
      break;
    }

    if (await existsAnyText(page, ['В бой!', 'в бой!', 'Ударить', 'ударить'])) {
      console.log(`Assassin quest (банкир): бой с охранником, попытка ${attempt}/${MAX_GUARD_FIGHTS}`);
      await fightLoop(page);
      await pause(page, 900, 1500);
    }
  }

  // 18.09.2026, живой прогон: после "Продолжить квест" персонаж стоит УЖЕ в спальне (там
  // "Идти к банкиру" / "Взломать сейф"), и жёсткий шаг "Идти в спальню" ронял квест каждый
  // цикл. А сам шаг в спальню может выбросить засаду - Телохранителя (210 HP, урон 55-63):
  // бой начинается сразу, "Идти к банкиру" на экране нет. Засаду добиваем (отказаться от неё
  // нельзя) и продолжаем квест через "Продолжить квест".
  if (!(await existsAnyText(page, ['Идти к банкиру', 'идти к банкиру']))) {
    await performStep(page, {
      stepName: 'Идти в спальню',
      currentTexts: ['Идти в спальню', 'идти в спальню'],
      retries: 3,
    });
  }
  if (!(await existsAnyText(page, ['Идти к банкиру', 'идти к банкиру']))
    && (await existsAnyText(page, ['В бой!', 'в бой!', 'Ударить', 'ударить']))) {
    console.log('Assassin quest (банкир): засада у спальни (Телохранитель) -> довожу бой.');
    await fightLoop(page);
    await pause(page, 900, 1500);
    await tryPerformStepOptional(page, { stepName: 'Продолжить квест', currentTexts: ['Продолжить квест', 'продолжить квест'] });
  }

  // Гейт финала - В СПАЛЬНЕ, до "Идти к банкиру": здесь ещё есть выход "В игру", а после
  // клика уже нет. Раньше он стоял после клика (та же ошибка, что в Харчевне и Корованах).
  if (!(await questFightHpGate(page, 'Assassin quest (банкир): финал'))) return false;

  // РАЗВИЛКА: только "Идти к банкиру". "Взломать сейф" проваливает задание на сегодня — не трогать.
  await performStep(page, {
    stepName: 'Идти к банкиру',
    currentTexts: ['Идти к банкиру', 'идти к банкиру'],
    retries: 3,
  });

  console.log('Assassin quest (банкир): финальный бой с банкиром');
  await fightLoop(page);

  console.log('Assassin quest (банкир): проход завершён, "Часы банкира" должны быть получены.');
  return true;
}

async function progressAssassinPaintingQuest(page) {
  const taken = await ensureAssassinQuestTaken(page, 2, ['Прокрасться в дом', 'прокрасться в дом']);
  // См. тот же разбор у банкира: "не нашёл цель" не означает "сделано".
  if (!taken) {
    console.log('Assassin quest (картина): цель "Прокрасться в дом" не появилась - не берусь судить, сделано ли; решает меню Q.');
    return false;
  }
  if (await existsAnyText(page, ['Вы уже выполняли это задание сегодня'])) {
    console.log('Assassin quest (картина): "Вы уже выполняли это задание сегодня" — считаю сделанным.');
    return true;
  }

  // 15.09.2026, живой прогон: флейвор-текст при accept предупреждает "дом охраняют
  // большие боевые псы" (множественное число) - подтверждено вживую: после победы над
  // одним псом игра выбрасывает обратно на "Боевые кварталы" (не в "Пройти в дальнюю
  // комнату"), и "Прокрасться в дом" нужно нажимать заново - гаунтлет из нескольких псов,
  // как и гаунтлет охранников у банкира. Адаптивный цикл вместо жёсткой
  // последовательности шагов: заходим -> идём по коридору -> бой, если есть -> повтор,
  // пока не появится "Пройти в дальнюю комнату", с тем же 70%-гейтом перед каждым боем.
  const MAX_DOG_FIGHTS = 6;
  for (let attempt = 1; attempt <= MAX_DOG_FIGHTS; attempt += 1) {
    if (await existsAnyText(page, ['Пройти в дальнюю комнату', 'пройти в дальнюю комнату'])) {
      break;
    }

    await tryPerformStepOptional(page, { stepName: 'Прокрасться в дом', currentTexts: ['Прокрасться в дом', 'прокрасться в дом'] });
    await tryPerformStepOptional(page, { stepName: 'Пройти в конец коридора', currentTexts: ['Пройти в конец коридора', 'пройти в конец коридора'] });

    if (await existsAnyText(page, ['Пройти в дальнюю комнату', 'пройти в дальнюю комнату'])) {
      break;
    }

    if (await existsAnyText(page, ['В бой!', 'в бой!'])) {
      const preText = await getBodyText(page);
      const preStats = parseStats(preText);
      noteHpFromPageText(preText, 'картина: перед боем');
      const frac = hpFractionForGate(preStats);
      if (frac === null || frac < 0.7) {
        const shown = frac === null ? 'HP не читается ни на экране, ни по последнему замеру' : `${Math.round(frac * 100)}% < 70%`;
        console.log(`Assassin quest (картина): HP-гейт не пройден (${shown}) -> не вступаю в бой с псом, продолжу позже ("Продолжить квест" сохранит прогресс).`);
        return false;
      }
      console.log(`Assassin quest (картина): бой с боевым псом, попытка ${attempt}/${MAX_DOG_FIGHTS}`);
      await fightLoop(page);
      await pause(page, 800, 1500);
    }
  }

  // НЕ трогать "Проверить сундучок" — не проверено, что оно даёт, идём сразу в дальнюю комнату.
  await performStep(page, {
    stepName: 'Пройти в дальнюю комнату',
    currentTexts: ['Пройти в дальнюю комнату', 'пройти в дальнюю комнату'],
    retries: 3,
  });

  console.log('Assassin quest (картина): проход завершён, "Старая картина" должна быть получена.');
  return true;
}

async function progressAssassinMerchantQuest(page) {
  const acceptText = await acceptAssassinGuildQuest(page, 1);
  // 18.09.2026: три из шести дневных попыток ушли на ответ "У вас уже есть задание" - слот
  // держали Харчевня и Демон озера, до каравана дело не дошло. Лимит придуман против
  // "караван не стоит на клетке", а не против занятого слота, поэтому такую попытку
  // возвращаем. Дальше всё равно идём на клетку: слот мог занимать сам торговец.
  if (hasAlreadyHasQuestText(acceptText) && assassinMerchantAttemptsToday > 0) {
    assassinMerchantAttemptsToday -= 1;
    persistDailyQuestState();
    console.log(`Assassin quest (торговец): слот задания занят - попытку не считаю (${assassinMerchantAttemptsToday}/${ASSASSIN_MERCHANT_MAX_ATTEMPTS_PER_DAY}).`);
  }
  await goToAssassinGuildQuestSpot(page, 1);

  if (await existsAnyText(page, ['Вы уже выполняли это задание сегодня'])) {
    console.log('Assassin quest (торговец): "Вы уже выполняли это задание сегодня" — считаю сделанным.');
    return true;
  }

  const text = await getBodyText(page);
  if (!/торговый караван/i.test(text)) {
    console.log('Assassin quest (торговец): каравана сейчас нет на этой клетке, попробую в следующий раз.');
    assassinMerchantNoCaravanAt = Date.now();
    return false;
  }

  const preStats = parseStats(text);
  noteHpFromPageText(text, 'торговец: перед боем');
  const merchantFrac = hpFractionForGate(preStats);
  if (merchantFrac === null || merchantFrac < 0.7) {
    const shown = merchantFrac === null ? 'HP не читается ни на экране, ни по последнему замеру' : `${Math.round(merchantFrac * 100)}% < 70%`;
    console.log(`Assassin quest (торговец): HP-гейт не пройден (${shown}) -> откладываю бой с караваном (яд опаснее остальных боёв гильдии), попробую в следующем цикле.`);
    return false;
  }

  await performStep(page, {
    stepName: 'Напасть на караван',
    currentTexts: ['Напасть на караван', 'напасть на караван'],
    retries: 3,
  });

  console.log('Assassin quest (торговец): бой с торговцем (возможен урон от яда, было опаснее остальных)');
  await fightLoop(page);

  console.log('Assassin quest (торговец): проход завершён, "Четки торговца" должны быть получены.');
  return true;
}

// Дневной диспетчер: гоняется из runDailyQuests/driver.js каждый цикл, сам решает, что ещё
// не сделано сегодня, и делает ровно один шаг за вызов (не спамит все три подряд без пауз).
// 17.09.2026, Паша: "почему не выполняются квесты асасинов?".
// Разбор: banker и painting стояли done=true в state.json, поэтому обе ветки пропускались
// молча - но игра ПРИ ЭТОМ держала "Гильдия асассинов: Убить банкира" в меню Q, то есть квест
// не сдан. Флаг встал ложно: progressAssassin*Quest возвращали true, когда цель на клетке не
// появилась ("не нашёл -> похоже, уже сделано"). Тот же отрицательный сигнал даёт гибель в
// гаунтлете (а персонаж сегодня там и погиб), неудачная поездка и чужой блокер. То есть
// "не смог убедиться" записывалось как "сделано", и на весь день.
// Что признак достоверен, видно на сверке: картина сегодня действительно сдана - её в Q нет,
// и флаг совпал; банкир в Q есть - флаг врал. Значит источник истины - меню Q, а не флаги.
// Это тот же вывод, что и по четверговым дейликам: судить о выполненности по своим флагам,
// когда игра показывает своё состояние, нельзя.
const ASSASSIN_GUILD_QUESTS = [
  { key: 'banker', re: /банкир/i, label: 'Гильдия асассинов: банкир', run: (p) => progressAssassinBankerQuest(p) },
  { key: 'painting', re: /картин/i, label: 'Гильдия асассинов: картина', run: (p) => progressAssassinPaintingQuest(p) },
  { key: 'merchant', re: /торгов/i, label: 'Гильдия асассинов: торговец', run: (p) => progressAssassinMerchantQuest(p) },
];

// Паша, 18.09.2026: "квесты асассинов - это прокачка морали в минус. Нам нужны квесты
// Ордена". Выключено. Включить обратно: AI_ASSASSIN_QUESTS=1.
const ASSASSIN_QUESTS_ENABLED = process.env.AI_ASSASSIN_QUESTS === '1';

async function runAssassinGuildQuestsIfAvailable(page) {
  if (!ASSASSIN_QUESTS_ENABLED) return false;
  resetAssassinGuildDayIfNeeded();

  if (!(await resetToQuestMenu(page))) {
    return false;
  }
  // Пауза ОБЯЗАТЕЛЬНА: resetToQuestMenu делает паузу ПЕРЕД открытием меню, а не после, и
  // getBodyText успевал прочитать ещё не отрисованную страницу.
  await pause(page, 700, 1300);
  const qNames = parseQuestNamesFromQMenuText(await getBodyText(page));

  // 17.09.2026, моя же ошибка в первой версии этой правки: пустой список я приравнял к
  // "заданий в меню нет" и пометил ВСЕ ТРИ выполненными на день - хотя runDailyQuests в том
  // же цикле прекрасно видел и банкира, и торговца. Пустое/непрочитанное меню - это третий
  // исход ("не смог убедиться"), и решать по нему нельзя ни в одну сторону. Ровно то правило,
  // которое нарушала прежняя версия с "не нашёл цель -> значит сделано".
  if (qNames.length === 0) {
    console.log('Гильдия асассинов: меню Q не прочиталось (пустой список) -> ничего не решаю, вернусь в следующем цикле.');
    return false;
  }

  // ВНИМАНИЕ: классы w и b в регулярках JavaScript - ТОЛЬКО ASCII, кириллицу они не
  // покрывают. Первая версия этого фильтра требовала после фрагмента гильди пробел, а в
  // слове Гильдия там стоит я - и фильтр не совпадал НИКОГДА. Замер: проверка класса w на
  // букве я даёт false, фильтр дал 0 совпадений из 8 реальных имён меню Q.
  // Последствие оказалось хуже исходного бага: guildNames выходил пустым, все три задания
  // объявлялись отсутствующими в Q и помечались выполненными на день - дважды подряд,
  // затирая ручную починку флагов в state.json. Кириллицу в регулярках описывать явно.
  const guildNames = qNames.filter((n) => /асассин/i.test(n));

  for (const quest of ASSASSIN_GUILD_QUESTS) {
    const inMenu = guildNames.some((n) => quest.re.test(n));

    if (!inMenu) {
      // Игра больше не предлагает это задание - значит на сегодня оно закрыто. Это
      // ЕДИНСТВЕННЫЙ признак, по которому мы имеем право пометить квест сделанным.
      if (!assassinGuildDoneToday[quest.key]) {
        assassinGuildDoneToday[quest.key] = true;
        persistDailyQuestState();
        console.log(`${quest.label}: в меню Q его нет -> на сегодня закрыт.`);
      }
      continue;
    }

    // Квест висит в меню - значит он НЕ сдан, что бы ни говорил наш флаг. Чиним флаг.
    if (assassinGuildDoneToday[quest.key]) {
      console.log(`${quest.label}: флаг говорил "сделано", но квест висит в Q -> флаг был ложным, пробую заново.`);
      assassinGuildDoneToday[quest.key] = false;
      persistDailyQuestState();
    }

    // У торговца остаётся лимит попыток: он может просто не стоять сейчас на клетке, и
    // бесконечно ездить к нему бессмысленно. Это ограничение по МИРУ, а не по выполненности.
    if (quest.key === 'merchant') {
      if (assassinMerchantAttemptsToday >= ASSASSIN_MERCHANT_MAX_ATTEMPTS_PER_DAY) {
        console.log(`${quest.label}: дневной лимит попыток исчерпан (${assassinMerchantAttemptsToday}/${ASSASSIN_MERCHANT_MAX_ATTEMPTS_PER_DAY}) - цель могла не появиться на клетке.`);
        continue;
      }
      assassinMerchantAttemptsToday += 1;
      persistDailyQuestState();
    }

    const ok = await runQuestStepSafe(page, quest.label, () => quest.run(page));
    if (ok) {
      return true;
    }
  }

  return false;
}

// ===================================================================================
// Галерея искусств / лазулиты (AI__): одноразовый (не дневной) квест. Пройден и
// проверен вживую 14.09.2026 — маршрут ниже записан 1:1 по реальному прохождению,
// см. LESSONS_AI_CHAR.md, раздел "Галерея искусств / лазулиты".
// ===================================================================================

function absUrl(href) {
  return href.startsWith('http') ? href : (href.startsWith('/') ? 'http://lbast.ru' + href : 'http://lbast.ru/' + href);
}

async function findLinkHref(page, regex) {
  return await page.evaluate((src) => {
    const re = new RegExp(src, 'i');
    const a = Array.from(document.querySelectorAll('a')).find((el) => re.test(el.textContent));
    return a ? a.getAttribute('href') : null;
  }, regex.source);
}

const FISH_VILLAGE_KONJ_URL = 'http://lbast.ru/location.php?mod=konj&lway=7';

async function progressGalleryLazuliteQuest(page) {
  await page.goto(FISH_VILLAGE_KONJ_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await waitOutHorseTravel(page, FISH_VILLAGE_KONJ_URL);

  const galleryHref = await findLinkHref(page, /Галерея искусств/);
  if (!galleryHref) {
    console.log('Gallery quest: объект "Галерея искусств" не найден в Рыбацкой деревне.');
    return false;
  }
  const galleryBase = absUrl(galleryHref);

  await page.goto(`${galleryBase}&go=1`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await pause(page, 700, 1200);
  await page.goto(`${galleryBase}&go=3`, { waitUntil: 'domcontentloaded', timeout: 60000 });

  let text = await getBodyText(page);
  if (/Благодарствую|Получено \d+ дин/i.test(text)) {
    console.log('Gallery quest: лазулит уже был на руках, сдан Марсиусу — задание завершено.');
    return true;
  }

  if (!/Задание получено|лазулит/i.test(text)) {
    console.log('Gallery quest: неожиданный текст у Марсиуса, прекращаю:', text.slice(0, 300));
    return false;
  }

  // Пешком с побережья: 2 клетки на запад от Рыбацкой деревни.
  await page.goto('http://lbast.ru/location.php', { waitUntil: 'domcontentloaded', timeout: 60000 });
  for (let i = 0; i < 2; i++) {
    const westHref = await findLinkHref(page, /На запад|Идти на запад/);
    if (!westHref) break;
    await page.goto(absUrl(westHref), { waitUntil: 'domcontentloaded', timeout: 60000 });
    await pause(page, 500, 900);
  }

  // Поиск лазулитов — случайные засады (боты) перед успехом, обычно 1-2 боя. Деремся
  // через fightLoop и повторяем клик, пока не увидим текст с находкой (без "В бой!").
  let found = false;
  for (let attempt = 0; attempt < 6 && !found; attempt++) {
    const lazuliteHref = await findLinkHref(page, /Искать лазулиты/);
    if (!lazuliteHref) {
      console.log('Gallery quest: объект "Искать лазулиты" не найден на клетке — маршрут сбился.');
      return false;
    }
    await page.goto(absUrl(lazuliteHref), { waitUntil: 'domcontentloaded', timeout: 60000 });
    text = await getBodyText(page);

    if (/В бой!/i.test(text)) {
      // Засада уже сработала - уйти с неё нельзя, поэтому именно ждём подлечивания, а не
      // отказываемся: отказ оставил бы заряженный экран "В бой!" (ровно та история, что с
      // корованом 17.09.2026, когда бой потом начал обработчик атак в обход гейта).
      if (!(await questFightHpGate(page, `Gallery: засада (попытка ${attempt + 1})`, QUEST_FIGHT_HP_FLOOR, { waitForRecovery: true }))) {
        return false;
      }
      console.log(`Gallery quest: засада на поиске лазулитов (попытка ${attempt + 1}), бой.`);
      await fightLoop(page);
    } else if (/лазулит/i.test(text)) {
      console.log('Gallery quest: лазулит найден.');
      found = true;
    } else {
      console.log('Gallery quest: непонятный ответ на поиске лазулитов:', text.slice(0, 300));
      return false;
    }
    await pause(page, 900, 1500);
  }

  if (!found) {
    console.log('Gallery quest: не удалось найти лазулит за отведённое число попыток сегодня.');
    return false;
  }

  // Обратно: 2 клетки на восток до Рыбацкой деревни, сдать Марсиусу.
  await page.goto('http://lbast.ru/location.php', { waitUntil: 'domcontentloaded', timeout: 60000 });
  for (let i = 0; i < 2; i++) {
    const eastHref = await findLinkHref(page, /Идти на восток|На восток/);
    if (!eastHref) break;
    await page.goto(absUrl(eastHref), { waitUntil: 'domcontentloaded', timeout: 60000 });
    await pause(page, 500, 900);
  }

  const galleryHref2 = await findLinkHref(page, /Галерея искусств/);
  if (!galleryHref2) {
    console.log('Gallery quest: не нашёл галерею на обратном пути для сдачи.');
    return false;
  }
  const galleryBase2 = absUrl(galleryHref2);
  await page.goto(`${galleryBase2}&go=1`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await pause(page, 700, 1200);
  await page.goto(`${galleryBase2}&go=3`, { waitUntil: 'domcontentloaded', timeout: 60000 });

  text = await getBodyText(page);
  if (/Благодарствую|Получено \d+ дин/i.test(text)) {
    console.log('Gallery quest: лазулит сдан Марсиусу, задание завершено.');
    return true;
  }

  console.log('Gallery quest: сдача не подтвердилась, текст:', text.slice(0, 300));
  return false;
}

// Одноразовый квест — не дневной. Раньше сам открывал меню Q, чтобы проверить наличие
// квеста, но это добавляло лишнюю навигацию/клик по "Q" ПЕРЕД тем, как runDailyQuests
// делает то же самое, и путало состояние страницы (пустой список квестов на втором
// клике). Теперь просто флаг galleryQuestDone: как только квест сдан один раз —
// диспетчер больше никогда не ходит проверять Марсиуса.
async function runGalleryQuestIfAvailable(page) {
  if (galleryQuestDone) {
    return false;
  }

  const GALLERY_QUEST = 'Галерея искусств';
  const ok = await runQuestStepSafe(page, GALLERY_QUEST, () => progressGalleryLazuliteQuest(page));
  if (ok) {
    galleryQuestDone = true;
    persistDailyQuestState();
  }
  return ok;
}

// ===================================================================================
// "Орден Тригмагистров: Охота на демона" (Демон озера) — маршрут продиктован Пашей
// 14.09.2026 (не проверен вживую, запускать первый раз с осторожностью, читать логи):
//   Амулет -> Дорожный крест -> Цитадель Ордена Тригмагистров -> Получить задание ->
//   В игру -> [инфо] у "Орден Тригмагистров: Охота на демона" -> "К озеру" -> ждать 7с/
//   "В пути" -> "Поросль камышей" -> "Идти по левой" -> "Идти дальше" -> "В бой!"
//   (обычный бой) -> Амулет -> Дорожный крест -> Цитадель Ордена Тригмагистров ->
//   "Доложить о задании".
// Обычный дневной квест (не одноразовый) - state с day-key, как Штольни/Харчевня.
// ===================================================================================
const DEMON_LAKE_FASTWAY_URL = 'http://lbast.ru/location.php?mod=fastway&lway=9'; // Дорожный крест

async function progressDemonLakeQuest(page) {
  const QUEST = 'Орден Тригмагистров: Охота на демона';

  await page.goto(DEMON_LAKE_FASTWAY_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await waitOutHorseTravel(page, DEMON_LAKE_FASTWAY_URL);

  // Взять задание (безопасно, если уже взято - ссылка "Получить задание" просто не найдётся).
  const enteredCitadel = await clickByTexts(page, ['Цитадель Ордена Тригмагистров'], 'Цитадель Ордена Тригмагистров');
  if (enteredCitadel) {
    await pause(page, 800, 1500);
    await clickByTexts(page, ['Получить задание'], 'Получить задание');
    await pause(page, 800, 1500);
    if (hasAlreadyHasQuestText(await getBodyText(page))) {
      console.log('Demon lake quest: игра ответила "у вас уже есть задание" -> иду в анкету отказываться.');
      await dropCurrentAssignment(page, 'Демон озера: мешает взять задание');
      return false;
    }
    await clickByTexts(page, ['В игру'], 'В игру');
    await pause(page, 800, 1500);
  }

  // "В игру" lands on the regular location, not the quest board — clickInfoForQuest
  // needs the "• Name [инфо]" list, which only renders on location.php?mod=quests.
  // Found 15.09.2026: without this, clickInfoForQuest always failed ("Info link not
  // found"), and the leftover page state then cascaded into Fish Eye/Tavern failures
  // in the same cycle too.
  const onQuestBoard = await openQuestsMenu(page);
  if (!onQuestBoard) {
    console.log('Demon lake quest: could not open quest board before info click.');
    return false;
  }

  const infoOk = await clickInfoForQuest(page, QUEST);
  if (!infoOk) {
    console.log('Demon lake quest: could not open quest info.');
    return false;
  }

  const wentToLake = await clickByTexts(page, ['К озеру', 'к озеру'], 'К озеру');
  if (!wentToLake) {
    console.log('Demon lake quest: "К озеру" link not found on quest info page.');
    return false;
  }
  await pause(page, 6500, 7500);
  await waitOutHorseTravel(page, page.url());

  const reachedReeds = await clickByTexts(page, ['Поросль камышей'], 'Поросль камышей');
  if (!reachedReeds) {
    console.log('Demon lake quest: "Поросль камышей" not found - stopping, needs manual check.');
    await appendDebugSnapshot('Demon lake: state after "К озеру" + travel wait, reeds step not found', {
      label: 'demon_lake_no_reeds',
      url: page.url(),
      text: await getBodyText(page),
    });
    return false;
  }
  await pause(page, 800, 1500);

  await clickByTexts(page, ['Идти по левой', 'идти по левой'], 'Идти по левой');
  await pause(page, 800, 1500);

  await clickByTexts(page, ['Идти дальше'], 'Идти дальше');
  await pause(page, 800, 1500);

  if (await existsAnyText(page, ['В бой!', 'в бой!', 'В бой', 'в бой'])) {
    if (!(await questFightHpGate(page, 'Демон озера'))) return false;
    await performStep(page, {
      stepName: 'В бой!',
      currentTexts: ['В бой!', 'в бой!', 'В бой', 'в бой'],
      retries: 4,
    });
    await fightLoop(page);
  }

  return reportDemonLakeQuest(page);
}

async function reportDemonLakeQuest(page) {
  await page.goto(DEMON_LAKE_FASTWAY_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await waitOutHorseTravel(page, DEMON_LAKE_FASTWAY_URL);
  await clickByTexts(page, ['Цитадель Ордена Тригмагистров'], 'Цитадель Ордена Тригмагистров');
  await pause(page, 800, 1500);
  const reported = await clickByTexts(page, ['Доложить о задании'], 'Доложить о задании');
  if (reported) {
    await pause(page, 800, 1500);
    console.log(`Demon lake quest: доклад -> ${snapshotText(await getBodyText(page), 160)}`);
    await clickByTexts(page, ['В игру'], 'В игру').catch(() => {});
  }
  return Boolean(reported);
}

// 18.09.2026, живой случай: демона убил обработчик висящего боя (гейт квеста отказал уже у
// демона), до "Доложить о задании" код квеста не дошёл, а взятое задание из меню Q пропадает.
// Итог - слот задания висел с "Принесите доказательства найденного", и гильдия асассинов
// отвечала торговцу "У вас уже есть задание" весь день. Источник истины - анкета: если там
// висит задание про Ивовое озеро, едем докладывать.
async function demonLakeAwaitsReport(page) {
  await page.goto('http://lbast.ru/pers.php', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  const text = await getBodyText(page).catch(() => '');
  const m = text.match(/Текущее задание:\s*([\s\S]*?)\s*-\s*отказаться/i);
  return Boolean(m && /Ивового озера/i.test(m[1]));
}

// ===================================================================================
// Ордо Экзекуторс - квесты на мораль в ПЛЮС (Паша, 18.09.2026: "асассинов больше не делаем,
// нам нужны квесты ордо... как поймёшь - заскриптуй и выполняй, как только появятся в меню").
// Оба задания пройдены вживую 18.09.2026 (Медальон бандита, Костяная цепь бандита).
// Официальный гайд: library/help/index.php?mod=102.
//  - Взять: Стоунгард -> Южные ворота -> Идти на юг -> Идти на восток -> Башня Ордо Экзекуторс
//    -> "Уничтожить главаря банды" (zad=1) / "Уничтожить банду" (zad=2).
//  - Главарь: конь lway=q2001_1 (Рыбацкая деревня) -> Идти за скальную гряду -> Идти по ТРОПЕ
//    (по дороге - охрана с паролем) -> Идти дальше (не "Спрыгнуть на него") -> Залезть в люк ->
//    Прокрасться (мимо двоих у костра) -> Идти дальше -> Напасть -> бой. После - час запрета.
//  - Банда: конь lway=q2001_2 (Пещера бандитов, горы Дарии) -> Добить бандитов -> В бой!
//  - Доклад (go=2) - только с 6 уровня: "А пока копите предметы задания, вам их нужно 56".
//    Пока просто копим предметы; задание само освобождает слот после победы.
// ===================================================================================
const ORDO_TOWER_OBJ = 5100;
const ORDO_QUESTS = [
  { zad: 1, label: 'Ордо: главарь банды', menu: 'Ордо экзекуторс: Уничтожить главаря банды', take: 'Уничтожить главаря банды' },
  { zad: 2, label: 'Ордо: банда', menu: 'Ордо экзекуторс: Уничтожить банду', take: 'Уничтожить банду' },
];
// Выбор на каждом экране миссии, по порядку предпочтения. "Сдаться", "Спрыгнуть на него",
// "Идти по дороге", "Слезть к пещере" и драка с двумя у костра сюда НЕ входят намеренно.
const ORDO_MISSION_STEPS = [
  'Идти за скальную гряду', 'Идти по тропе', 'Залезть в люк', 'Прокрасться', 'Идти дальше',
  'Добить бандитов', 'Напасть', 'В бой!',
];

async function walkToOrdoTower(page) {
  await page.goto('http://lbast.ru/location.php?mod=fastway&lway=2', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await waitOutHorseTravel(page, 'http://lbast.ru/location.php');
  for (const step of ['Южные ворота', 'Идти на юг', 'Идти на восток', 'Башня Ордо Экзекуторс']) {
    await performStep(page, { stepName: step, currentTexts: [step], retries: 3 });
  }
}

async function progressOrdoQuest(page, q) {
  if (!(await preTripHpGate(page, q.label))) return false;

  await walkToOrdoTower(page);
  await clickByTexts(page, [q.take], q.take);
  await pause(page, 800, 1500);
  const takeText = await getBodyText(page);
  if (!/Задание принято/i.test(takeText) && !hasAlreadyHasQuestText(takeText)) {
    // Начало страницы башни — одно описание Ордена; причина отказа ниже, в списке заданий
    // и строке "Текущее задание" (19.09.2026 лог обрезался ровно перед ней).
    const at = takeText.search(/Задания:|Выполняйте задания|Текущее задание/);
    console.log(`${q.label}: задание не выдали: ${snapshotText(at >= 0 ? takeText.slice(at) : takeText, 600)}`);
    return false;
  }

  const horse = `http://lbast.ru/location.php?mod=konj&lway=q2001_${q.zad}`;
  await page.goto(horse, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await waitOutHorseTravel(page, 'http://lbast.ru/location.php');

  let fought = false;
  for (let i = 0; i < 14; i++) {
    const text = await getBodyText(page);
    if (/Ударить/i.test(text)) {
      await fightLoop(page);
      fought = true;
      await pause(page, 800, 1500);
      // После победы нас выкидывает на локацию, где снова виден ВХОД в миссию - не начинать
      // её по второму кругу. Бой посреди пути (заметили у костра) входа не показывает.
      const after = await getBodyText(page);
      if (after.includes('Идти за скальную гряду') || after.includes('Добить бандитов')) break;
      continue;
    }
    const next = ORDO_MISSION_STEPS.find((s) => text.includes(s));
    if (!next) break; // миссия кончилась - обычная локация
    await clickByTexts(page, [next], `${q.label}: ${next}`);
    await pause(page, 800, 1500);
  }
  if (!fought) {
    console.log(`${q.label}: до боя не дошёл - решит меню Q в следующем цикле.`);
    return false;
  }
  console.log(`${q.label}: бой пройден, предмет задания должен быть в инвентаре (доклад - с 6 уровня).`);
  return true;
}

async function runOrdoQuestsIfAvailable(page) {
  if (!(await resetToQuestMenu(page))) return false;
  await pause(page, 700, 1300);
  const names = parseQuestNamesFromQMenuText(await getBodyText(page));
  let did = false;
  for (const q of ORDO_QUESTS) {
    if (!isQuestInMenu(names, q.menu)) continue;
    const ok = await runNonQQuestSafe(page, q.label, () => progressOrdoQuest(page, q));
    if (ok) did = true;
  }
  return did;
}

async function runDemonLakeQuestIfAvailable(page) {
  const today = getDayKeyNow();
  if (demonLakeDayKey !== today) {
    demonLakeDayKey = today;
    demonLakeDoneToday = false;
  }
  if (demonLakeDoneToday) {
    return false;
  }

  const QUEST = 'Орден Тригмагистров: Охота на демона';
  // 14.09.2026: диспетчер должен сам открыть меню квестов, а не проверять текст ТЕКУЩЕЙ
  // страницы (обычно это location.php, там названий квестов нет) - иначе existsAnyText
  // всегда false и квест никогда не запускается.
  const menuOpened = await resetToQuestMenu(page);
  if (!menuOpened) {
    return false;
  }
  const qNamesNow = parseQuestNamesFromQMenuText(await getBodyText(page));
  if (!isQuestInMenu(qNamesNow, QUEST)) {
    if (!(await demonLakeAwaitsReport(page))) return false;
    console.log('Demon lake quest: в меню Q нет, но в анкете висит задание Ордена -> еду докладывать.');
    const reported = await runNonQQuestSafe(page, 'Demon lake report', () => reportDemonLakeQuest(page));
    if (reported) {
      demonLakeDoneToday = true;
      persistDailyQuestState();
    }
    return Boolean(reported);
  }

  const ok = await runNonQQuestSafe(page, 'Demon lake quest', () => progressDemonLakeQuest(page));
  if (ok) {
    demonLakeDoneToday = true;
    persistDailyQuestState();
  }
  return Boolean(ok);
}

// ===================================================================================
// "Кораблекрушение" — маршрут продиктован Пашей 14.09.2026 (не проверен вживую):
//   [инфо] -> "К месту выполнения" -> ждать 7с / "В пути" -> Тещин маяк -> "Далее" x3 ->
//   "По рукам, вези." -> "Столкнуть лодку в воду" -> "Далее" x3 -> "Ступить на борт
//   корабля" -> "Идти в каюту капитана" -> "Напасть на них" -> "В бой!" (бой 1) ->
//   "Вернуться" -> "Продолжить квест" -> "В бой!" (бой 2) -> "Продолжить квест" ->
//   "Открыть сундук" -> "Взять деньги и вернуться на палубу" -> "Сесть за весла" ->
//   "Причалить к берегу" -> "достать мешочек с монетами из кармана" -> задание завершено.
// Обычный дневной квест (не одноразовый), появляется в Q без отдельного "взять задание".
// ===================================================================================
async function progressShipwreckQuest(page) {
  const QUEST = 'Кораблекрушение';

  const infoOk = await clickInfoForQuest(page, QUEST);
  if (!infoOk) {
    console.log('Shipwreck quest: could not open quest info.');
    return false;
  }

  const travelOk = await clickByTexts(page, ['К месту выполнения'], 'К месту выполнения');
  if (!travelOk) {
    console.log('Shipwreck quest: "К месту выполнения" not found.');
    return false;
  }
  await pause(page, 6500, 7500);
  await waitOutHorseTravel(page, page.url());

  const preFightSteps = [
    'Далее', 'Далее', 'Далее',
    'По рукам, вези.',
    'Столкнуть лодку в воду',
    'Далее', 'Далее', 'Далее',
    'Ступить на борт корабля',
    'Идти в каюту капитана',
    'Напасть на них',
  ];
  for (const step of preFightSteps) {
    await tryPerformStepOptional(page, { stepName: step, currentTexts: [step, step.toLowerCase()] });
    await pause(page, 700, 1300);
  }

  if (await existsAnyText(page, ['В бой!', 'в бой!', 'В бой', 'в бой'])) {
    if (!(await questFightHpGate(page, 'Кораблекрушение (бой 1)'))) return false;
    await performStep(page, {
      stepName: 'В бой!',
      currentTexts: ['В бой!', 'в бой!', 'В бой', 'в бой'],
      retries: 4,
    });
    await fightLoop(page);
  }

  await pause(page, 700, 1300);
  await tryPerformStepOptional(page, { stepName: 'Вернуться', currentTexts: ['Вернуться', 'вернуться'] });
  await pause(page, 700, 1300);
  await tryPerformStepOptional(page, { stepName: 'Продолжить квест', currentTexts: ['Продолжить квест', 'продолжить квест'] });
  await pause(page, 700, 1300);

  if (await existsAnyText(page, ['В бой!', 'в бой!', 'В бой', 'в бой'])) {
    if (!(await questFightHpGate(page, 'Кораблекрушение (бой 2)'))) return false;
    await performStep(page, {
      stepName: 'В бой! (2)',
      currentTexts: ['В бой!', 'в бой!', 'В бой', 'в бой'],
      retries: 4,
    });
    await fightLoop(page);
  }

  await pause(page, 700, 1300);
  const postFightSteps = [
    'Продолжить квест',
    'Открыть сундук',
    'Взять деньги и вернуться на палубу',
    'Сесть за весла',
    'Причалить к берегу',
    'достать мешочек с монетами из кармана',
  ];
  for (const step of postFightSteps) {
    const ok = await tryPerformStepOptional(page, { stepName: step, currentTexts: [step, step.toLowerCase()] });
    if (ok) await pause(page, 700, 1300);
  }

  return true;
}

// ===================================================================================
// "Травы" (Арайя/Шипы дикого кактуса/Кустарник травии/Дикий пустолист/Хмель/Пререя) -
// 6 однотипных ежедневных квестов сбора трав, найдены и разобраны вживую 15.09.2026 по
// прямой просьбе Паши ("можешь начать рвать траву") - подтвердил "трава это без боя,
// можешь собирать при положительных резервах и хп", так что HP-гейта тут нет вообще.
// Механика одинакова для всех шести (только разное имя квеста/локация):
// [инфо] -> "К месту выполнения" (конь до нужного места, авто, без ручной навигации по
// тексту "два раза на запад, четыре раза на юг" и т.п. - это просто флейвор, "К месту
// выполнения" сам довозит) -> "Искать травы" -> сетка из 16 ссылок "*" (loc.php?...&
// gamekl=N). Клик по любой "*" раскрывает число (промах, безопасно) или "#" с текстом
// "Вы укололись о ядовитый шип и ничего не нашли!" (тоже безопасно - живьём подтверждено:
// HP до и после теста не изменился, 87/340 -> 87/340) - оба исхода без урона, просто
// одна попытка в день заканчивается либо травой, либо шипом. Не найдено способа предугадать
// исход по числам-подсказкам за одну попытку в день - клик по первой доступной "*"
// достаточен и ничем не хуже любой другой стратегии.
// Квест сам пропадает из Q-меню после израсходованной на сегодня попытки (тот же сигнал,
// что и у Кораблекрушения/Демон озера) - отдельный day-key в state.json не нужен.
// ===================================================================================
const HERB_QUEST_NAMES = [
  'Травы: Арайя',
  'Травы: Шипы дикого кактуса',
  'Травы: Кустарник травии',
  'Травы: Дикий пустолист',
  'Травы: Хмель',
  'Травы: Пререя',
];

async function progressHerbGatherQuest(page, questName) {
  const infoOk = await clickInfoForQuest(page, questName);
  if (!infoOk) return false;
  await pause(page, 500, 900);

  const travelOk = await clickByTexts(page, ['К месту выполнения'], 'К месту выполнения');
  if (!travelOk) return false;

  for (let i = 0; i < 10; i++) {
    await pause(page, 1500, 2000);
    const t = await getBodyText(page);
    if (!/В пути ещ/i.test(t)) break;
    await page.goto(page.url(), { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  }

  const searchOk = await clickByTexts(page, ['Искать травы'], 'Искать травы');
  if (!searchOk) {
    console.log(`Herb quest "${questName}": "Искать травы" не найдено на месте - непредвиденный маршрут, пропускаю.`);
    return false;
  }
  await pause(page, 800, 1200);

  for (let round = 0; round < 20; round++) {
    const links = await page.evaluate(() =>
      Array.from(document.querySelectorAll('a')).map((a) => ({ text: a.textContent.trim(), href: a.getAttribute('href') }))
    );
    const pick = links.find((l) => l.text === '*') || links.find((l) => l.text === 'Далее');
    if (!pick) break;
    const href = pick.href.startsWith('http') ? pick.href : `http://lbast.ru/${pick.href.replace(/^\//, '')}`;
    await page.goto(href, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    await pause(page, 500, 900);
  }

  console.log(`Herb quest "${questName}": попытка на сегодня завершена.`);
  return true;
}

async function runHerbQuestsIfAvailable(page) {
  const menuOpened = await resetToQuestMenu(page);
  if (!menuOpened) return false;
  const qNames = parseQuestNamesFromQMenuText(await getBodyText(page));
  for (const name of HERB_QUEST_NAMES) {
    if (isQuestInMenu(qNames, name)) {
      return await runNonQQuestSafe(page, `Herb: ${name}`, () => progressHerbGatherQuest(page, name));
    }
  }
  return false;
}

async function runShipwreckQuestIfAvailable(page) {
  const today = getDayKeyNow();
  if (shipwreckDayKey !== today) {
    shipwreckDayKey = today;
    shipwreckDoneToday = false;
  }
  if (shipwreckDoneToday) {
    return false;
  }

  const QUEST = 'Кораблекрушение';
  // 14.09.2026: та же правка, что и для "Демон озера" - проверять список квестов через
  // открытое меню Q, а не текст текущей (обычно location.php) страницы.
  const menuOpened = await resetToQuestMenu(page);
  if (!menuOpened) {
    return false;
  }
  const qNamesNow = parseQuestNamesFromQMenuText(await getBodyText(page));
  if (!isQuestInMenu(qNamesNow, QUEST)) {
    return false;
  }

  const ok = await runNonQQuestSafe(page, 'Shipwreck quest', () => progressShipwreckQuest(page));
  if (ok) {
    // Не отмечаем сразу "сделано" — проверяем, что квест реально исчез из Q меню (тот же приём, что для Харчевни/Штолен/Корованов).
    const menuOk = await resetToQuestMenu(page);
    if (menuOk) {
      const qNames = parseQuestNamesFromQMenuText(await getBodyText(page));
      if (!isQuestInMenu(qNames, QUEST)) {
        shipwreckDoneToday = true;
        persistDailyQuestState();
        console.log('Shipwreck quest: done today (confirmed gone from Q).');
      } else {
        console.log('Shipwreck quest: flow ran but quest still in Q -> will retry.');
      }
    } else {
      shipwreckDoneToday = true;
      persistDailyQuestState();
    }
  }
  return Boolean(ok);
}

// ===================================================================================
// "Рыбный ресторан Тёща Кумуса" (эскорт-квест с Яшкой/Гретхис) — источник: блог Dikaya в
// игре (zhg_web.php?st_id=224300, st_id=225290), см. LESSONS_AI_CHAR.md "Рыбный ресторан".
// НЕ проверено вживую - маршрут записан буквально по тексту гайда. Паша попросил проходить
// награды журнала по порядку номеров (15.09.2026), начиная с №1.
// ===================================================================================

// 15.09.2026, первая живая попытка: простой заход пешком (fastway -> клик "Рыбный
// ресторан") приводит только к NPC Гретхис, которая молча здоровается ("Уйти" —
// единственный вариант) - без формального "взятия" квеста через Q-меню игра не
// поднимает сценарий (то же самое, что и "Колодец Страха" - см. LESSONS_AI_CHAR.md).
// Правильный вход - как у Кораблекрушения: [инфо] в Q-меню -> "К месту выполнения".
// НО если квест уже взят и диалог на середине (Паша вручную прошёл начало живьём
// 15.09.2026: Тёща Кумуса -> "Я насчет работы." -> Яшка спрашивает про мрамару ->
// развилка Холмы/Болота/Опушка) - location.php показывает "Продолжить квест" наверху,
// и заходить заново через [инфо] НЕЛЬЗЯ (потеряется прогресс диалога, тот же принцип,
// что и для Штолен). Проверяем это первым делом.
async function goToFishRestaurant(page) {
  await page.goto('http://lbast.ru/location.php', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await pause(page, 500, 1000);

  if (await existsAnyText(page, ['Продолжить квест'])) {
    await clickByTexts(page, ['Продолжить квест'], 'Продолжить квест');
    await pause(page, 800, 1500);
    return;
  }

  const QUEST = 'Рыбный ресторан';
  const menuOk = await resetToQuestMenu(page);
  if (!menuOk) {
    throw new Error('Fish Restaurant: could not open quest menu.');
  }
  const infoOk = await clickInfoForQuest(page, QUEST);
  if (!infoOk) {
    throw new Error('Fish Restaurant: could not open quest info.');
  }
  const travelOk = await clickByTexts(page, ['К месту выполнения'], 'К месту выполнения');
  if (!travelOk) {
    throw new Error('Fish Restaurant: "К месту выполнения" not found.');
  }
  await pause(page, 6500, 7500);
  await waitOutHorseTravel(page, page.url());

  // Свежий заход: Форт Жженого листа -> "Рыбный ресторан" -> "Тёща Кумуса" -> "Я насчет
  // работы." запускает цепочку диалога (Тёща Кумуса -> Яшка про мрамару -> развилка).
  // Остальные реплики между ними - best-effort клики, не критичные (страница может
  // проскочить их сама); если что-то не найдётся, просто идём дальше к развилке.
  await performStep(page, { stepName: 'Рыбный ресторан (вход)', currentTexts: ['Рыбный ресторан', 'рыбный ресторан'], retries: 3 });
  await performStep(page, { stepName: 'Тёща Кумуса', currentTexts: ['Тёща Кумуса', 'тёща кумуса'], retries: 3 });
  await tryPerformStepOptional(page, { stepName: 'Я насчет работы.', currentTexts: ['Я насчет работы.'] });
  await tryPerformStepOptional(page, { stepName: 'Скоро вернусь.', currentTexts: ['Скоро вернусь.'] });
  await tryPerformStepOptional(page, { stepName: 'Ну рассказывай где искать мрамару?', currentTexts: ['Ну рассказывай где искать мрамару?'] });
}

// Одноразовый мини-квест: открывает "Журнал наград" у Тёщи Кумуса. Без него награды за
// эскорт-квест не фиксируются (только дины). Безопасный бой с Учебным манекеном.
async function progressFishRestaurantJournal(page) {
  await goToFishRestaurant(page);

  // 15.09.2026, живая проверка: физически придя в ресторан, объекта "Как быть
  // продуктивным" на месте не оказалось (видно только "Тёща Кумуса"/"Турнир рыболовов"/
  // "Уйти") - похоже, это ротирующееся/не всегда доступное объявление, а не постоянный
  // объект. Не гадаем дальше и не долбим боем - мягко отступаем, попробуем в другой раз.
  if (!(await existsAnyText(page, ['Как быть продуктивным', 'как быть продуктивным']))) {
    console.log('Fish Restaurant journal: объявление "Как быть продуктивным" сейчас не на месте -> отступаю без боя.');
    return false;
  }

  await performStep(page, {
    stepName: 'Как быть продуктивным',
    currentTexts: ['Как быть продуктивным', 'как быть продуктивным'],
    retries: 3,
  });

  await performStep(page, {
    stepName: 'Уровень*100 дин?',
    currentTexts: ['Уровень*100 дин? Надеюсь лекция того стоит, возьмите мои деньги.'],
    retries: 3,
  });

  await performStep(page, {
    stepName: 'Лучше помнить где что полезное (до боя)',
    currentTexts: ['Лучше помнить где что полезное можно найти на заданиях.'],
    retries: 3,
  });

  console.log('Fish Restaurant journal: бой с Учебным манекеном (безопасный)');
  await fightLoop(page);
  await pause(page, 800, 1500);

  await tryPerformStepOptional(page, {
    stepName: 'Лучше помнить где что полезное (после боя)',
    currentTexts: ['Лучше помнить где что полезное можно найти на заданиях.'],
  });

  await performStep(page, {
    stepName: 'Молча уйти',
    currentTexts: ['Молча уйти', 'молча уйти'],
    retries: 3,
  });

  console.log('Fish Restaurant journal: открыт (навык ведения дневника наград получен).');
  return true;
}

// goToFishRestaurant уже доводит диалог до развилки Холмы/Болота/Опушка (живьём
// подтверждено 15.09.2026 - Паша прошёл начало вручную, "Продолжить квест" на
// location.php вывел ровно на этот выбор). Здесь только сам выбор ветки.
// Мягкий клик (tryPerformStepOptional), не жёсткий: если попытка на этой награде уже
// прерывалась раньше (recovery), "Продолжить квест" может вернуть на середину маршрута
// ПОСЛЕ развилки - тогда текста ветки уже не будет, и это нормально, а не ошибка.
async function goToFishRestaurantBranch(page, branchStepName, branchTexts) {
  await goToFishRestaurant(page);
  await tryPerformStepOptional(page, {
    stepName: branchStepName,
    currentTexts: branchTexts,
  });
}

// 15.09.2026, обнаружено на "Рыбном ресторане" (несколько живых прогонов подряд): между
// ЛЮБЫМИ двумя реальными шагами сюжета игра может вставить переменное число (замечено от
// 0 до 3+ подряд) экранов-виньеток случайного флейвор-текста ("Топи"/"На пути к болотам" и
// т.п.), каждый ровно с одной ссылкой внутри `.bBorder` - гайд их все склеивает в один шаг,
// поэтому хардкодить каждый текст по одному бессмысленно (тексты каждый раз разные и в
// разном количестве). Вызывать перед каждым performStep реального шага - кликает виньетки,
// если они есть, и молча ничего не делает, если цель уже видна.
// Site-chrome link texts that are always present and must never be mistaken for a
// vignette's "continue" link (top nav, header, footer).
const VIGNETTE_EXCLUDE_TEXTS = new Set([
  'Обновить', 'Чат', 'В игру', 'Q', 'Настройки', 'Выход', 'Друзья', 'Гильдия',
  'Правила', 'Поддержка', 'Форум', 'Личные сообщения', 'Все квесты', 'Амулет',
  'Магазин', 'Инвентарь', 'Карта', 'Почта',
]);

// Ссылки, начинающие бой. Пропуск виньеток НЕ ИМЕЕТ ПРАВА их нажимать: вход в бой - это
// решение (и оно обязано проходить через questFightHpGate), а не "продолжить рассказ".
// Живой случай 17.09.2026: в маршруте Рыбного ресторана эвристика "единственная нечужая
// ссылка" нажала "В бой!" и утащила персонажа в бой с Пятнистым аллигатором мимо всех
// гейтов. Незавершённый бой затем заблокировал игру целиком - посыпались Рыбий глаз,
// травы, все три четверговых дейлика и Q-меню (везде голый "В бой!").
const VIGNETTE_FIGHT_LINK_RE = /^(в\s*бой!?|напасть\b.*|атаковать\b.*|ударить|вступить\s+в\s+бой|принять\s+бой)$/i;

async function skipTravelVignettes(page, targetTexts, maxAttempts = 8) {
  for (let i = 0; i < maxAttempts; i++) {
    if (await existsAnyText(page, targetTexts)) return;

    // Боевой экран - это не виньетка. Кликать здесь нечего, и чем раньше выйдем, тем лучше.
    if (isBattleScreenText(await getBodyText(page))) {
      console.log('skipTravelVignettes: это боевой экран, а не виньетка -> выхожу, не кликаю.');
      return;
    }
    const clicked = await page.evaluate(() => {
      const el = document.querySelector('.bBorder a');
      if (!el) return false;
      el.click();
      return true;
    }).catch(() => false);
    if (clicked) {
      await pause(page, 800, 1500);
      continue;
    }
    // Some vignette screens don't use .bBorder at all, just a plain "Далее" link
    // (same pattern used elsewhere, e.g. boat trip screens) - fall back to it.
    const clickedNext = await clickByTexts(page, ['Далее', 'далее'], 'travel vignette (Далее)').catch(() => false);
    if (clickedNext) {
      await pause(page, 800, 1500);
      continue;
    }
    // Last resort: vignette link text is unpredictable ("Возвращаться в форт" etc.), so
    // if there is exactly ONE non-chrome link on the page, treat it as the vignette's
    // single "continue" choice. Deliberately a no-op (returns false) when 0 or 2+ such
    // links exist, so it never guesses on a real multi-option decision screen.
    const excludeArr = Array.from(VIGNETTE_EXCLUDE_TEXTS);
    const clickedLone = await page.evaluate(({ exclude, fightRe }) => {
      const re = new RegExp(fightRe, 'i');
      const links = Array.from(document.querySelectorAll('a'))
        .filter((a) => a.textContent && a.textContent.trim().length > 0)
        .filter((a) => !exclude.includes(a.textContent.trim()));
      if (links.length !== 1) return false;
      const label = links[0].textContent.trim();
      if (re.test(label)) return 'fight'; // единственная ссылка ведёт в бой - не трогаем
      links[0].click();
      return true;
    }, { exclude: excludeArr, fightRe: VIGNETTE_FIGHT_LINK_RE.source }).catch(() => false);
    if (clickedLone === 'fight') {
      console.log('skipTravelVignettes: единственная ссылка на экране начинает бой -> НЕ нажимаю, выхожу.');
      return;
    }
    if (!clickedLone) return;
    console.log('skipTravelVignettes: клик по единственной нечужой ссылке на экране (эвристика).');
    await pause(page, 800, 1500);
  }
}

// Награда №1: "Без награды" (только дины) - ветка "Болота", 3 нарастающих боя с призраком.
async function progressFishRestaurantReward1(page) {
  await goToFishRestaurantBranch(page, 'Болота', ['Веди-ка ты меня на болота']);

  await skipTravelVignettes(page, ['Идти направо за Яшкой']);
  await performStep(page, { stepName: 'Идти направо за Яшкой', currentTexts: ['Идти направо за Яшкой'], retries: 3 });

  await skipTravelVignettes(page, ['Забрать налево']);
  await performStep(page, { stepName: 'Забрать налево', currentTexts: ['Забрать налево'], retries: 3 });

  await skipTravelVignettes(page, ['Шагнуть вперёд', 'Шагнуть вперед']);
  await performStep(page, { stepName: 'Шагнуть вперёд', currentTexts: ['Шагнуть вперёд', 'Шагнуть вперед'], retries: 3 });

  await skipTravelVignettes(page, ['Мы выберем то, что нам пригодится']);
  await performStep(page, { stepName: 'Мы выберем то, что нам пригодится', currentTexts: ['Мы выберем то, что нам пригодится'], retries: 3 });

  await skipTravelVignettes(page, ['Идти к лианам']);
  await performStep(page, { stepName: 'Идти к лианам', currentTexts: ['Идти к лианам'], retries: 3 });

  await skipTravelVignettes(page, ['Попробовать встать']);
  await performStep(page, { stepName: 'Попробовать встать', currentTexts: ['Попробовать встать'], retries: 3 });

  // Три боя подряд, раньше шли вообще без проверки HP (в утреннем аудите гейтов этот маршрут
  // пропущен). waitForRecovery: маршрут эскортный и бросать его на середине нельзя - Паша,
  // 17.09.2026: "рыбный ресторан ты начинал делать и убежал на другой квест". Поэтому при
  // низком HP ждём подлечивания между боями, а не выходим из квеста.
  const FR = 'Рыбный ресторан reward #1';
  if (!(await questFightHpGate(page, `${FR} (бой 1/3)`, QUEST_FIGHT_HP_FLOOR, { waitForRecovery: true }))) return false;
  console.log('Fish Restaurant reward #1: бой 1/3 (Призрак в топях)');
  await fightLoop(page);
  await pause(page, 800, 1500);

  await skipTravelVignettes(page, ['Напасть']);
  await performStep(page, { stepName: 'Напасть (1)', currentTexts: ['Напасть'], retries: 3 });
  if (!(await questFightHpGate(page, `${FR} (бой 2/3)`, QUEST_FIGHT_HP_FLOOR, { waitForRecovery: true }))) return false;
  console.log('Fish Restaurant reward #1: бой 2/3 (сложный Призрак в топях)');
  await fightLoop(page);
  await pause(page, 800, 1500);

  await skipTravelVignettes(page, ['Напасть']);
  await performStep(page, { stepName: 'Напасть (2)', currentTexts: ['Напасть'], retries: 3 });
  if (!(await questFightHpGate(page, `${FR} (бой 3/3)`, QUEST_FIGHT_HP_FLOOR, { waitForRecovery: true }))) return false;
  console.log('Fish Restaurant reward #1: бой 3/3 (сложный Призрак в топях)');
  await fightLoop(page);

  console.log('Fish Restaurant reward #1: проход завершён.');
  return true;
}

const FISH_RESTAURANT_REWARD_HANDLERS = {
  1: progressFishRestaurantReward1,
};

// Паша, 17.09.2026: "Рыбный ресторан настроим как закончишь с дейликами". До тех пор квест
// выключен, и это не косметика: его маршрут упирается в ОБЯЗАТЕЛЬНУЮ засаду с пятнистым
// аллигатором. Защита виньеток правильно отказывается жать "В бой!", но игра всё равно
// оставляет бой висеть, а незавершённый бой блокирует игру ЦЕЛИКОМ - 17.09.2026 из-за этого
// подряд упали все три боссовых маршрута четверга (location.php отдавал голый "В бой!").
// Включать только вместе с явной обработкой засады: questFightHpGate + fightLoop.
const FISH_RESTAURANT_ENABLED = false;

async function runFishRestaurantQuestIfAvailable(page) {
  if (!FISH_RESTAURANT_ENABLED) {
    console.log('Fish Restaurant: выключен до настройки засады с аллигатором (FISH_RESTAURANT_ENABLED = false).');
    return false;
  }

  const today = getDayKeyNow();
  if (fishRestaurantDayKey !== today) {
    fishRestaurantDayKey = today;
    fishRestaurantDoneToday = false;
  }
  if (fishRestaurantDoneToday) {
    return false;
  }

  const QUEST = 'Рыбный ресторан';
  const menuOpened = await resetToQuestMenu(page);
  if (!menuOpened) {
    return false;
  }
  const qNamesNow = parseQuestNamesFromQMenuText(await getBodyText(page));
  if (!isQuestInMenu(qNamesNow, QUEST)) {
    // 15.09.2026, живой баг: формальный accept ("К месту выполнения") убирает квест из
    // общего Q-меню (как и другие "эксклюзивные" квесты - Харчевня/Штольни), но это НЕ
    // значит "недоступен на сегодня" - если предыдущая попытка упала на середине маршрута
    // (напр. на виньетке), квест остаётся в процессе и ждёт "Продолжить квест" на
    // location.php. Раньше это молча трактовалось как "квест недоступен" и весь день
    // пропадал без единой попытки резюме - проверяем эту возможность явно перед сдачей.
    await page.goto('http://lbast.ru/location.php', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    const locText = await getBodyText(page);
    if (!/Продолжить квест/i.test(locText)) {
      return false;
    }
    console.log('Fish Restaurant: не в Q-меню, но есть "Продолжить квест" - квест в процессе, резюмирую.');
  }

  // Журнал наград - опционален (без него награда за проход просто дины, а не предмет),
  // НЕ обязателен для самого эскорт-квеста (живьём подтверждено 15.09.2026 - Паша дошёл
  // до развилки Холмы/Болота/Опушка, не открывая журнал вовсе). Поэтому сначала пробуем
  // сегодняшнюю пронумерованную награду (она ограничена одной попыткой в день), а журнал -
  // только если наградный проход на сегодня уже сделан (не мешает ему, не блокирует его).
  const handler = FISH_RESTAURANT_REWARD_HANDLERS[fishRestaurantNextRewardNumber];
  if (handler) {
    // Берём фокус на время прохода: пока он держится, isExclusiveQQuestInProgress не даст
    // начать другие квесты, и маршрут доводится до конца (или до таймаута в 30 минут).
    if (!fishRestaurantFocusStartedAt) fishRestaurantFocusStartedAt = Date.now();
    const ok = await runNonQQuestSafe(page, `Fish Restaurant reward #${fishRestaurantNextRewardNumber}`, () => handler(page));
    if (ok) {
      fishRestaurantDoneToday = true;
      fishRestaurantNextRewardNumber += 1;
      fishRestaurantFocusStartedAt = 0;
      fishRestaurantSuppressedUntil = 0;
      persistDailyQuestState();
    }
    return Boolean(ok);
  }
  // Маршрута нет - держать фокус бессмысленно, иначе заблокируем остальные квесты до таймаута.
  fishRestaurantFocusStartedAt = 0;
  console.log(`Fish Restaurant: нет закодированного маршрута для награды №${fishRestaurantNextRewardNumber} - остановлено, ждёт ручного добавления.`);

  if (!fishRestaurantJournalOpened) {
    const ok = await runNonQQuestSafe(page, 'Fish Restaurant journal', () => progressFishRestaurantJournal(page));
    if (ok) {
      fishRestaurantJournalOpened = true;
      persistDailyQuestState();
      return true;
    }
    return Boolean(ok);
  }

  return false;
}

// ===================================================================================
// "Рыбий глаз" (Fish Eye) для AI__ — идентично Tsunami: тот же неQ-механизм
// (canRunFishEyeFightNow/canRunFishEyeRewardNow + runFishEyeFight/tryClaimFishEyeReward),
// который у Tsunami вызывается из doScenario. driver.js AI__ вызывает runDailyQuests
// напрямую, минуя doScenario, поэтому Fish Eye никогда не запускался — обёртка ниже
// вызывает тот же код явно, каждый цикл, независимо от Q.
// ===================================================================================
// ===================================================================================
// ДЕЙЛИКИ ПО ДНЮ НЕДЕЛИ - четверг (гайд Паши, 17.09.2026).
// Общий пролог у всех трёх: Конь -> Мисстоун -> Идти в город -> Идти на главную улицу.
//
// ВАЖНО: реализованы ТОЛЬКО безбоевые варианты. Паша: "Пока только без боя". В гайде у
// могильщика и у дома в тупике есть ещё боссы (Призрак тёщи могильщика -> Ржавая сковорода,
// Призрачная ведьма -> Коготь ведьмы) - они СОЗНАТЕЛЬНО не трогаются, пока маршрут не
// проверен живьём. Когда дойдёт до них - бой обязан идти через questFightHpGate.
//
// НЕ ПРОВЕРЕНО ВЖИВУЮ: маршруты записаны со слов, первый запуск смотреть по логам.
// ===================================================================================
async function goToMisstoneMainStreet(page) {
  // В списке коня город называется "МисТТоун" (два "т"), а в гайде было записано "Мисстоун".
  // Живой провал 17.09.2026: все три четверговых маршрута упали на этом шаге по три попытки
  // каждый ("Не найдено для шага Мисстоун"), хотя в списке рядом видно "» Мисттоун »".
  // Тот же класс ошибки, что с Эль "Вырви глаз" - принимаем оба написания.
  const MISSTONE = ['Мисттоун', 'мисттоун', 'Мисстоун', 'мисстоун'];

  await performStep(page, {
    stepName: 'Конь',
    currentTexts: ['Конь', 'конь'],
    nextTexts: MISSTONE,
    retries: 3,
  });
  await performStep(page, {
    stepName: 'Мисттоун',
    currentTexts: MISSTONE,
    waitAfterClickMs: 7000,
    retries: 3,
  });
  // Поездка длится дольше одного клика: живьём 17.09.2026 понадобилось ПЯТЬ нажатий
  // "В пути еще". Одного if-а не хватало, и следующий шаг не находился.
  for (let i = 0; i < 15; i++) {
    const t = await getBodyText(page);
    if (/Идти в город|Идти на запад/i.test(t)) break;
    if (/В пути/i.test(t)) {
      await clickByTexts(page, ['В пути еще', 'В пути ещё', 'В пути', 'в пути'], `В пути (${i + 1})`).catch(() => {});
    }
    await pause(page, 1600, 2200);
  }

  await performStep(page, { stepName: 'Идти в город', currentTexts: ['Идти в город'], retries: 3 });

  // ВАЖНО: ссылки "Идти на главную улицу" в игре НЕ СУЩЕСТВУЕТ - в гайде это было описание,
  // а не кнопка. Разведано живьём 17.09.2026: вход в город ведёт на окраину (только
  // запад/восток), и ОДИН шаг на запад - это "Мисттоун. Центральная улица", где и стоят оба
  // дома (мясника и могильщика). Восток уводит из города на "Дорогу" к замку Альянса.
  await performStep(page, { stepName: 'Идти на запад (к домам)', currentTexts: ['Идти на запад'], retries: 3 });
}

// Дом могильщика, безбоевая ветка: ... -> Идти в дом могильщика -> Идти в правую дверь ->
// квест "Разбить гробы".
async function progressGravediggerHouse(page) {
  await goToMisstoneMainStreet(page);
  await performStep(page, { stepName: 'Идти в дом могильщика', currentTexts: ['Идти в дом могильщика'], retries: 3 });
  await performStep(page, { stepName: 'Идти в правую дверь', currentTexts: ['Идти в правую дверь'], retries: 3 });
  const ok = await clickByTexts(page, ['Разбить гробы', 'разбить гробы'], 'Разбить гробы');
  if (!ok) {
    console.log('Четверг/могильщик: "Разбить гробы" не найдено - возможно, уже сделано сегодня.');
    return false;
  }
  await pause(page, 800, 1500);
  await clickByTexts(page, ['В игру', 'в игру'], 'В игру (могильщик)').catch(() => {});
  return true;
}

// Дом мясника: ... -> Идти в дом мясника -> Войти в желтую дверь -> Мясник.
async function progressButcherHouse(page) {
  await goToMisstoneMainStreet(page);
  await performStep(page, { stepName: 'Идти в дом мясника', currentTexts: ['Идти в дом мясника'], retries: 3 });
  await performStep(page, {
    stepName: 'Войти в желтую дверь',
    currentTexts: ['Войти в желтую дверь', 'Войти в жёлтую дверь'],
    retries: 3,
  });
  // Разведано живьём 17.09.2026: за жёлтой дверью "Желтая комната" с полуистлевшим трупом в
  // мясницком фартуке, и выбора там всего два - "Выскочить из комнаты" и "Атаковать".
  // Ссылки "Мясник" НЕТ: "Мясник" из гайда - это и есть босс, то есть дейлик боевой.
  // Паша: "Пока только без боя" -> не атакуем. Уходим через "Выскочить из комнаты", чтобы не
  // оставлять за собой экран с активной кнопкой боя (иначе его подберёт другой обработчик -
  // ровно так 17.09.2026 начался бой с корованом мимо всех гейтов).
  // Паша, 17.09.2026: "четверг - делай просто по гайду", то есть боссов проходим.
  // Бой обязателен через гейт; если HP не хватает - ЖДЁМ, а не бросаем (waitForRecovery),
  // иначе маршрут сюда придётся идти заново. Если в бой всё же нельзя - уходим из комнаты,
  // чтобы не оставить за собой активную кнопку "Атаковать".
  if (await existsAnyText(page, ['Атаковать'])) {
    // Паша, 17.09.2026: "то что без боя можно не ждать восстановления хп и делай пока резервы
    // есть чтобы не простаивать зря". Поэтому НЕ ждём лечения внутри маршрута: ожидание
    // держало весь цикл (живьём - 7 минут на одном боссе), пока рядом стояли доступные
    // безбоевые дела. Гейт остаётся, но при нехватке HP просто выходим и вернёмся в
    // следующем цикле - маршрут сюда дешёвый (конь + пара кликов).
    if (!(await questFightHpGate(page, 'Четверг: мясник (Желтая комната)'))) {
      await clickByTexts(page, ['Выскочить из комнаты'], 'Выскочить из комнаты').catch(() => {});
      return false;
    }
    console.log('Четверг/мясник: бой в Желтой комнате.');
    await clickByTexts(page, ['Атаковать'], 'Атаковать (мясник)');
    await fightLoop(page);
    await pause(page, 800, 1500);
    await clickByTexts(page, ['В игру', 'в игру'], 'В игру (мясник)').catch(() => {});
    return true;
  }

  const ok = await clickByTexts(page, ['Мясник', 'мясник'], 'Мясник');
  if (!ok) {
    console.log('Четверг/мясник: ни "Атаковать", ни "Мясник" не найдены - похоже, на сегодня уже сделано.');
    return false;
  }
  await pause(page, 800, 1500);
  await clickByTexts(page, ['В игру', 'в игру'], 'В игру (мясник)').catch(() => {});
  return true;
}

// Дом в тупике, безбоевая ветка: ... -> 2 раза Запад -> Свернуть в переулок -> Идти к дому ->
// Осмотреть кучу тряпья.
async function progressDeadEndHouse(page) {
  await goToMisstoneMainStreet(page);
  // От Центральной улицы (куда привёл пролог) до переулка - ещё ДВА шага на запад.
  // Разведано живьём: запад x2 - Главная улица с разломом, запад x3 - Главная улица, где
  // и появляется "Свернуть в переулок". Гайд считал шаги именно от Центральной улицы.
  for (let i = 1; i <= 2; i++) {
    await performStep(page, {
      stepName: `Идти на запад (${i}/2, к переулку)`,
      currentTexts: ['Идти на запад'],
      skipIfNextVisible: false,
      retries: 3,
    });
  }
  await performStep(page, { stepName: 'Свернуть в переулок', currentTexts: ['Свернуть в переулок'], retries: 3 });
  await performStep(page, { stepName: 'Идти к дому', currentTexts: ['Идти к дому'], retries: 3 });
  const ok = await clickByTexts(page, ['Осмотреть кучу тряпья', 'осмотреть кучу тряпья'], 'Осмотреть кучу тряпья');
  if (!ok) {
    console.log('Четверг/тупик: "Осмотреть кучу тряпья" не найдено - возможно, уже сделано сегодня.');
    return false;
  }
  await pause(page, 800, 1500);
  await clickByTexts(page, ['В игру', 'в игру'], 'В игру (тупик)').catch(() => {});
  return true;
}

// Босс могильщика (гайд): ... -> Идти в дом могильщика -> Идти в правую дверь ->
// Спуститься в чулан -> Атаковать. Призрак тёщи могильщика, даёт "Ржавую сковороду".
// НЕ ПРОВЕРЕНО ВЖИВУЮ - первый запуск смотреть по логам.
async function progressGravediggerBoss(page) {
  await goToMisstoneMainStreet(page);
  await performStep(page, { stepName: 'Идти в дом могильщика', currentTexts: ['Идти в дом могильщика'], retries: 3 });
  await performStep(page, { stepName: 'Идти в правую дверь', currentTexts: ['Идти в правую дверь'], retries: 3 });
  await performStep(page, { stepName: 'Спуститься в чулан', currentTexts: ['Спуститься в чулан'], retries: 3 });

  // Без ожидания лечения - см. комментарий у мясника: простой всего цикла дороже, чем
  // повторная поездка сюда в следующем заходе.
  if (!(await questFightHpGate(page, 'Четверг: призрак тёщи могильщика'))) {
    return false;
  }
  console.log('Четверг/могильщик: бой с призраком тёщи (ожидается "Ржавая сковорода").');
  await clickByTexts(page, ['Атаковать'], 'Атаковать (призрак тёщи)');
  await fightLoop(page);
  await pause(page, 800, 1500);
  await clickByTexts(page, ['В игру', 'в игру'], 'В игру (могильщик, босс)').catch(() => {});
  return true;
}

// Босс дома в тупике (гайд): ... -> Свернуть в переулок -> Идти к дому -> Войти в дом ->
// Войти в дверь -> Войти в комнату -> Идти в глубь комнаты -> Атаковать.
// Призрачная ведьма, даёт "Коготь ведьмы". НЕ ПРОВЕРЕНО ВЖИВУЮ.
async function progressDeadEndBoss(page) {
  await goToMisstoneMainStreet(page);
  for (let i = 1; i <= 2; i++) {
    await performStep(page, {
      stepName: `Идти на запад (${i}/2, к переулку)`,
      currentTexts: ['Идти на запад'],
      skipIfNextVisible: false,
      retries: 3,
    });
  }
  await performStep(page, { stepName: 'Свернуть в переулок', currentTexts: ['Свернуть в переулок'], retries: 3 });
  await performStep(page, { stepName: 'Идти к дому', currentTexts: ['Идти к дому'], retries: 3 });
  await performStep(page, { stepName: 'Войти в дом', currentTexts: ['Войти в дом'], retries: 3 });
  await performStep(page, { stepName: 'Войти в дверь', currentTexts: ['Войти в дверь'], retries: 3 });
  await performStep(page, { stepName: 'Войти в комнату', currentTexts: ['Войти в комнату'], retries: 3 });
  await performStep(page, { stepName: 'Идти в глубь комнаты', currentTexts: ['Идти в глубь комнаты'], retries: 3 });

  // Без ожидания лечения - см. комментарий у мясника.
  if (!(await questFightHpGate(page, 'Четверг: призрачная ведьма'))) {
    return false;
  }
  console.log('Четверг/тупик: бой с призрачной ведьмой (ожидается "Коготь ведьмы").');
  await clickByTexts(page, ['Атаковать'], 'Атаковать (призрачная ведьма)');
  await fightLoop(page);
  await pause(page, 800, 1500);
  await clickByTexts(page, ['В игру', 'в игру'], 'В игру (тупик, босс)').catch(() => {});
  return true;
}

// Меню ежедневных заданий (ссылка "D<N>" на локации -> location.php?r=NNNN&mod=daily).
// Разобрано живьём 17.09.2026 по скриншоту Паши: строки имеют вид "1/4 Обыскать дом мясника
// в Мисттоуне", то есть игра САМА показывает прогресс. Это единственный надёжный источник:
// свои булевы флаги в state.json меня подвели - я пометил цель выполненной после одного
// прохода и объявил четверг закрытым, когда на деле было 1/4.
// r= меняется при каждой загрузке, поэтому href берём со свежей страницы, а не хардкодим.
async function readDailyTasksProgress(page) {
  await page.goto('http://lbast.ru/location.php', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  const href = await page
    .evaluate(() => {
      const a = Array.from(document.querySelectorAll('a'))
        .find((x) => (x.getAttribute('href') || '').includes('mod=daily'));
      return a ? a.getAttribute('href') : null;
    })
    .catch(() => null);

  if (!href) {
    console.log('Дейлики: ссылка на меню ежедневных заданий не найдена.');
    return [];
  }

  await page.goto(`http://lbast.ru/${href.replace(/^\//, '')}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await pause(page, 400, 800);

  const text = await getBodyText(page);
  const tasks = [];
  for (const line of text.split('\n')) {
    const m = line.trim().match(/^(\d+)\s*\/\s*(\d+)\s+(.+)$/);
    if (!m) continue;
    tasks.push({ done: Number(m[1]), total: Number(m[2]), title: m[3].trim() });
  }

  // ОБЯЗАТЕЛЬНО вернуться на локацию. Живой баг 17.09.2026: функция оставляла страницу на
  // меню дейликов, и следующий же маршрут падал на первом шаге - "Не найден шаг Мисттоун
  // (url=...&mod=daily)", потому что ссылки "Конь" в меню нет. Первый маршрут срывался,
  // второй проходил только потому, что после recoverToCity мы случайно оказывались в городе.
  await page.goto('http://lbast.ru/location.php', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  await pause(page, 300, 700);

  return tasks;
}

// Квестовая сцена может оставить персонажа "внутри себя": location.php отдаёт не локацию, а
// экран сцены. Живой случай 17.09.2026 - Чулан дома могильщика ("Убежать" / "Атаковать").
// Шапки со статами там нет и ссылки Q нет, поэтому сыплется ВЕСЬ цикл: parseStats даёт
// null/null, "Не найдено для шага open quests menu", runDailyQuests возвращает пустоту.
// Внешне похоже на автобан или на залипший бой, но это ни то, ни другое.
// Выход из таких сцен всегда безопасный. Бой отсюда НЕ начинаем: это решение, и оно обязано
// идти через questFightHpGate, а не через "нажми хоть что-нибудь".
const STUCK_SCENE_EXITS = ['Убежать', 'Выскочить из комнаты', 'Выйти из дома', 'Вернуться', 'Уйти'];

// Висящий бой посреди цикла. Симптом: location.php отдаёт голый "В бой!" со ссылкой boj=,
// статов нет, Q-меню нет - и весь остаток цикла идёт вслепую (null/null). 18.09.2026 так
// запирало игру трижды за утро (Харчевня, Корованы, засада Телохранителя у банкира), и каждый
// раз вытаскивал вручную. Вариантов у такого экрана ровно два:
//  - бой уже ЗАВЕРШЁН, но итог не подтверждён (игра держит персонажа, HP не растёт) -> подтвердить;
//  - бой идёт -> только довести. Отказаться нельзя, а ждать HP бессмысленно: в бою оно почти
//    не растёт (+18 за 40 минут). fightLoop сам пьёт эликсиры с пояса при низком HP.
async function resolvePendingFightIfAny(page) {
  await page.goto('http://lbast.ru/location.php', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  const boj = await page.evaluate(() => {
    const a = Array.from(document.querySelectorAll('a')).find((x) => (x.getAttribute('href') || '').includes('boj='));
    return a ? a.getAttribute('href') : null;
  }).catch(() => null);
  if (!boj) return false;

  await page.goto(`http://lbast.ru/${boj.replace(/^\//, '')}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  const text = await getBodyText(page);
  if (/Бой завершен/i.test(text)) {
    console.log('Висящий бой: он уже завершён, подтверждаю итог.');
    await clickByTexts(page, ['Бой завершен!', 'Бой завершен'], 'Бой завершен (подтверждение итога)').catch(() => {});
    return true;
  }
  if (!/Ударить/i.test(text)) {
    console.log('Висящий бой: экран боя без "Ударить" и без итога - не понимаю, что это, не трогаю.');
    return false;
  }
  // Нападение живого игрока (латинский ник) отдаём handleIncomingAttackIfAny - там оповещение.
  const foe = (text.match(/VS\.\s*\n\s*([^\n\[]+?)\s*\[\d+\]/) || [])[1] || '';
  if (/^[A-Za-z0-9_.-]+$/.test(foe)) {
    console.log(`Висящий бой: противник похож на игрока (${foe}) -> отдаю обработчику нападений.`);
    return false;
  }
  const me = text.match(/AI__\s*\[\d+\]\s*\((-?\d+)\s*\/\s*(\d+)\)/);
  console.log(`Висящий бой: идёт (HP ${me ? me[1] + '/' + me[2] : '?'}) -> довожу, другого выхода из него нет.`);
  await fightLoop(page);
  return true;
}

async function escapeStuckSceneIfAny(page) {
  const text = await getBodyText(page);
  if (isBattleScreenText(text)) return false; // это бой - им занимается другой код

  // ВАЖНО: определять сцену по отсутствию шапки со статами НЕЛЬЗЯ. Живая проверка 17.09.2026:
  // в Чулане шапка была на месте - "AI__ (245/380) (23) Q9 D6", - и такая проверка молча
  // пропустила бы застревание. Надёжный признак: на обычной локации есть ссылка на меню
  // квестов (mod=quests), а внутри квестовой сцены её нет.
  const onNormalLocation = await page
    .evaluate(() => Boolean(document.querySelector('a[href*="mod=quests"]')))
    .catch(() => true); // не смогли проверить - считаем, что всё нормально, и не трогаем
  if (onNormalLocation) return false;

  for (const exit of STUCK_SCENE_EXITS) {
    if (await existsAnyText(page, [exit])) {
      console.log(`Залипшая сцена: выхожу через "${exit}" (шапки со статами нет, Q недоступно).`);
      await clickByTexts(page, [exit], `выход из сцены (${exit})`).catch(() => {});
      await pause(page, 600, 1200);
      await page.goto('http://lbast.ru/location.php', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
      return true;
    }
  }
  return false;
}

// Сопоставление строк меню дейликов с маршрутами. Названия в меню (снято со скриншота Паши
// 17.09.2026): "Обыскать дом могильщика в Мисттоуне", "Обыскать дом мясника в Мисттоуне",
// "Обыскать дом в тупике в Мисттоуне".
// Для могильщика и тупика берём БЕЗБОЕВЫЕ ветки: они не тратят HP и не упираются в гейт, а
// засчитываются так же. У мясника безбоевого пути нет вовсе - за жёлтой дверью только
// "Атаковать", - поэтому там маршрут с боем и гейтом.
const THURSDAY_TASK_ROUTES = [
  { re: /дом\s+могильщика/i, label: 'Дом могильщика', fn: (p) => progressGravediggerHouse(p) },
  { re: /дом\s+мясника/i, label: 'Дом мясника', fn: (p) => progressButcherHouse(p) },
  { re: /дом\s+в\s+тупике/i, label: 'Дом в тупике', fn: (p) => progressDeadEndHouse(p) },
];

async function runThursdayDailiesIfAvailable(page) {
  if (getWeekday() !== THURSDAY_WEEKDAY) {
    return false; // сегодня не четверг - этих дейликов просто нет
  }

  // ИСТОЧНИК ИСТИНЫ - САМА ИГРА, а не наши флаги. Паша, 17.09.2026, прислал скриншот меню
  // дейликов: "1/2 Собрать два эликсира...", "1/4 Обыскать дом мясника", "2/4 Обыскать дом в
  // тупике". Эти задания МНОГОКРАТНЫЕ, а прежний код помечал цель выполненной после одного
  // прохода - и я на этом основании объявил четверг закрытым при 1/4. Поля
  // thursdayDailiesDone в state.json больше не участвуют в решениях (оставлены как история).
  const tasks = await readDailyTasksProgress(page);
  if (!tasks.length) {
    console.log('Четверг: меню ежедневных заданий не прочиталось - пропускаю в этом цикле.');
    return false;
  }

  console.log(`Дейлики дня: ${tasks.map((t) => `${t.done}/${t.total} ${t.title}`).join(' | ')}`);

  const pending = tasks.filter((t) => t.done < t.total);
  if (!pending.length) {
    console.log('Четверг: все ежедневные задания закрыты.');
    return false;
  }

  // По ОДНОМУ заходу на цель за цикл. Четыре подряд надолго заняли бы драйвер, а Паша просил
  // не простаивать: "делай пока резервы есть чтобы не простаивать зря". Остаток доберём в
  // следующих циклах - счётчик игры сам покажет, когда цель закрыта.
  let didAnything = false;
  for (const t of pending) {
    const route = THURSDAY_TASK_ROUTES.find((r) => r.re.test(t.title));
    if (!route) continue; // например "Собрать два эликсира с дерева жизни" - это квест Дерево жизни

    const ok = await runNonQQuestSafe(page, `Четверг: ${route.label} (${t.done}/${t.total})`, () => route.fn(page));
    if (ok) {
      didAnything = true;
      console.log(`Четверг: заход в "${route.label}" выполнен (было ${t.done}/${t.total}).`);
    }
  }
  return didAnything;
}

async function runFishEyeIfDue(page) {
  let didAnything = false;

  if (canRunFishEyeRewardNow()) {
    const rewardResult = await runNonQQuestSafe(page, 'Fish Eye reward', () => tryClaimFishEyeReward(page));
    if (rewardResult === null) {
      lastFishEyeRunAt = Date.now();
    } else if (rewardResult) {
      didAnything = true;
    }
  }

  if (canRunFishEyeFightNow()) {
    const fightResult = await runNonQQuestSafe(page, 'Fish Eye fight', () => runFishEyeFight(page));
    if (fightResult === null) {
      lastFishEyeRunAt = Date.now();
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
// "Подвалы" (Южные ворота Стоунгарда) — альтернативная фарм-точка для AI__ (крысы/слизняки),
// найдена и задокументирована 14.09.2026 в LESSONS_AI_CHAR.md. В отличие от Fish Eye/гильдии
// это НЕ уникальный игровой механизм, а обычный repeat-farm объект — используется просто как
// "чем заняться, когда с квестами/Fish Eye на этот цикл всё сделано".
// ===================================================================================
// 15.09.2026, Паша: "не нравится что при не сделаных квестах АИ бежит фармить подвалы" —
// живой случай: вошли в Подвалы на HP>=50%, один бой (даже с сработавшим эликсиром) снёс
// HP до 34/340 (10%) - после этого ассасин(70%)/Рыбный ресторан/Рыбий глаз(50%) блокировались
// много циклов подряд, пока HP медленно (16/мин) восстанавливалось - выглядело как "бот
// бросил квесты и фармит", хотя на самом деле сам фарм и съел HP, нужный квестам. Подняли
// порог до 0.7 (тот же вывод, что и для банкира/Рыбьего глаза) и срезали число боёв за
// раунд до 1, чтобы Подвалы не могли утащить HP ниже уровня, нужного реальным квестам.
const PODVALY_HP_SAFETY_FRACTION = 0.7; // не начинать новый бой ниже этой доли от макс. HP
const PODVALY_MAX_FIGHTS_PER_ROUND = 1; // не более N боёв за один вызов из driver.js
// "Штольни" требуют SHTOLNI_MIN_HP_FRACTION=0.99 - если Подвалы фармят всё, что выше 70%,
// они постоянно сбивают HP обратно вниз и не дают дойти до 99%, из-за чего Штольни для
// AI__ фактически никогда не запускались. Верхний потолок резервирует "почти полное" HP
// именно для таких требовательных квестов вместо того, чтобы тратить его на обычный фарм.
const PODVALY_HP_CEILING_FRACTION = 0.9; // не фармить выше этой доли - беречь HP для Штолен

async function enterPodvaly(page) {
  const stoneUrl = 'http://lbast.ru/location.php?mod=konj&lway=1';
  await page.goto(stoneUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await waitOutHorseTravel(page, stoneUrl);

  let text = await getBodyText(page);
  if (!/подвал/i.test(text)) {
    await page.goto('http://lbast.ru/location.php?idem=1', { waitUntil: 'domcontentloaded', timeout: 60000 });
    text = await getBodyText(page);
  }

  if (!(await existsAnyText(page, ['В подвалы']))) {
    console.log('Podvaly farm: "В подвалы" не найдено на этой клетке.');
    return false;
  }

  await clickByTexts(page, ['В подвалы'], 'В подвалы');
  await pause(page, 800, 1400);
  return true;
}

async function runPodvalyFarmRound(page) {
  // A prior dispatcher (Demon Lake, Shipwreck, ...) may have left us on location.php?mod=quests,
  // whose header doesn't render the "Name (HP/HPMax)" tuple parseStats expects — reading stats
  // straight off whatever page we inherited silently returns null/null and skips farming for the
  // whole cycle. Found 14.09.2026 after AI__ stood idle for over an hour with full HP available.
  await page.goto('http://lbast.ru/location.php', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  const stats0 = parseStats(await getBodyText(page));
  if (
    typeof stats0.hpCurrent !== 'number' ||
    typeof stats0.hpMax !== 'number' ||
    stats0.hpCurrent <= 0 ||
    stats0.hpCurrent < stats0.hpMax * PODVALY_HP_SAFETY_FRACTION
  ) {
    return false;
  }
  if (stats0.hpCurrent >= stats0.hpMax * PODVALY_HP_CEILING_FRACTION) {
    console.log(`Podvaly farm: HP ${stats0.hpCurrent}/${stats0.hpMax} уже близко к максимуму - берегу для Штолен, не фармлю.`);
    return false;
  }

  const entered = await enterPodvaly(page);
  if (!entered) return false;

  let didAnything = false;
  for (let i = 0; i < PODVALY_MAX_FIGHTS_PER_ROUND; i++) {
    const stats = parseStats(await getBodyText(page));
    if (typeof stats.hpCurrent !== 'number' || typeof stats.hpMax !== 'number') break;
    if (stats.hpCurrent <= 0) break;
    if (stats.hpCurrent < stats.hpMax * PODVALY_HP_SAFETY_FRACTION) break;

    const okOsmotret = await clickByTexts(page, ['Осмотреть подвалы'], 'Осмотреть подвалы');
    if (!okOsmotret) break;
    await pause(page, 700, 1200);

    const okAttack = await clickByTexts(page, ['Атаковать'], 'Атаковать');
    if (!okAttack) {
      await pause(page, 800, 1400);
      continue;
    }

    const won = await fightLoop(page).catch((e) => {
      console.log('Podvaly farm: fightLoop error:', e.message);
      return null;
    });
    console.log('Podvaly farm: fightLoop result:', won);
    didAnything = true;
    await pause(page, 800, 1400);
  }

  return didAnything;
}

// ===================================================================================
// Гарпия — новая фарм-точка вместо Подвалов (15.09.2026, Паша: "меняем точку фарма, вместо
// подвала - гарпия"). Маршрут продиктован Пашей: Конь -> Горы Дарии -> Запад -> Гнёзда гарпии.
// "Горы Дарии" - тот же перекрёсток, что и в goRouteToGoblins выше, только оттуда нужно на
// запад, а не на север. Бой ни разу не проверен вживую -> держим консервативный floor (как
// у Подвалов), пока не увидим реальный урон. НЕТ ceiling-гейта: тот был нужен только чтобы
// беречь HP для Штолен, а Штольни отложены (SHTOLNI_ENABLED_FOR_AI=false, см. Пашу
// 15.09.2026 "штольни мы отложили на потом, их пока не делаем") - резервировать HP для
// квеста, который не запускается, только мешает нормально фармить. Если Штольни когда-то
// включат обратно, вернуть ceiling здесь тогда же.
// ===================================================================================
// Снижено 0.7->0.55 (15.09.2026, прямая просьба Паши после замера урона ниже). Риск
// осознан и явно проговорён: при входе на 55% (187/340) и повторении уже виденного удара
// в 172 останется ~15 HP (4%) - почти без запаса. Решение всё равно принято сознательно,
// не менять обратно без явной новой просьбы.
const HARPY_HP_SAFETY_FRACTION = 0.55;
// Замерено вживую 15.09.2026 (Паша просил прикинуть "оптимальный отдых"): 2 боя подряд
// дали урон 12 и 172 (!) - разброс огромный, 172 - это больше половины макс. HP (340) за
// ОДИН бой, при входе на честных 70%. Фиксированного "оптимального числа боёв подряд" не
// существует - урон гарпии слишком нестабилен (тот же паттерн бёрст-урона, что уже ломал
// 50%- и 70%-гейты у Fish Eye/ассасинов, см. память). Единственная реальная защита -
// floor (сейчас 0.55) проверяется ПЕРЕД каждым боем, а не только один раз на весь раунд.
// Число боёв в день теперь берётся из HARPY_HUNTS_PER_DAY (см. выше в файле, порт с
// Цунами commit fb9dea7, 16.09.2026) вместо фиксированного числа за раунд.

function isHarpyLocation(text) {
  // Real location name is "Кровавый пик" (confirmed live 15.09.2026), which has a
  // "Гнезда гарпий" link - NOT "Гнёзда гарпии"/"Гнезда гарпии" as first guessed from
  // Pasha's spoken route, which caused the first live attempt to fail with
  // fight_not_reached (route walked fine up to here, then found no matching link/fight).
  return /Кровавый пик/i.test(String(text || '')) || /Гнезда гарпий/i.test(String(text || ''));
}

async function goRouteToHarpy(page) {
  const HORSE = 'Конь';
  const DARIA = 'Горы Дарии';
  const V_PUTI = 'В пути';
  const V_PUTI_ESHE = 'В пути еще';
  const V_PUTI_ESHYO = 'В пути ещё';
  const WEST = 'Идти на запад';
  const NESTS = 'Гнезда гарпий';
  const UDAR = 'Ударить';
  const DONE = 'Бой завершен!';

  await performStep(page, {
    stepName: HORSE,
    currentTexts: [HORSE, HORSE.toLowerCase()],
    nextTexts: [DARIA, DARIA.toLowerCase()],
    retries: 3,
  });

  await performStep(page, {
    stepName: DARIA,
    currentTexts: [DARIA, DARIA.toLowerCase()],
    waitAfterClickMs: 7000,
    nextTexts: [
      V_PUTI, V_PUTI.toLowerCase(),
      V_PUTI_ESHE, V_PUTI_ESHE.toLowerCase(),
      V_PUTI_ESHYO, V_PUTI_ESHYO.toLowerCase(),
      WEST, WEST.toLowerCase(),
      NESTS, NESTS.toLowerCase(),
      UDAR, UDAR.toLowerCase(),
      DONE,
    ],
    retries: 3,
  });

  await tryPerformStepOptional(page, {
    stepName: V_PUTI,
    currentTexts: [
      V_PUTI_ESHE, V_PUTI_ESHE.toLowerCase(),
      V_PUTI_ESHYO, V_PUTI_ESHYO.toLowerCase(),
      V_PUTI, V_PUTI.toLowerCase(),
    ],
    nextTexts: [WEST, WEST.toLowerCase(), NESTS, NESTS.toLowerCase(), UDAR, UDAR.toLowerCase(), DONE],
  });

  await tryPerformStepOptional(page, {
    stepName: WEST,
    currentTexts: [WEST, WEST.toLowerCase()],
    nextTexts: [NESTS, NESTS.toLowerCase(), UDAR, UDAR.toLowerCase(), DONE],
  });

  await pause(page, 800, 1600);
}

async function openHarpyFight(page) {
  const NESTS = 'Гнезда гарпий';
  const V_BOY = 'В бой!';
  const UDAR = 'Ударить';
  const DONE = 'Бой завершен!';

  const text = await getBodyText(page);
  if (!new RegExp(UDAR, 'i').test(text) && !new RegExp(DONE, 'i').test(text)) {
    await tryPerformStepOptional(page, {
      stepName: NESTS,
      currentTexts: [NESTS, NESTS.toLowerCase()],
      nextTexts: [V_BOY, V_BOY.toLowerCase(), 'В бой', 'в бой', UDAR, UDAR.toLowerCase(), DONE],
    });
  }

  const textAfter = await getBodyText(page);
  if ((/В бой!/i.test(textAfter) || /В бой\b/i.test(textAfter)) && !new RegExp(UDAR, 'i').test(textAfter)) {
    await performStep(page, {
      stepName: V_BOY,
      currentTexts: [
        V_BOY, V_BOY.toLowerCase(),
        'В бой', 'в бой',
        'Вступить в бой', 'вступить в бой',
        'Принять бой', 'принять бой',
      ],
      nextTexts: [UDAR, UDAR.toLowerCase(), DONE],
      retries: 4,
    });
  }

  await pause(page, 1000, 2000);
}

async function runHarpyFarmRound(page, buffed = false) {
  if (getWeekday() !== HARPY_HUNT_WEEKDAY) {
    return false; // сегодня не вторник - гарпии не дейлик, а не "уже сделано"
  }
  resetHuntStateIfNewDay();
  if (harpyHuntFightsToday >= HARPY_HUNTS_PER_DAY) {
    return false;
  }

  const floor = buffed ? HP_FLOOR_WITH_BUFF : HARPY_HP_SAFETY_FRACTION;

  await page.goto('http://lbast.ru/location.php', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  const stats0 = parseStats(await getBodyText(page));
  if (
    typeof stats0.hpCurrent !== 'number' ||
    typeof stats0.hpMax !== 'number' ||
    stats0.hpCurrent <= 0 ||
    stats0.hpCurrent < stats0.hpMax * floor
  ) {
    return false;
  }
  const text0 = await getBodyText(page);
  if (!isHarpyLocation(text0)) {
    await goRouteToHarpy(page).catch((e) => {
      console.log('Harpy farm: маршрут не пройден:', e.message);
    });
  }

  let didAnything = false;
  for (let i = harpyHuntFightsToday; i < HARPY_HUNTS_PER_DAY; i++) {
    const stats = parseStats(await getBodyText(page));
    if (typeof stats.hpCurrent !== 'number' || typeof stats.hpMax !== 'number') break;
    if (stats.hpCurrent <= 0) break;
    if (stats.hpCurrent < stats.hpMax * floor) break;

    const hpBefore = stats.hpCurrent;
    await openHarpyFight(page).catch((e) => {
      console.log('Harpy farm: не удалось начать бой:', e.message);
    });

    let won;
    try {
      won = await fightLoop(page);
    } catch (e) {
      const waitMinutes = parseCooldownError(e);
      if (waitMinutes !== null) {
        console.log(`Harpy farm: гарпии ещё на кулдауне (${waitMinutes} мин, сделано ${i}/${HARPY_HUNTS_PER_DAY}) -> отложу оставшиеся бои до следующего цикла`);
        harpyHuntFightsToday = i;
        persistDailyQuestState();
        return didAnything;
      }
      console.log('Harpy farm: fightLoop error:', e.message);
      won = null;
    }

    const statsAfter = parseStats(await getBodyText(page));
    const hpAfter = typeof statsAfter.hpCurrent === 'number' ? statsAfter.hpCurrent : null;
    const delta = hpAfter !== null ? hpBefore - hpAfter : null;
    console.log(`Harpy farm: fight #${i + 1}/${HARPY_HUNTS_PER_DAY} result=${won} HP ${hpBefore}->${hpAfter} (урон за бой: ${delta})`);
    didAnything = true;
    harpyHuntFightsToday = i + 1;
    persistDailyQuestState();
    await pause(page, 800, 1400);
  }

  return didAnything;
}

// ===================================================================================
// Бизон — новая фарм-точка вместо Гарпии (15.09.2026, Паша: "меняем точку фарма на
// бизона", маршрут: Амулет -> Дорожный крест -> Восток -> Восток -> Охотиться). Реальный
// текст проверен read-only диагностикой (тот же урок, что и с Гарпией - не доверять
// пересказу дословно без проверки): "Дорожный крест" -> "Идти на восток" -> "Дорога" ->
// "Идти на восток" -> "Поле" (описание про диких бизонов) -> "Охотиться". Клик "Амулет"
// не используется намеренно (известный баг с латинской "A", см. LESSONS/память) - вместо
// этого прямой fastway URL lway=9 (тот же, что уже был у Demon Lake - DEMON_LAKE_FASTWAY_URL).
// Урон бизона НЕ известен вообще (0 замеров) -> начинаем с консервативного floor 0.7, как
// начинали с Гарпией, пока не наберётся статистика.
// ===================================================================================
const BISON_HP_SAFETY_FRACTION = 0.7;
// Число боёв в день берётся из BISON_HUNTS_PER_DAY (см. выше в файле, порт с Цунами
// commit fb9dea7, 16.09.2026) вместо фиксированного числа за раунд.

function isBisonLocation(text) {
  return /Поле/i.test(String(text || '')) && /бизон/i.test(String(text || ''));
}

async function goRouteToBison(page) {
  await page.goto(DEMON_LAKE_FASTWAY_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await pause(page, 500, 900);

  // skipIfNextVisible:false обязателен здесь: и текущий, и следующий шаг называются
  // одинаково ("Идти на восток"), а этот текст уже виден на "Дорожный крест" ДО клика -
  // с дефолтным skipIfNextVisible=true шаг ложно считал себя уже пройденным и не кликал
  // вообще, оставляя маршрут на один хоп короче ("Дорога" вместо "Поле", fight_not_reached
  // при попытке "Охотиться"). Обнаружено вживую 16.09.2026.
  await performStep(page, {
    stepName: 'Идти на восток (1)',
    currentTexts: ['Идти на восток', 'идти на восток'],
    nextTexts: ['Охотиться', 'охотиться'],
    skipIfNextVisible: false,
    retries: 3,
  });

  await performStep(page, {
    stepName: 'Идти на восток (2)',
    currentTexts: ['Идти на восток', 'идти на восток'],
    nextTexts: ['Охотиться', 'охотиться'],
    retries: 3,
  });

  await pause(page, 800, 1600);
}

async function openBisonFight(page) {
  const HUNT = 'Охотиться';
  const V_BOY = 'В бой!';
  const UDAR = 'Ударить';
  const DONE = 'Бой завершен!';

  const text = await getBodyText(page);
  if (!new RegExp(UDAR, 'i').test(text) && !new RegExp(DONE, 'i').test(text)) {
    await tryPerformStepOptional(page, {
      stepName: HUNT,
      currentTexts: [HUNT, HUNT.toLowerCase()],
      nextTexts: [V_BOY, V_BOY.toLowerCase(), 'В бой', 'в бой', UDAR, UDAR.toLowerCase(), DONE],
    });
  }

  const textAfter = await getBodyText(page);
  if ((/В бой!/i.test(textAfter) || /В бой\b/i.test(textAfter)) && !new RegExp(UDAR, 'i').test(textAfter)) {
    await performStep(page, {
      stepName: V_BOY,
      currentTexts: [
        V_BOY, V_BOY.toLowerCase(),
        'В бой', 'в бой',
        'Вступить в бой', 'вступить в бой',
        'Принять бой', 'принять бой',
      ],
      nextTexts: [UDAR, UDAR.toLowerCase(), DONE],
      retries: 4,
    });
  }

  await pause(page, 1000, 2000);
}

// 16.09.2026, Паша (после ручного прохождения дневной нормы бизона): "продолжай фарм на
// бизоне и кабане (теперь это обычный фарм)" - за пределами дневного бонуса (среда x2/
// воскресенье x3, см. HARPY/BISON_HUNT_WEEKDAYS выше) бизон и кабан остаются обычными
// фармящимися мобами без ограничения по числу боёв - единственный реальный гейт это
// игровой кулдаун по цели (fight_target_cooldown, тот же механизм). Дневной счётчик/гейт
// по дню недели больше НЕ применяется к фарму - вызывается каждый цикл как обычный
// repeat-farm (1 бой за вызов, как Подвалы раньше).
async function runBisonFarmRound(page, buffed = false) {
  const floor = buffed ? HP_FLOOR_WITH_BUFF : BISON_HP_SAFETY_FRACTION;

  await page.goto('http://lbast.ru/location.php', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  const stats0 = parseStats(await getBodyText(page));
  if (
    typeof stats0.hpCurrent !== 'number' ||
    typeof stats0.hpMax !== 'number' ||
    stats0.hpCurrent <= 0 ||
    stats0.hpCurrent < stats0.hpMax * floor
  ) {
    return false;
  }

  const text0 = await getBodyText(page);
  if (!isBisonLocation(text0)) {
    await goRouteToBison(page).catch((e) => {
      console.log('Bison farm: маршрут не пройден:', e.message);
    });
  }

  const stats = parseStats(await getBodyText(page));
  if (
    typeof stats.hpCurrent !== 'number' ||
    typeof stats.hpMax !== 'number' ||
    stats.hpCurrent <= 0 ||
    stats.hpCurrent < stats.hpMax * floor
  ) {
    return false;
  }

  const hpBefore = stats.hpCurrent;
  await openBisonFight(page).catch((e) => {
    console.log('Bison farm: не удалось начать бой:', e.message);
  });

  let won;
  try {
    won = await fightLoop(page);
  } catch (e) {
    const waitMinutes = parseCooldownError(e);
    if (waitMinutes !== null) {
      console.log(`Bison farm: бизон ещё на кулдауне (${waitMinutes} мин) -> попробую в следующем цикле`);
      return false;
    }
    console.log('Bison farm: fightLoop error:', e.message);
    won = null;
  }

  const statsAfter = parseStats(await getBodyText(page));
  const hpAfter = typeof statsAfter.hpCurrent === 'number' ? statsAfter.hpCurrent : null;
  const delta = hpAfter !== null ? hpBefore - hpAfter : null;
  console.log(`Bison farm: fight result=${won} HP ${hpBefore}->${hpAfter} (урон за бой: ${delta})`);
  return true;
}

// Кабан (общий репит-фарм, 16.09.2026, порт маршрута с Цунами commit fb9dea7): Конь ->
// Леса Эльсены -> (В пути) -> Запад -> Юг -> Напасть на кабана. ВАЖНО: "Юг" ведёт к волчьей
// поляне и виден на промежуточной странице ДО клика "Запад" - skipIfNextVisible обязан
// быть false на шаге "Запад", иначе ложно пропустит клик и уведёт к волкам вместо кабана
// (тот же класс бага, что уже чинили для Бизона).
const BOAR_HP_SAFETY_FRACTION = 0.7; // урон не измерен - консервативно, как стартовые Гарпия/Бизон

function isBoarLocation(text) {
  return /Напасть на кабана/i.test(String(text || ''));
}

async function goRouteToBoar(page) {
  const HORSE = 'Конь';
  const ELSENA = 'Леса Эльсены';
  const V_PUTI = 'В пути';
  const V_PUTI_E = 'В пути еще';
  const V_PUTI_Y = 'В пути ещё';
  const WEST = 'Запад';
  const SOUTH = 'Юг';
  const ATTACK_BOAR = 'Напасть на кабана';

  await performStep(page, {
    stepName: HORSE,
    currentTexts: [HORSE, HORSE.toLowerCase()],
    nextTexts: [ELSENA, ELSENA.toLowerCase()],
    retries: 3,
  });

  await performStep(page, {
    stepName: ELSENA,
    currentTexts: [ELSENA, ELSENA.toLowerCase()],
    waitAfterClickMs: 7000,
    nextTexts: [
      V_PUTI, V_PUTI.toLowerCase(),
      V_PUTI_E, V_PUTI_E.toLowerCase(),
      V_PUTI_Y, V_PUTI_Y.toLowerCase(),
      WEST, WEST.toLowerCase(),
    ],
    retries: 3,
  });

  await tryPerformStepOptional(page, {
    stepName: V_PUTI,
    currentTexts: [
      V_PUTI_E, V_PUTI_E.toLowerCase(),
      V_PUTI_Y, V_PUTI_Y.toLowerCase(),
      V_PUTI, V_PUTI.toLowerCase(),
    ],
    nextTexts: [WEST, WEST.toLowerCase()],
  });

  await performStep(page, {
    stepName: WEST,
    currentTexts: [WEST, WEST.toLowerCase()],
    nextTexts: [SOUTH, SOUTH.toLowerCase()],
    retries: 3,
    skipIfNextVisible: false,
  });

  await performStep(page, {
    stepName: SOUTH,
    currentTexts: [SOUTH, SOUTH.toLowerCase()],
    nextTexts: [ATTACK_BOAR, ATTACK_BOAR.toLowerCase()],
    retries: 3,
  });

  await pause(page, 800, 1600);
}

async function openBoarFight(page) {
  const ATTACK_BOAR = 'Напасть на кабана';
  const V_BOY = 'В бой!';
  const UDAR = 'Ударить';
  const DONE = 'Бой завершен!';

  const text = await getBodyText(page);
  if (!new RegExp(UDAR, 'i').test(text) && !new RegExp(DONE, 'i').test(text)) {
    await tryPerformStepOptional(page, {
      stepName: ATTACK_BOAR,
      currentTexts: [ATTACK_BOAR, ATTACK_BOAR.toLowerCase()],
      nextTexts: [V_BOY, V_BOY.toLowerCase(), 'В бой', 'в бой', UDAR, UDAR.toLowerCase(), DONE],
    });
  }

  const textAfter = await getBodyText(page);
  if ((/В бой!/i.test(textAfter) || /В бой\b/i.test(textAfter)) && !new RegExp(UDAR, 'i').test(textAfter)) {
    await performStep(page, {
      stepName: V_BOY,
      currentTexts: [
        V_BOY, V_BOY.toLowerCase(),
        'В бой', 'в бой',
        'Вступить в бой', 'вступить в бой',
        'Принять бой', 'принять бой',
      ],
      nextTexts: [UDAR, UDAR.toLowerCase(), DONE],
      retries: 4,
    });
  }

  await pause(page, 1000, 2000);
}

async function runBoarFarmRound(page, buffed = false) {
  const floor = buffed ? HP_FLOOR_WITH_BUFF : BOAR_HP_SAFETY_FRACTION;

  await page.goto('http://lbast.ru/location.php', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  const stats0 = parseStats(await getBodyText(page));
  if (
    typeof stats0.hpCurrent !== 'number' ||
    typeof stats0.hpMax !== 'number' ||
    stats0.hpCurrent <= 0 ||
    stats0.hpCurrent < stats0.hpMax * floor
  ) {
    return false;
  }

  const text0 = await getBodyText(page);
  if (!isBoarLocation(text0)) {
    await goRouteToBoar(page).catch((e) => {
      console.log('Boar farm: маршрут не пройден:', e.message);
    });
  }

  const stats = parseStats(await getBodyText(page));
  if (
    typeof stats.hpCurrent !== 'number' ||
    typeof stats.hpMax !== 'number' ||
    stats.hpCurrent <= 0 ||
    stats.hpCurrent < stats.hpMax * floor
  ) {
    return false;
  }

  const hpBefore = stats.hpCurrent;
  await openBoarFight(page).catch((e) => {
    console.log('Boar farm: не удалось начать бой:', e.message);
  });

  let won;
  try {
    won = await fightLoop(page);
  } catch (e) {
    const waitMinutes = parseCooldownError(e);
    if (waitMinutes !== null) {
      console.log(`Boar farm: кабан ещё на кулдауне (${waitMinutes} мин) -> попробую в следующем цикле`);
      return false;
    }
    console.log('Boar farm: fightLoop error:', e.message);
    won = null;
  }

  const statsAfter = parseStats(await getBodyText(page));
  const hpAfter = typeof statsAfter.hpCurrent === 'number' ? statsAfter.hpCurrent : null;
  const delta = hpAfter !== null ? hpBefore - hpAfter : null;
  console.log(`Boar farm: fight result=${won} HP ${hpBefore}->${hpAfter} (урон за бой: ${delta})`);
  return true;
}

// ===== Чат: раса/фракция собеседника, публичные и личные сообщения =====
// 16.09.2026, Паша: "цель сделать автономного персонажа" - в постоянном коде, не как
// одноразовый _tmp-скрипт (см. LORE_ARDEN.md для полного контекста лора и персонажа AI__).

// Клик по нику в любой комнате чата ведёт на chat.php?mod=infa&userlogin=<ник> - страница
// профиля с полями "Раса:" и либо "Мировоззрение:" (нейтральное/тёмный - для тех, кто не в
// формальном государстве), либо "Государство:" (Империя/Сариматское Братство и т.п.).
// ВАЖНО (обнаружено живьём 16.09.2026): раса и фракция независимы друг от друга - например
// орк может состоять в Государстве Империя, а не быть автоматически Тьмой/нейтральным по
// расе. Нельзя выводить фракцию из расы, только парсить оба поля отдельно.
async function getPlayerRaceAndFaction(page, nick) {
  const currentUrl = page.url();
  try {
    await page.goto(
      `http://lbast.ru/chat.php?mod=infa&userlogin=${encodeURIComponent(nick)}&room=1&sm=`,
      { waitUntil: 'domcontentloaded', timeout: 60000 }
    );
    const text = await getBodyText(page);

    const raceMatch = text.match(/Раса:\s*([^\s,]+)/i);
    const worldviewMatch = text.match(/Мировоззрение:\s*([^\s,]+)/i);
    const stateMatch = text.match(/Государство:\s*([^\s,]+)/i);
    const clanMatch = text.match(/Клан:\s*([^\n]+?)(?=\s{2,}|Статус:|Ролевой портрет|$)/i);

    return {
      race: raceMatch ? raceMatch[1] : null,
      worldview: worldviewMatch ? worldviewMatch[1] : null,
      state: stateMatch ? stateMatch[1] : null,
      clan: clanMatch ? clanMatch[1].trim() : null,
    };
  } finally {
    await page.goto(currentUrl, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  }
}

// 16.09.2026, Паша: "у Цунами есть как использовать статую... раз в 12 часов". Логика
// runStatueOfGloryTask/isStatueOfGloryDue/scheduleNextStatueOfGlory уже существовала в этом
// файле (видимо, портирована раньше вместе с остальным кодом Цунами), но жила только внутри
// doScenario() - функции, которую driver.js для AI__ НИКОГДА не вызывает (у него свой
// собственный цикл шагов). Получается, статуя не работала для AI__ ни разу, пока не вступили
// в клан и её вообще не заметили. Обёртка ниже - тонкий адаптер для прямого вызова из
// driver.js, без изменения самой логики маршрута/интервала.
async function runStatueOfGloryIfDue(page) {
  if (!isStatueOfGloryDue()) {
    return false;
  }
  console.log('Статуя славы: подошёл интервал 12-14 часов, выполняю маршрут');
  try {
    await runStatueOfGloryTask(page);
  } catch (e) {
    console.log(`Статуя славы: не удалось (${e.message}) -> пропускаю, продолжаю цикл`);
    await page.goto('http://lbast.ru/location.php', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  }
  scheduleNextStatueOfGlory();
  return true;
}

// Отправка сообщения в общий чат комнаты (по умолчанию room=1 = Городская площадь).
async function postChatMessage(page, message, room = 1) {
  await page.goto(`http://lbast.ru/chat.php?room=${room}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  const textarea = page.locator('textarea#msgbody');
  await textarea.fill(message);
  await page.locator('input#send').click({ timeout: 8000 });
  noteChatMessageSent(room); // -> комната считается активной, опрос раз в 30 сек
  await pause(page, 800, 1500);
}

// Читает последние сообщения комнаты как {nick, text} - используется, чтобы заметить чей-то
// ответ на сообщение AI__ (сопоставление по нику из ссылки mod=infa рядом с текстом сообщения).
// Смайлы в чате - это картинки <img src="smile/pivo.gif" title=".pivo.">, и innerText их просто
// выбрасывает. Паша, 18.09.2026: "а смайлики ты почему-то не видишь" - реплики Galla "AI__, [пиво]"
// доходили как пустое "AI__,". Подменяем каждую картинку-смайл её кодом (.pivo.), тогда код
// виден в тексте, а в ответ можно поставить смайл тем же кодом. Полный список кодов -
// ai_char/SMILES_AI_CHAR.txt (снят со страницы "Справка: смайлы").
async function getChatTextWithSmileys(page) {
  await page.evaluate(() => {
    document.querySelectorAll('img[src*="smile/"]').forEach((im) => {
      im.replaceWith(document.createTextNode(` ${im.getAttribute('title') || '.smile.'} `));
    });
  }).catch(() => {});
  return getBodyText(page);
}
async function getRecentChatMessages(page, room = 1) {
  const url = `http://lbast.ru/chat.php?room=${room}`;
  const alreadyInRoom = String(page.url() || '').includes(`chat.php?room=${room}`);

  // Паша, 17.09.2026: "чат не обновляешь. Нужно нажимать обновить". Повторный goto на ТОТ ЖЕ
  // адрес чат сам прерывает - в логе это видно как net::ERR_ABORTED, и комната остаётся со
  // старым содержимым, то есть монитор не видит новых сообщений вообще. Штатный способ
  // обновления в игре - ссылка "Обновить" на самой странице чата.
  if (alreadyInRoom) {
    const refreshed = await clickByTexts(page, ['Обновить'], `Обновить чат (room=${room})`).catch(() => false);
    if (refreshed) {
      await pause(page, 500, 900);
      return await getChatTextWithSmileys(page);
    }
  }

  // Первый заход в комнату (или "Обновить" не нашлась) - обычная навигация.
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  await pause(page, 400, 800);
  return await getChatTextWithSmileys(page);
}

// Живой факт (16.09.2026): полный текст страницы чата всегда меняется между опросами даже
// без новых сообщений - в шапке есть текущее время ("14:19:47, Ср.") и HP/кулдаун персонажа
// ("AI__ (200/340) (40)"), которые тикают каждую минуту сами по себе. Diff по ПОЛНОМУ тексту
// (как было в первой версии runChatMonitorCycle) ложно срабатывал почти на каждом опросе для
// каждой комнаты, независимо от реальной активности - шум забивал сигнал. Вырезаем только
// секцию с реальными сообщениями (между "Смайлы" и футером "Вперед - Обновить"/"Заметки -")
// и сравниваем именно её.
function extractChatMessagesSection(fullText) {
  const marker = 'Смайлы';
  const startIdx = fullText.indexOf(marker);
  let section = startIdx >= 0 ? fullText.slice(startIdx + marker.length) : fullText;
  const endMarkers = ['Вперед - Обновить', 'Заметки -'];
  let endIdx = section.length;
  for (const m of endMarkers) {
    const idx = section.indexOf(m);
    if (idx >= 0 && idx < endIdx) endIdx = idx;
  }
  return section.slice(0, endIdx).trim();
}

// Формат сообщения (снято живьём 17.09.2026 из лога драйвера):
//   Hacky [13.08]
//    Universe, Ceadmil, bloede dh'oine!
// Строка "Ник [ЧЧ.ММ]", следом строка с текстом. Сообщения идут сверху вниз ОТ НОВЫХ К СТАРЫМ.
// Обращение к собеседнику оформляется как "Ник, текст" в начале сообщения.
function parseChatMessages(sectionText) {
  const lines = String(sectionText || '').split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].trim().match(/^(\S+)\s*\[(\d{1,2})\.(\d{2})\]$/);
    if (!m) continue;
    const text = (lines[i + 1] || '').trim();
    if (!text) continue;
    out.push({ nick: m[1], hh: Number(m[2]), mm: Number(m[3]), text });
  }
  return out;
}

function chatMessageKey(m) {
  return `${m.nick}|${m.hh}.${m.mm}|${m.text}`;
}

// Возраст сообщения в минутах по времени из чата (местное время сервера совпадает с нашим -
// в шапке страницы тот же час). Если время "из будущего" - считаем, что это вчерашнее.
function chatMessageAgeMinutes(m, nowDate = new Date()) {
  const msgMinutes = m.hh * 60 + m.mm;
  const nowMinutes = nowDate.getHours() * 60 + nowDate.getMinutes();
  const diff = nowMinutes - msgMinutes;
  return diff >= 0 ? diff : diff + 24 * 60;
}

// Паша, 17.09.2026: "ничего не копить, только живое" - сигналы старше этого порога
// выбрасываются: лучше промолчать, чем ответить на разговор часовой давности.
const CHAT_TRIGGER_MAX_AGE_MIN = 15;
// "Оживление после тишины": несколько новых сообщений подряд в комнате, которая молчала.
const CHAT_QUIET_FOR_REVIVAL_MS = 20 * 60_000;
const CHAT_REVIVAL_MIN_MESSAGES = 2;
// "Развлекательный момент" (Паша: "я хочу чтобы ты сам писал, отталкиваясь от характера
// персонажа") - повод заговорить первым в давно молчащей комнате, но не чаще раза в 3 часа,
// иначе это уже не характер, а спам.
// Паша, 18.09.2026: "пиши иногда в клановом зале, заводи беседу". При 90 мин тишины и
// раз в 3 часа инициатива почти не срабатывала.
// Паша, 18.09.2026 (вечер): "если в чате тишина более 2х часов днём с 4 утра по 23:00, то
// пиши что-нибудь, заводи разговор". Ночью (23:00-04:00) AI__ первым не пишет.
const CHAT_INITIATIVE_QUIET_MS = 120 * 60_000;
const CHAT_INITIATIVE_COOLDOWN_MS = 120 * 60_000;
const CHAT_INITIATIVE_FROM_HOUR = 4;
const CHAT_INITIATIVE_TO_HOUR = 23;
// Сколько минут после нашей реплики чужое сообщение считается ответом нам.
const CHAT_REPLY_WINDOW_MIN = 15;
const CHAT_GREETING_RE = /(^|\s)(привет\w*|здаров\w*|здорово|здравствуй\w*|доброго|добрый\s+(?:день|вечер)|доброе\s+утро|салют|хай|ку)(\s|[,!.?)]|$)/i;

// Решает, есть ли повод вмешаться. Возвращает список триггеров; пустой список = молчим.
function detectChatTriggers(roomInfo, prevMsgs, nextMsgs, opts = {}) {
  const { quietForMs = 0, lastInitiativeAt = 0, now = Date.now() } = opts;
  const triggers = [];
  const nowDate = new Date(now);
  const base = { room: roomInfo.room, roomName: roomInfo.name, at: new Date(now).toISOString() };

  // При первом наблюдении комнаты вся история выглядит "новой", поэтому обычные поводы
  // (приветствие, оживление, инициатива) подавляются - иначе рестарт драйвера реагировал бы
  // на всю ленту разом.
  //
  // НО прямое обращение к AI__ подавлять НЕЛЬЗЯ. Живой провал 17.09.2026: Galla написала
  // "AI__, кто ты, воин?", драйвер в этот момент был перезапущен, вопрос попал в "историю"
  // первого наблюдения и был проглочен - Паша: "у тебя в чате спрашивают а ты молчишь".
  // Так как я перезапускал драйвер десятки раз, а клановый зал опрашивается раз в 20 минут,
  // мониторинг чата фактически не работал ни разу. От древних обращений защищает фильтр по
  // возрасту (CHAT_TRIGGER_MAX_AGE_MIN), а не подавление первого наблюдения.
  const firstObservation = prevMsgs.length === 0;
  const seen = new Set(prevMsgs.map(chatMessageKey));
  const fresh = nextMsgs.filter((m) => !seen.has(chatMessageKey(m)));

  // Лента идёт новыми сверху. Всё, что НИЖЕ последнего сообщения AI__, написано до нашего
  // ответа - на это мы уже отреагировали. 18.09.2026: одно неполное обновление чата стёрло
  // prevMsgs, и обе старые реплики Galla ("а оркам отдыхать можно?", "ну спасибо") снова
  // пришли как новые обращения. Это правило от prevMsgs не зависит.
  const ownIdx = nextMsgs.findIndex((m) => AI_SELF_NICK_RE.test(m.nick));
  const newerThanOurReply = (m) => ownIdx < 0 || nextMsgs.indexOf(m) < ownIdx;

  const live = fresh.filter((m) => {
    if (AI_SELF_NICK_RE.test(m.nick)) return false; // своё же сообщение
    if (!newerThanOurReply(m)) return false;
    return chatMessageAgeMinutes(m, nowDate) <= CHAT_TRIGGER_MAX_AGE_MIN;
  });

  // Паша, 18.09.2026: "отвечай на все сообщения, адресованные тебе". Ответ на нашу реплику
  // часто приходит без ника (Galla: "У нас, кстати, хорошенькие гномихи" - сразу после
  // шутки AI__ про гномих) и раньше не ловился вовсе. Всё, что пришло в течение
  // CHAT_REPLY_WINDOW_MIN после нашего сообщения, считаем адресованным нам.
  const ownLastForReply = nextMsgs.find((m) => AI_SELF_NICK_RE.test(m.nick));
  const inReplyWindow = ownLastForReply
    && chatMessageAgeMinutes(ownLastForReply, nowDate) <= CHAT_REPLY_WINDOW_MIN;

  for (const m of live) {
    if (AI_SELF_NICK_RE.test(m.text)) {
      triggers.push({ ...base, type: 'mention', nick: m.nick, text: m.text,
        reason: `${m.nick} обратился к AI__` });
    // "Tsunami, и за месяц спустила..." - обращение к ДРУГОМУ нику: это не нам, даже если пришло
    // сразу после нашей реплики (первая ложная сработка 18.09.2026).
    } else if (!firstObservation && inReplyWindow && !/^[A-Za-z0-9_.-]+\s*,/.test(m.text)) {
      triggers.push({ ...base, type: 'reply', nick: m.nick, text: m.text,
        reason: `${m.nick} ответил после реплики AI__` });
    } else if (!firstObservation && CHAT_GREETING_RE.test(m.text)) {
      triggers.push({ ...base, type: 'greeting', nick: m.nick, text: m.text,
        reason: `${m.nick} поздоровался` });
    }
  }

  if (!firstObservation && live.length >= CHAT_REVIVAL_MIN_MESSAGES
      && quietForMs >= CHAT_QUIET_FOR_REVIVAL_MS
      && !triggers.some((t) => t.type === 'mention' || t.type === 'reply')) {
    triggers.push({ ...base, type: 'revival',
      reason: `после тишины пошёл разговор (${live.length} сообщений)`,
      lines: live.slice(0, 6).map((m) => `${m.nick}: ${m.text}`) });
  }

  // quietForMs обязан быть КОНЕЧНЫМ числом: при первом наблюдении комнаты истории тишины нет
  // (lastChangeAt = 0), и старое условие давало "молчит Infinity мин" - initiative срабатывал
  // сразу на каждом запуске драйвера. Живой случай 17.09.2026, сразу после включения триггеров.
  // Пауза между инициативами считается и по САМОЙ ЛЕНТЕ: lastInitiativeAt живёт в памяти и
  // обнуляется при каждом перезапуске драйвера. 18.09.2026 после рестарта пришёл сигнал
  // "заговорить первым" через 40 минут после моей последней реплики - а до неё было пять
  // подряд. Последнее сообщение AI__ в ленте переживает любые перезапуски.
  const ownLast = nextMsgs.find((m) => AI_SELF_NICK_RE.test(m.nick));
  const ownLastAgoMs = ownLast ? chatMessageAgeMinutes(ownLast, nowDate) * 60_000 : Infinity;
  if (!firstObservation && fresh.length === 0
      && Number.isFinite(quietForMs) && quietForMs >= CHAT_INITIATIVE_QUIET_MS
      && now - lastInitiativeAt >= CHAT_INITIATIVE_COOLDOWN_MS
      && ownLastAgoMs >= CHAT_INITIATIVE_COOLDOWN_MS
      && nowDate.getHours() >= CHAT_INITIATIVE_FROM_HOUR && nowDate.getHours() < CHAT_INITIATIVE_TO_HOUR) {
    triggers.push({ ...base, type: 'initiative',
      reason: `комната молчит ${Math.round(quietForMs / 60000)} мин - повод заговорить первым` });
  }

  return triggers;
}

// Список комнат чата (найдено живьём 16.09.2026, chat.php лобби) - Паша попросил
// активность сразу в нескольких, не только на Городской площади.
// Паша, 17.09.2026: "по чатам - смотри клановый зал, остальные пока не нужно". Оставлена
// одна комната. Остальные НЕ удалены, а отключены - вернуть можно, раскомментировав строку.
// Появились после вступления AI__ в клан "Боги войны" 16.09.2026 - см. LORE_ARDEN.md.
// idlePollMs=20 мин - из более раннего указания: "если никого нет раз в 20 минут, если идет
// общение поддерживаешь беседу" (при активности интервал сам падает до CHAT_ACTIVE_POLL_MS).
const CHAT_ROOMS = [
  // idlePollMs убран: теперь общий CHAT_IDLE_POLL_MS = 5 минут (Паша, 17.09.2026).
  { room: 12, name: 'Клановый зал' },
  // Отключены 17.09.2026 по просьбе Паши:
  // { room: 1, name: 'Городская площадь' },
  // { room: 2, name: 'Сады Афродиты' },
  // { room: 3, name: 'Вопросы по игре' },
  // { room: 4, name: 'Эльфийская деревня' },
  // { room: 5, name: 'Торба на круче' },
  // { room: 6, name: 'Казармы орков' },
  // { room: 7, name: 'Пещера гномов' },
  // { room: 200, name: 'Таверна' },
  // { room: 300, name: 'Ролевая' },   // ВАЖНО: только здесь допустим формат /действие/
  // { room: 51, name: 'Имперский зал' },
];

// Адаптивный опрос (16.09.2026, Паша: "обновляй чаще, если в комнате пошло общение можешь ее
// обновлять раз в 30 сек" - до этого все 9 комнат опрашивались одинаково раз в CHAT_POLL_INTERVAL_MS
// целиком, что и медленно реагирует на живой разговор, и просто лишний трафик для тихих комнат).
// Комната считается "активной" ACTIVE_WINDOW_MS после последнего замеченного изменения - в этом
// окне она проверяется каждые ACTIVE_POLL_MS, иначе раз в IDLE_POLL_MS (или в room.idlePollMs,
// если для комнаты задан отдельный интервал - см. Клановый зал выше).
// Паша, 17.09.2026: "проверяй каждые 5 минут, а когда отправляешь сообщение - 30 сек, когда
// общение прекратилось опять 5 минут". Активное окно = сколько держится режим 30 секунд
// после последнего движения в комнате (нового сообщения ИЛИ нашей собственной отправки).
const CHAT_ACTIVE_POLL_MS = 30_000;
// Паша, 18.09.2026: "почему так долго отвечал в клан зале?" - при опросе раз в 5 минут
// реплику Galla заметили через 5 минут. Раз в минуту - всё ещё спокойно для сервера.
const CHAT_IDLE_POLL_MS = 60_000;
const CHAT_ACTIVE_WINDOW_MS = 15 * 60_000;

// Когда МЫ написали в комнату - ждём ответа, а значит следующие CHAT_ACTIVE_WINDOW_MS
// опрашиваем её раз в 30 секунд. Хранится здесь, а не в state драйвера, чтобы работало при
// любом вызове postChatMessage (в том числе из разовых скриптов).
const lastChatSentAt = {};
function noteChatMessageSent(room) {
  lastChatSentAt[room] = Date.now();
}

// state: {[room]: {lastText, lastChangeAt, lastCheckedAt}} - переиспользуется между вызовами,
// начать с {}. Каждый вызов проверяет только те комнаты, чей интервал уже истёк (не долбит все
// 9 комнат разом каждый раз), с паузой между реальными проверками внутри одного тика.
// Исходящие реплики. Реплику пишет Claude (драйвер сам не разговаривает), но профиль браузера
// занят драйвером, и отправка из разового скрипта означала бы останавливать фарм. Поэтому:
// Claude кладёт реплики в chat_outbox.json ([{room, text}]), вкладка чата отправляет их на
// ближайшем опросе и очищает файл. Файл в .gitignore.
const CHAT_OUTBOX_FILE = path.join(__dirname, 'chat_outbox.json');

async function flushChatOutbox(chatPage) {
  let items;
  try {
    items = JSON.parse(fs.readFileSync(CHAT_OUTBOX_FILE, 'utf8'));
  } catch (e) {
    return 0; // файла нет или он пуст - нечего отправлять
  }
  if (!Array.isArray(items) || items.length === 0) return 0;
  // Очищаем ДО отправки: лучше потерять реплику при сбое, чем повторить её в чат дважды.
  fs.writeFileSync(CHAT_OUTBOX_FILE, '[]');
  let sent = 0;
  for (const it of items) {
    const text = String((it && it.text) || '').trim().slice(0, 500);
    const room = Number((it && it.room) || 12);
    if (!text) continue;
    try {
      await postChatMessage(chatPage, text, room);
      console.log(`CHAT_SENT room=${room}: ${text}`);
      sent += 1;
    } catch (e) {
      console.log(`CHAT_SEND_FAILED room=${room}: ${e.message}`);
    }
  }
  return sent;
}

async function runChatMonitorCycle(chatPage, state) {
  await flushChatOutbox(chatPage).catch((e) => console.log('Chat outbox error:', e.message));
  const now = Date.now();
  const changed = [];
  let didAnyFetch = false;
  for (const { room, name, idlePollMs } of CHAT_ROOMS) {
    const s = state[room] || { lastText: undefined, lastChangeAt: 0, lastCheckedAt: 0 };
    const sentAt = lastChatSentAt[room] || 0;
    const isActive = (now - s.lastChangeAt < CHAT_ACTIVE_WINDOW_MS)
      || (now - sentAt < CHAT_ACTIVE_WINDOW_MS);
    const intervalMs = isActive ? CHAT_ACTIVE_POLL_MS : (idlePollMs || CHAT_IDLE_POLL_MS);
    if (now - s.lastCheckedAt < intervalMs) {
      state[room] = s;
      continue;
    }
    if (didAnyFetch) {
      await pause(chatPage, 3000, 6000);
    }
    const text = await getRecentChatMessages(chatPage, room).catch((e) => {
      console.log(`Chat monitor: ошибка чтения комнаты "${name}" (room=${room}):`, e.message);
      return null;
    });
    didAnyFetch = true;
    s.lastCheckedAt = now;
    if (text === null) {
      state[room] = s;
      continue;
    }
    const messagesOnly = extractChatMessagesSection(text);
    const nextMsgs = parseChatMessages(messagesOnly);
    // 18.09.2026: каждое ВТОРОЕ обновление чата приходило пустым (0 сообщений, потом снова 14).
    // Комната от этого "менялась" каждые полминуты: lastChangeAt не старел, и инициатива
    // (30 мин тишины) не срабатывала НИКОГДА, а lastMsgs затирался, и старые обращения
    // приходили повторно. Живая лента из 14 сообщений не пустеет за полминуты, так что пустое
    // чтение после непустого - это сбой чтения, а не событие в комнате. Пропускаем его.
    if (nextMsgs.length === 0 && (s.lastMsgs || []).length > 0) {
      state[room] = s;
      continue;
    }
    const textChanged = s.lastText !== undefined && s.lastText !== messagesOnly;

    // Триггеры считаем ВСЕГДА, а не только при изменении текста: "развлекательный момент"
    // должен сработать именно в молчащей комнате, где ничего не менялось.
    const triggers = detectChatTriggers({ room, name }, s.lastMsgs || [], nextMsgs, {
      // null, а не Infinity: пока мы не видели ни одного изменения, про длину тишины ничего
      // не известно - "мы только что пришли" это не "комната давно молчит".
      // После перезапуска lastChangeAt нет, и раньше тишина считалась неизвестной до первого
      // изменения - в молчащем зале инициатива не срабатывала никогда. Время самого свежего
      // сообщения в ленте даёт честную длину тишины и без этого.
      quietForMs: s.lastChangeAt
        ? now - s.lastChangeAt
        : (nextMsgs.length ? chatMessageAgeMinutes(nextMsgs[0], new Date(now)) * 60_000 : null),
      lastInitiativeAt: s.lastInitiativeAt || 0,
      now,
    });
    if (triggers.some((t) => t.type === 'initiative')) {
      s.lastInitiativeAt = now;
    }
    for (const t of triggers) {
      emitChatTrigger(t);
    }

    if (textChanged || triggers.length > 0) {
      changed.push({ room, name, text, triggers });
      if (textChanged) s.lastChangeAt = now;
    }
    s.lastText = messagesOnly;
    s.lastMsgs = nextMsgs;
    state[room] = s;
  }
  return changed;
}

// "Отвечаешь лично" - личное письмо конкретному игроку (letters.php, отдельная от чата
// система - на lbast.ru нет отдельного real-time приватного чата с конкретным игроком,
// только это). Форма подтверждена живьём 16.09.2026: textarea#msgbody, submit #send.
async function sendPrivateLetter(page, nick, message) {
  await page.goto(
    `http://lbast.ru/letters.php?mod=write&room=1&userlogin=${encodeURIComponent(nick)}&privat=2&fromchat=1`,
    { waitUntil: 'domcontentloaded', timeout: 60000 }
  );
  const textarea = page.locator('textarea#msgbody');
  await textarea.fill(message);
  await page.locator('input#send').click({ timeout: 8000 });
  await pause(page, 800, 1500);
}

// Ответ В ТОЙ ЖЕ переписке. Паша, 17.09.2026: "письма это тригер и отвечай так же как в чате".
// Отличается от sendPrivateLetter выше: тот бьёт в mod=write&fromchat=1 - путь личного письма
// ИЗ ЧАТА, он заводит новую переписку, а не продолжает цепочку.
// Проверено вживую 17.09.2026, игра подтвердила: "Письмо для Tsunami отправлено."
// Две ловушки, обе стоили мне неудачных попыток:
//  1) У ссылки "Ответить" ПУСТОЙ href - это не навигация, а JS-тумблер видимости формы.
//     Скрипт, ищущий href, находит пустоту и решает, что ответить нельзя.
//  2) Форма ответа уже лежит на странице письма, но скрыта (display:none). Пока тумблер не
//     нажат, Playwright отказывается заполнять поле: "element is not visible". Наличие поля
//     в разметке не означает, что с ним можно работать.
// Нонс r= у формы СВОЙ, отличный от нонса страницы, поэтому жмём саму форму, а не строим URL.
async function replyToLetter(page, nick, message) {
  await page.goto('http://lbast.ru/location.php', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await pause(page, 700, 1200);

  let inboxHref = await page.evaluate(() => {
    const a = Array.from(document.querySelectorAll('a')).find((x) => (x.getAttribute('href') || '').includes('letters.php'));
    return a ? a.getAttribute('href') : null;
  }).catch(() => null);
  if (!inboxHref) {
    console.log('Ответ на письмо: иконка почты на локации не найдена.');
    return false;
  }
  if (!inboxHref.includes('mod=inbox')) inboxHref += '&mod=inbox';

  await page.goto(`http://lbast.ru/${inboxHref.replace(/^\//, '')}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await pause(page, 600, 1000);

  const letterHref = await page.evaluate((who) => {
    const a = Array.from(document.querySelectorAll('a')).find(
      (x) => (x.getAttribute('href') || '').includes('mod=readletter') && (x.innerText || '').includes(who),
    );
    return a ? a.getAttribute('href') : null;
  }, nick).catch(() => null);
  if (!letterHref) {
    console.log(`Ответ на письмо: переписка с "${nick}" не найдена во входящих.`);
    return false;
  }

  await page.goto(`http://lbast.ru/${letterHref.replace(/^\//, '')}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await pause(page, 700, 1200);

  const toggled = await page.evaluate(() => {
    const a = Array.from(document.querySelectorAll('a')).find((x) => (x.innerText || '').trim() === 'Ответить');
    if (!a) return false;
    a.click();
    return true;
  }).catch(() => false);
  if (!toggled) {
    console.log('Ответ на письмо: тумблер "Ответить" не найден.');
    return false;
  }

  const area = page.locator('#msgbody');
  try {
    await area.waitFor({ state: 'visible', timeout: 15000 });
  } catch (e) {
    console.log('Ответ на письмо: поле ввода так и не стало видимым.');
    return false;
  }
  await area.fill(message);

  const submit = page.locator('input[type=submit][value="Ответить"]');
  if ((await submit.count().catch(() => 0)) === 0) {
    console.log('Ответ на письмо: кнопка отправки не найдена.');
    return false;
  }
  await Promise.all([
    page.waitForLoadState('domcontentloaded'),
    submit.first().click({ timeout: 15000 }),
  ]);
  await pause(page, 900, 1500);

  // Не верим клику на глаз: игра прямо пишет "Письмо для <ник> отправлено."
  const after = await getBodyText(page).catch(() => '');
  const ok = /Письмо для .* отправлено/i.test(after);
  console.log(ok
    ? `Ответ на письмо: отправлено "${nick}".`
    : `Ответ на письмо: подтверждения отправки не увидел, считаю неудачей ("${nick}").`);
  return ok;
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
  if (dovolstvieDayKey !== today) {
    dovolstvieDayKey = today;
    dovolstvieDoneToday = false;
    persistDailyQuestState();
  }
  if (dovolstvieDoneToday) return false;

  const ok = await runNonQQuestSafe(page, 'Довольствие quest', () => progressDovolstvieQuest(page));
  if (ok) {
    dovolstvieDoneToday = true;
    persistDailyQuestState();
  }
  return Boolean(ok);
}

// ===================================================================================
// "Шепот" - взят у "Кулак Хаоса", раз в МЕСЯЦ (Паша, 16.09.2026: "запомни как делается он
// периодический"). Гайд Kate2008 (zhg_web.php?st_id=122225), но живой прогон 16.09.2026 разошёлся
// с текстом гайда в нескольких местах - код ниже использует ПОДТВЕРЖДЁННЫЙ живьём маршрут
// (см. aichar_shepot_quest.md), а не гайд буквально:
//   - вместо "К месту выполнения" (просто показывает текущую локацию, не запускает сцену) -
//     Амулет -> Кулак Хаоса -> "К себе в дом".
//   - вместо долгого морского маршрута до Глинбага - "Пристань" -> лодка (15 дин), см. stage 3.
//   - фигура в церкви: трогаем ЗВЕЗДУ (подтверждено Пашей для мировоззрения AI__), не круг/треугольник.
//   - реальная кнопка на утёсе - "Пройтись по утесу" (не "Прогуляться", как в гайде).
//
// КРИТИЧЕСКИ ВАЖНЫЙ УРОК (инцидент 17.09.2026): на экране "В бой!" сайт временно перестаёт
// показывать HP (parseStats -> null/null) до разрешения боя. Первая версия этого кода проверяла
// HP только НЕПОСРЕДСТВЕННО перед кликом "В бой!" и, если parseStats возвращал null, тупо
// пропускала проверку порога вместо того чтобы её заблокировать - это позволило войти во второй
// бой гаунтлета при HP 210/380 (55%, уже ниже 70%) и уйти в минус (-8/380, фактическая "смерть").
// Отсюда два жёстких правила ниже:
//   1) shepotCheckHpFloorOrStop читает HP на СТАБИЛЬНОМ экране (там, где статы гарантированно
//      видны - "К себе в дом", "Продолжить квест" и т.п.), НИКОГДА на экране "В бой!" самом.
//   2) Если HP не читается (null) - код ОСТАНАВЛИВАЕТСЯ, а не пропускает проверку.
//   3) Гаунтлет из 4 боёв (stage 5) делает РОВНО ОДИН бой за вызов и возвращается - следующий
//      бой начнётся только на следующий вызов функции (следующий цикл driver.js), давая время
//      на естественное восстановление HP между боями вместо слепого чейна всех 4 подряд.
//
// Стадии (shepotStage, персистится в state.json - переживает рестарт процесса):
//   0 - интро (свинья/бабка/кошмары) в Кулак Хаоса, не пройдено вживую подряд в этом коде -
//       используется clickOnlySensibleOption как основной механизм (чисто линейные экраны).
//   1 - церковь (первый визит) -> бар -> соглашение принести сталь+мёд.
//   2 - маршрут на Каменный утёс, бой с Духом гнома (сталь).
//   3 - маршрут на Глинбаг (лодка) -> Лес -> бой с Троллем (мёд).
//   4 - возврат в бар, сдача стали+мёда Фра Станьоле.
//   5 - гаунтлет у Кулак Хаоса: ударить свинью/"Продолжить квест" -> определить, какой монстр
//       появился (Нежить/Нечисть/Призрак/ведьма) -> использовать СООТВЕТСТВУЮЩИЙ предмет ->
//       один бой -> return. Стадия не увеличивается, пока не пройдены все 4 монстра (гейт по
//       диалогу "Гильдия вичхантеров" в тексте страницы).
//   6 - сдача квеста в Гильдии вичхантеров (маршрут до гильдии НЕ проверен вживую - см. заметку
//       внутри, verify live перед первым использованием этой стадии).
// ===================================================================================

const SHEPOT_HP_FLOOR = 0.7;

function hpFraction(stats) {
  if (!stats || stats.hpCurrent == null || stats.hpMax == null || stats.hpMax === 0) return null;
  return stats.hpCurrent / stats.hpMax;
}

// Единственное место, где код решает "можно ли в бой" - читает HP ИМЕННО СЕЙЧАС (вызывающий
// обязан звать это на стабильном экране, не на "В бой!"). null (не прочитали) тоже блокирует -
// это и есть исправление бага 17.09.2026, где null ошибочно пропускал проверку.
async function shepotCheckHpFloorOrStop(page, label) {
  const stats = parseStats(await getBodyText(page));
  const frac = hpFraction(stats);
  console.log(`Шепот (${label}): HP ${stats.hpCurrent}/${stats.hpMax}`);
  if (frac == null) {
    console.log(`Шепот (${label}): HP не читается - на всякий случай СТОП, не рискую (см. инцидент 17.09.2026).`);
    return false;
  }
  if (frac < SHEPOT_HP_FLOOR) {
    console.log(`Шепот (${label}): HP ${Math.round(frac * 100)}% ниже порога ${SHEPOT_HP_FLOOR * 100}% - жду восстановления, бой не начинаю.`);
    return false;
  }
  return true;
}

// Линейные повествовательные экраны (интро, видение в церкви) - используем
// clickOnlySensibleOption, чтобы не перечислять вручную формулировки каждой кнопки (гайд и
// живой текст расходятся в мелочах). Останавливается на реальных развилках/боях/целевом экране.
async function shepotBlastThroughNarrative(page, { stopTexts = [], maxSteps = 30, label = '' } = {}) {
  for (let i = 0; i < maxSteps; i++) {
    if (await existsAnyText(page, stopTexts)) {
      return { reachedStop: true, steps: i };
    }
    if (await existsAnyText(page, ['Ответить "да"'])) {
      await clickByTexts(page, ['Ответить "да"'], `Шепот/${label}: Ответить "да"`);
      await pause(page, 800, 1500);
      continue;
    }
    if (await existsAnyText(page, ['Коснуться звезды'])) {
      await clickByTexts(page, ['Коснуться звезды'], `Шепот/${label}: Коснуться звезды`);
      await pause(page, 800, 1500);
      continue;
    }
    if (await existsAnyText(page, ['В бой!', 'В бой'])) {
      return { reachedFight: true, steps: i };
    }
    const result = await clickOnlySensibleOption(page, `Шепот/${label} шаг ${i}`);
    if (result.clicked) {
      await pause(page, 800, 1500);
      continue;
    }
    if (result.reason === 'no_candidates' && (await existsAnyText(page, ['Уйти']))) {
      await clickByTexts(page, ['Уйти'], `Шепот/${label}: Уйти`);
      await pause(page, 800, 1500);
      continue;
    }
    console.log(`Шепот/${label}: застрял на шаге ${i} (${result.reason}), кандидаты: ${JSON.stringify(result.candidates)}`);
    return { stuck: true, reason: result.reason, candidates: result.candidates, steps: i };
  }
  return { maxStepsReached: true };
}

// Церковь -> звезда -> переулок -> бар. Общий кусок для stage 1 (первый визит) и stage 4
// (возврат со сталью/мёдом) - подтверждено живьём 16-17.09.2026 (возврат), первый визит из
// более ранней сессии (не в этом транскрипте, но тот же одноразовый сценарий).
async function shepotChurchToBar(page) {
  await clickByTexts(page, ['Конь'], 'Шепот: Конь');
  await pause(page, 800, 1200);
  await clickByTexts(page, ['Таможенный пост'], 'Шепот: Таможенный пост');
  await pause(page, 8000, 9000);
  await page.goto('http://lbast.ru/location.php', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  await pause(page, 500, 800);

  for (const dir of ['Идти на запад', 'Идти на запад', 'Идти на север']) {
    await clickByTexts(page, [dir], `Шепот: ${dir}`);
    await pause(page, 800, 1200);
  }

  if (await existsAnyText(page, ['Продолжить квест'])) {
    await clickByTexts(page, ['Продолжить квест'], 'Шепот: Продолжить квест (церковь)');
    await pause(page, 800, 1200);
  } else if (await existsAnyText(page, ['Зайти в церковь'])) {
    await clickByTexts(page, ['Зайти в церковь'], 'Шепот: Зайти в церковь');
    await pause(page, 800, 1200);
  }

  const result = await shepotBlastThroughNarrative(page, {
    stopTexts: ['Зайти в Бар', 'Зайти в бар'],
    maxSteps: 30,
    label: 'церковь->бар',
  });
  if (!result.reachedStop) {
    console.log('Шепот: не дошёл до бара автоматически - см. лог выше, нужна ручная проверка.');
    return false;
  }

  await clickByTexts(page, ['Зайти в Бар'], 'Шепот: Зайти в Бар');
  await pause(page, 800, 1200);
  if (await existsAnyText(page, ['Спросить про знахаря'])) {
    await clickByTexts(page, ['Спросить про знахаря'], 'Шепот: Спросить про знахаря');
    await pause(page, 800, 1500);
  }
  // Первый визит (обещание принести предметы) и возврат (сдача предметов) продолжаются разным
  // диалогом - добиваем что осталось через общий помощник, он сам остановится на "Уйти"/пустоте.
  await shepotBlastThroughNarrative(page, { stopTexts: [], maxSteps: 10, label: 'бар-диалог' });
  return true;
}

async function shepotRunOneFight(page, label) {
  if (!(await shepotCheckHpFloorOrStop(page, label))) return false;
  await clickByTexts(page, ['В бой!', 'В бой'], `Шепот: В бой! (${label})`);
  const won = await fightLoop(page);
  const after = parseStats(await getBodyText(page));
  console.log(`Шепот: бой "${label}" завершён, won=${won}, HP после: ${after.hpCurrent}/${after.hpMax}`);
  return true;
}

// ===================================================================================
// Гаунтлет "Шепота" - НЕПРЕРЫВНЫЙ прогон (17.09.2026, после 5 неудачных попыток подряд).
// Установленный живьём факт: гаунтлет это ОДНА непрерывная сцена. После "Бой завершен!"
// следующий монстр появляется на ТОМ ЖЕ экране ("Из тумана перед вами появляется нечисть!").
// Если уйти со сцены (навигация, закрытие браузера) - цепочка теряется целиком: "Продолжить
// квест" на форпосте НЕ появляется, а повторный вход "К себе в дом" + "Ударить свинью"
// начинает всё заново с нежити. Именно поэтому 5 попыток подряд дрались с нежитью.
// Второй установленный факт: экраны внутри дома не показывают шапку со статами (HP = null),
// поэтому HP читается с ОТДЕЛЬНОЙ вкладки (hpPage) - основная вкладка со сценой не трогается.
// Предметы ("отвар арайи"/"рябина"/"святая вода") - это кнопки сцены, а НЕ предметы
// инвентаря (проверено: в инвентаре их нет вообще), поэтому "кончились" тут невозможно.
// ===================================================================================
const SHEPOT_MONSTER_ITEMS = [
  { re: /нежить/i, item: 'Использовать отвар арайи', name: 'Нежить' },
  { re: /нечисть/i, item: 'Использовать рябину', name: 'Нечисть' },
  { re: /призрак/i, item: 'Использовать святую воду', name: 'Призрак' },
  { re: /ведьм/i, item: null, name: 'Старая ведьма' },
];

function shepotSnap(t, n = 900) {
  return String(t || '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
}

async function shepotReadHpFrom(hpPage) {
  await hpPage.goto('http://lbast.ru/location.php', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  return parseStats(await getBodyText(hpPage));
}

// Ждёт восстановления HP, НЕ трогая вкладку со сценой. null (не прочитали) - это СТОП,
// а не "пропустить проверку" (инцидент 17.09.2026, см. feedback_shtolni_debugging_mistakes).
async function shepotWaitForHp(hpPage, floor, label, maxWaitMs = 90 * 60 * 1000) {
  const started = Date.now();
  // Сколько подряд нечитаемых опросов HP терпим, прежде чем сдаться (см. комментарий ниже).
  const MAX_NULL_READS = 5;
  let nullReads = 0;
  for (;;) {
    const stats = await shepotReadHpFrom(hpPage);
    const frac = hpFraction(stats);
    if (frac == null) {
      // 17.09.2026, живой случай: ОДИН нечитаемый опрос HP на второй вкладке (страница
      // отрендерилась без шапки - похоже на входящую атаку или сбой загрузки) убил весь прогон
      // гаунтлета на призраке, хотя сцена была цела и бой был не начат. Правило "null = не
      // драться" остаётся железным, но блокировать оно должно БОЙ, а не само ожидание:
      // перечитываем. Сдаёмся только если HP не читается много опросов подряд.
      nullReads += 1;
      if (nullReads >= MAX_NULL_READS) {
        console.log(`Шепот/${label}: HP не читается ${nullReads} опросов подряд -> СТОП.`);
        return false;
      }
      console.log(`Шепот/${label}: HP не прочитался (попытка ${nullReads}/${MAX_NULL_READS}) - перечитаю через минуту, сцену не трогаю.`);
      await new Promise((r) => setTimeout(r, 60000));
      continue;
    }
    nullReads = 0;
    // 17.09.2026: с активным элем порог опускается до HP_FLOOR_WITH_BUFF - это давнее правило
    // Паши ("с активным элем можно опустить порог хп до 0.4"), и именно здесь оно принципиально.
    // Гаунтлет обязан уложиться в ОДНУ сессию (иначе цепочка рвётся), а бафф эля конечен: ждать
    // до 70%, пока эль тикает, значит рискнуть доигрывать уже без него, а без эля бои стоят
    // 170-210 урона вместо 50-116. Живой случай: регенерация встала на 230/340 (68%) в восьми
    // единицах от порога 70%, и ожидание жгло бафф впустую. Бафф перечитываем каждый опрос на
    // ОТДЕЛЬНОЙ вкладке - он может истечь посреди ожидания, и тогда порог обязан вернуться к 0.7.
    const buffed = await isAnyBuffAleActive(hpPage).catch(() => false);
    const effectiveFloor = buffed ? HP_FLOOR_WITH_BUFF : floor;
    if (frac >= effectiveFloor) {
      console.log(`Шепот/${label}: HP ${stats.hpCurrent}/${stats.hpMax} (${Math.round(frac * 100)}%), порог ${Math.round(effectiveFloor * 100)}%${buffed ? ' (эль активен)' : ''} - можно в бой.`);
      return true;
    }
    if (Date.now() - started > maxWaitMs) {
      console.log(`Шепот/${label}: HP не восстановилось за ${Math.round(maxWaitMs / 60000)} мин -> СТОП.`);
      return false;
    }
    console.log(`Шепот/${label}: HP ${stats.hpCurrent}/${stats.hpMax} (${Math.round(frac * 100)}%) < ${Math.round(effectiveFloor * 100)}%${buffed ? ' (эль активен)' : ''} - жду 2 мин, сцену не трогаю.`);
    await new Promise((r) => setTimeout(r, 120000));
  }
}

// maxSteps, а не maxFights: итерации цикла тратятся и на не-боевые экраны (Продолжить квест,
// промежуточные виньетки), поэтому запас должен быть заметно больше числа боёв (их 4).
async function runShepotGauntletContinuous(page, hpPage, { maxFights = 24, hpFloor = SHEPOT_HP_FLOOR } = {}) {
  await page.goto('http://lbast.ru/location.php', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await pause(page, 500, 800);

  if (!(await shepotWaitForHp(hpPage, hpFloor, 'перед входом в дом'))) return false;

  // Паша, 17.09.2026: "на второй бой надо будет выпить эль вырви глаз". Пьём с ОТДЕЛЬНОЙ
  // вкладки - tryDrinkBuffAle ходит в pers.php/inv.php и вернул бы основную вкладку по URL,
  // а это увело бы нас со сцены.
  await tryDrinkBuffAle(hpPage, 'Эль "Вырви глаз"').catch((e) => {
    console.log('Шепот: эль не выпит -', e.message);
    return false;
  });

  await clickByTexts(page, ['Амулет', 'Aмулет'], 'Шепот: Амулет');
  await pause(page, 800, 1200);
  await clickByTexts(page, ['Кулак Хаоса'], 'Шепот: Кулак Хаоса');
  await pause(page, 1500, 2500);

  if (await existsAnyText(page, ['Продолжить квест'])) {
    await clickByTexts(page, ['Продолжить квест'], 'Шепот: Продолжить квест (гаунтлет)');
    await pause(page, 800, 1200);
  } else if (await existsAnyText(page, ['К себе в дом'])) {
    await clickByTexts(page, ['К себе в дом'], 'Шепот: К себе в дом (гаунтлет)');
    await pause(page, 800, 1200);
  }

  let text = String((await getBodyText(page)) || '');
  const monsterOnScreen = SHEPOT_MONSTER_ITEMS.some(({ re }) => re.test(text));
  if (!monsterOnScreen && (await existsAnyText(page, ['Ударить свинью']))) {
    await clickByTexts(page, ['Ударить свинью'], 'Шепот: Ударить свинью (старт гаунтлета, один раз)');
    await pause(page, 800, 1500);
  }

  for (let i = 0; i < maxFights; i++) {
    text = String((await getBodyText(page)) || '');
    console.log(`\nШепот/гаунтлет, экран ${i + 1}: ${shepotSnap(text)}`);

    // Игра пишет про гильдию в РОДИТЕЛЬНОМ падеже и с маленькой буквы ("спешить в гильдию
    // вичхантеров"), поэтому точное "Гильдия вичхантеров" из гайда тут не матчится - ловим
    // по корню. Плюс победный текст "Ведьма убита" - самый надёжный признак конца гаунтлета.
    if (/Ведьма убита|гильди\w*\s+вичхантеров|Спросить орка Хрыга/i.test(text)) {
      console.log('Шепот: гаунтлет пройден! Дальше сдача в Гильдии вичхантеров (stage 6).');
      shepotStage = 6;
      shepotGauntletFightsDone = 0;
      persistDailyQuestState();
      return true;
    }

    let match = SHEPOT_MONSTER_ITEMS.find(({ re }) => re.test(text));
    // Слово "ведьм" встречается и в ПОБЕДНОМ тексте ("Ведьма убита...", "Отбившись от ведьминых
    // прихвостней"), поэтому для ведьмы одного упоминания мало - нужна реальная кнопка атаки.
    // Живой случай 17.09.2026: после победы код начал копить HP, чтобы "атаковать" уже убитую
    // ведьму, и ждал впустую.
    if (match && match.item === null && !(await existsAnyText(page, ['Атаковать ведьму']))) {
      match = undefined;
    }
    if (!match) {
      // Живой факт 17.09.2026: после КАЖДОГО боя игра сама выбрасывает обратно на форпост
      // "Кулак Хаоса", но сцена гаунтлета остаётся ПОДВЕШЕННОЙ - в шапке появляется
      // "Продолжить квест". Следующий монстр выходит именно по этой ссылке. Раньше цикл её
      // между боями не проверял и вставал на "ambiguous" (на форпосте десяток обычных ссылок).
      if (await existsAnyText(page, ['Продолжить квест'])) {
        await clickByTexts(page, ['Продолжить квест'], 'Шепот: Продолжить квест (следующий монстр)');
        await pause(page, 800, 1500);
        continue;
      }
      // Подвешенной сцены нет - значит цепочка потеряна (вероятно, протухла за время ожидания
      // регенерации HP). Тогда гаунтлет начинается заново, с нежити - это не ошибка, просто
      // дороже по HP.
      if (await existsAnyText(page, ['К себе в дом'])) {
        console.log('Шепот: "Продолжить квест" нет - сцена потеряна, захожу в дом заново (гаунтлет начнётся с нежити).');
        await clickByTexts(page, ['К себе в дом'], 'Шепот: К себе в дом (рестарт гаунтлета)');
        await pause(page, 800, 1500);
        continue;
      }
      if (await existsAnyText(page, ['Ударить свинью'])) {
        await clickByTexts(page, ['Ударить свинью'], 'Шепот: Ударить свинью');
        await pause(page, 800, 1500);
        continue;
      }
      const stepped = await clickOnlySensibleOption(page, `Шепот/гаунтлет промежуточный экран ${i + 1}`);
      if (stepped.clicked) {
        await pause(page, 800, 1500);
        continue;
      }
      console.log(`Шепот: монстра на экране нет и линейного перехода нет (${stepped.reason}, кандидаты ${JSON.stringify(stepped.candidates)}) -> СТОП.`);
      return false;
    }

    if (!(await shepotWaitForHp(hpPage, hpFloor, `перед боем с "${match.name}"`))) return false;

    if (match.item) {
      if (!(await clickByTexts(page, [match.item], `Шепот: ${match.item} (${match.name})`))) {
        console.log(`Шепот: кнопка "${match.item}" не найдена -> СТОП.`);
        return false;
      }
    } else if (!(await clickByTexts(page, ['Атаковать ведьму'], 'Шепот: Атаковать ведьму!'))) {
      console.log('Шепот: "Атаковать ведьму" не найдено -> СТОП.');
      return false;
    }
    await pause(page, 800, 1500);

    if (!(await existsAnyText(page, ['В бой!', 'В бой']))) {
      console.log('Шепот: после предмета нет "В бой!" -> СТОП. Экран:');
      console.log(shepotSnap(await getBodyText(page), 1200));
      return false;
    }
    await clickByTexts(page, ['В бой!', 'В бой'], `Шепот: В бой! (${match.name})`);

    let won = false;
    try {
      won = await fightLoop(page);
    } catch (e) {
      const waitMinutes = parseCooldownError(e);
      if (waitMinutes !== null) {
        console.log(`Шепот: игровой кулдаун цели ${waitMinutes} мин -> жду на месте, сцену не покидаю.`);
        await new Promise((r) => setTimeout(r, (waitMinutes + 1) * 60000));
        continue;
      }
      console.log('Шепот: бой сорвался -', e.message);
      return false;
    }

    shepotGauntletFightsDone += 1;
    persistDailyQuestState();
    const hpAfter = await shepotReadHpFrom(hpPage);
    console.log(`Шепот: бой с "${match.name}" завершён (won=${won}), HP теперь ${hpAfter.hpCurrent}/${hpAfter.hpMax}`);
    await pause(page, 800, 1500);
  }

  console.log('Шепот: лимит боёв за один прогон исчерпан - выхожу, прогресс сохранён.');
  return true;
}

async function progressShepotQuestStage(page) {
  // Баг найден 17.09.2026: runShepotQuestIfAvailable вызывает эту функцию сразу после
  // resetToQuestMenu() (страница - меню квестов Q, там нет "Амулет"/"Конь"), а не после
  // возврата на location.php. Каждая стадия начинается с элементов location.php (Амулет/Конь/
  // "К себе в дом" и т.п.) - явно переходим туда в начале, не полагаясь на то, с какой страницы
  // нас позвали.
  await page.goto('http://lbast.ru/location.php', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  await pause(page, 500, 800);

  if (shepotStage === 0) {
    await clickByTexts(page, ['Амулет', 'Aмулет'], 'Шепот: Амулет');
    await pause(page, 800, 1200);
    await clickByTexts(page, ['Кулак Хаоса'], 'Шепот: Кулак Хаоса');
    await pause(page, 1500, 2500);
    if (await existsAnyText(page, ['К себе в дом'])) {
      await clickByTexts(page, ['К себе в дом'], 'Шепот: К себе в дом');
      await pause(page, 800, 1200);
    }
    const result = await shepotBlastThroughNarrative(page, {
      stopTexts: ['Зайти в церковь', 'Конь'],
      maxSteps: 30,
      label: 'интро',
    });
    if (result.reachedStop || result.maxStepsReached) {
      shepotStage = 1;
      persistDailyQuestState();
      return true;
    }
    console.log('Шепот stage 0 (интро): не завершилось само - нужна ручная проверка.');
    return false;
  }

  if (shepotStage === 1) {
    const ok = await shepotChurchToBar(page);
    if (ok) {
      shepotStage = 2;
      persistDailyQuestState();
    }
    return ok;
  }

  if (shepotStage === 2) {
    await clickByTexts(page, ['Конь'], 'Шепот: Конь');
    await pause(page, 800, 1200);
    await clickByTexts(page, ['Горы Дарии'], 'Шепот: Горы Дарии');
    await pause(page, 8000, 9000);
    await page.goto('http://lbast.ru/location.php', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    await pause(page, 500, 800);
    for (const dir of ['Идти на запад', 'Идти на юг', 'Идти на запад', 'Идти на запад', 'Идти на север', 'Идти на север', 'Идти на север']) {
      await clickByTexts(page, [dir], `Шепот: ${dir}`);
      await pause(page, 800, 1200);
    }
    await clickByTexts(page, ['Пройтись по утесу', 'Прогуляться по утесу'], 'Шепот: Пройтись по утесу');
    await pause(page, 800, 1200);
    if (!(await existsAnyText(page, ['В бой!', 'В бой']))) {
      console.log('Шепот stage 2: "В бой!" не найдено на утёсе - незнакомое состояние.');
      return false;
    }
    if (!(await shepotRunOneFight(page, 'Дух гнома'))) return false;
    await shepotBlastThroughNarrative(page, { stopTexts: [], maxSteps: 5, label: 'утёс-после-боя' });
    shepotStage = 3;
    persistDailyQuestState();
    return true;
  }

  if (shepotStage === 3) {
    await clickByTexts(page, ['Амулет', 'Aмулет'], 'Шепот: Амулет');
    await pause(page, 800, 1200);
    await clickByTexts(page, ['Девтаун'], 'Шепот: Девтаун');
    await pause(page, 1500, 2500);
    for (const dir of ['Идти на восток', 'Идти на восток']) {
      await clickByTexts(page, [dir], `Шепот: ${dir}`);
      await pause(page, 800, 1200);
    }
    await clickByTexts(page, ['Пристань'], 'Шепот: Пристань');
    await pause(page, 800, 1200);
    await clickByTexts(page, ['Взять лодку до острова Глинбаг'], 'Шепот: лодка до Глинбага (15 дин)');
    await pause(page, 800, 1200);
    await clickByTexts(page, ['Далее'], 'Шепот: Далее (после лодки)');
    await pause(page, 800, 1200);

    const glinbagRoute = [
      'Выйти на набережную',
      'Идти на север', 'Идти на север',
      'Идти на восток', 'Идти на восток', 'Идти на восток', 'Идти на восток',
      'Идти на юг', 'Идти на юг', 'Идти на юг',
      'Идти на запад',
      'Идти на юг',
      'Идти на запад',
      'Идти на север', 'Идти на север',
      'Идти на запад',
    ];
    for (const step of glinbagRoute) {
      await clickByTexts(page, [step], `Шепот: ${step}`);
      await pause(page, 700, 1100);
    }

    if (await existsAnyText(page, ['Пасечник'])) {
      await clickByTexts(page, ['Пасечник'], 'Шепот: Пасечник');
      await pause(page, 800, 1200);
    }
    await shepotBlastThroughNarrative(page, { stopTexts: ['В бой!', 'В бой'], maxSteps: 10, label: 'пасечник-диалог' });
    if (!(await existsAnyText(page, ['В бой!', 'В бой']))) {
      console.log('Шепот stage 3: "В бой!" (Тролль) не найдено - незнакомое состояние.');
      return false;
    }
    if (!(await shepotRunOneFight(page, 'Тролль'))) return false;
    if (await existsAnyText(page, ['Вернуться'])) {
      await clickByTexts(page, ['Вернуться'], 'Шепот: Вернуться (после Тролля)');
      await pause(page, 800, 1200);
    }
    shepotStage = 4;
    persistDailyQuestState();
    return true;
  }

  if (shepotStage === 4) {
    const ok = await shepotChurchToBar(page);
    if (ok) {
      shepotStage = 5;
      persistDailyQuestState();
    }
    return ok;
  }

  if (shepotStage === 5) {
    // 17.09.2026: гаунтлет обязан идти ОДНОЙ непрерывной сценой - подробности и причины
    // в комментарии над runShepotGauntletContinuous. Вторая вкладка нужна только для чтения
    // HP и питья эля, основная вкладка со сценой не покидается никогда.
    const hpPage = await page.context().newPage();
    try {
      return await runShepotGauntletContinuous(page, hpPage);
    } finally {
      await hpPage.close().catch(() => {});
    }
  }

  if (shepotStage === 6) {
    // Маршрут ПОДТВЕРЖДЁН живьём 17.09.2026. В гайде Kate2008 его нет вообще - гайд обрывается
    // на "Как можно быстрее нужно попасть в Гильдию вичхантеров". Паша подсказал город и ворота
    // (сначала назвал восточные - там гильдии нет, проверено; она у СЕВЕРНЫХ ворот Стоунгарда).
    // Точный текст ссылки входа: "Гильдия вичхантеров". Награда за сдачу: 274 дин.
    const GUILD = 'Гильдия вичхантеров';

    if (!(await existsAnyText(page, [GUILD]))) {
      await clickByTexts(page, ['Амулет', 'Aмулет'], 'Шепот: Амулет');
      await pause(page, 800, 1200);
      await clickByTexts(page, ['Стоунгард'], 'Шепот: Стоунгард');
      await pause(page, 1500, 2500);
      await page.goto('http://lbast.ru/location.php', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
      await pause(page, 600, 1000);
      if (await existsAnyText(page, ['Северные ворота'])) {
        await clickByTexts(page, ['Северные ворота'], 'Шепот: Северные ворота Стоунгарда');
        await pause(page, 800, 1200);
      }
    }

    if (!(await existsAnyText(page, [GUILD]))) {
      console.log('Шепот stage 6: "Гильдия вичхантеров" не найдена -> СТОП.');
      return false;
    }

    await clickByTexts(page, [GUILD], `Шепот: вход в ${GUILD}`);
    await pause(page, 900, 1400);

    // Реплики сдачи подтверждены живьём, слово в слово (совпали с гайдом).
    const TURN_IN_DIALOG = [
      'Спросить орка Хрыга',
      'Нет... А что это?',
      'Но теперь ведьма мертва, все в порядке?',
      'Взять и уйти',
    ];
    for (const line of TURN_IN_DIALOG) {
      if (!(await existsAnyText(page, [line]))) {
        console.log(`Шепот stage 6: реплика "${line}" не найдена -> СТОП.`);
        return false;
      }
      await clickByTexts(page, [line], `Шепот: ${line}`);
      await pause(page, 800, 1300);
    }

    console.log('Шепот: квест сдан, награда получена. Следующий заход - в следующем месяце.');
    shepotStage = 0;
    shepotGauntletFightsDone = 0;
    shepotDoneThisMonth = true;
    persistDailyQuestState();
    return true;
  }

  console.log(`Шепот: неизвестная стадия ${shepotStage} - сбрасываю на 0.`);
  shepotStage = 0;
  persistDailyQuestState();
  return false;
}

// Точка входа для driver.js: гейтит по разу-в-месяц и по наличию квеста в Q-меню (когда
// stage=0, т.е. квест ещё не в процессе), делает ОДИН логический шаг за вызов (не весь квест
// разом) - специально, чтобы driver.js мог продолжать обычный цикл (фарм/другие квесты/чат)
// между шагами, и чтобы HP-гейты внутри имели шанс сработать между вызовами, а не в одном
// монолитном забеге.
async function runShepotQuestIfAvailable(page) {
  const month = getMonthKeyNow();
  if (shepotMonthKey !== month) {
    shepotMonthKey = month;
    shepotDoneThisMonth = false;
    persistDailyQuestState();
  }
  if (shepotDoneThisMonth) return false;

  if (shepotStage === 0) {
    const menuOpened = await resetToQuestMenu(page);
    if (!menuOpened) return false;
    const qNames = parseQuestNamesFromQMenuText(await getBodyText(page));
    if (!isQuestInMenu(qNames, 'Шепот')) return false;
  }

  return await runNonQQuestSafe(page, 'Шепот quest', () => progressShepotQuestStage(page));
}

module.exports = {
  doScenario,
  parseStats,
  getBodyText,
  pause,
  fixedPause,
  handleUnreadMailIfAny,
  recoverToCity,
  saveSnapshot,
  goToLocationAndReadStats,
  fightLoop,
  clickByTexts,
  runDailyQuests,
  goToChaosByAmulet,
  progressLifeTreeQuest,
  progressFisherFoodQuest,
  resetToQuestMenu,
  clickInfoForQuest,
  existsAnyText,
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
  replyToLetter,
  ensureBuffAlesActive,
  isAnyBuffAleActive,
  runHerbQuestsIfAvailable,
  runThursdayDailiesIfAvailable,
  hasPendingFightQuests,
  resolvePendingFightIfAny,
  runFishingIfDue,
  runOrdoQuestsIfAvailable,
  escapeStuckSceneIfAny,
  readDailyTasksProgress,
  getPlayerRaceAndFaction,
  postChatMessage,
  getRecentChatMessages,
  extractChatMessagesSection,
  parseChatMessages,
  detectChatTriggers,
  chatMessageAgeMinutes,
  emitChatTrigger,
  AI_SELF_NICK,
  sendPrivateLetter,
  CHAT_ROOMS,
  runChatMonitorCycle,
  runStatueOfGloryIfDue,
  runStatueOfGloryTask,
  ensureTavernQuestTurnedIn,
  resetToQuestMenu,
  fightLoop,
  clickByTexts,
  fixedPause,
  scheduleNextStatueOfGlory,
  waitForHpAbove,
  clickOnlySensibleOption,
  runShepotQuestIfAvailable,
  readCurrentAssignment,
  dropCurrentAssignment,
  hasAlreadyHasQuestText,
  runDovolstvieIfAvailable,
};
