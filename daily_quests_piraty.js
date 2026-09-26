// Scenario: Daily Quests

const { chromium } = require('playwright');
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

// Квесты, записанные маршрутом в guides/*.steps (см. guides/quests.js). Раннер общий и ничего
// отсюда не импортирует -- бой и меню квестов передаются ему параметрами из runDailyQuests.
const { runGuideQuestsIfDue, hasGuideQuestInProgress, GUIDE_QUESTS } = require('./guides/quests');
const { runGalleryLazuliteQuest } = require('./guides/gallery');
const { runFishRestaurantQuest } = require('./guides/fish_restaurant');

// За сколько до мисттаунского события не начинать длинную цепочку по маршруту.
const GUIDE_QUEST_MISTTOWN_GUARD_MS = 90 * 60 * 1000;

// За сколько до мисттаунского события цикл вообще ничего не делает, а копит резерв: бои и переходы
// тратят резерв (~1 мин восстанавливается за минуту), а без него игра не пустит ни вниз, ни в бой.
const MISTTOWN_PREP_GUARD_MS = 25 * 60 * 1000;

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
const SELF_NICK = 'tsunami';
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
const SHTOLNI_MIN_HP = 2000;
const SHTOLNI_MIN_RESERVE_MINUTES = 20;
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

// Рыбалка: не более 6 успешных уловов в день, кулдаун 2 минуты между попытками —
// пробуем между квестами каждый цикл, пока не наловим лимит. Никогда не запускается из фарма Блейка.
// Также используется во время восстановления в Последнем доме (см. runLastHouseRecovery).
const FISHING_DAILY_CATCH_LIMIT = 6;
const FISHING_ATTEMPT_COOLDOWN_MS = 2 * 60 * 1000;
let fishingDayKey = '';
let fishingCatchesToday = 0;
let lastFishingAttemptAt = 0;

// Утренний скриншот для Telegram: раз в день, как можно раньше в первом же цикле после смены дня.
// Маршрут: Стоунгард (Fastway) -> Центральная площадь -> Уличный зазывала.
let morningScreenshotDayKey = '';
let morningScreenshotDoneToday = false;

// Порог HP, при котором можно продолжать обычные действия (квесты) или биться с Блейком —
// используется и как условие выхода из критического восстановления в Последнем доме.
const BLAKE_MIN_HP = 1800;

// Цель фарма после квестов: 'blake' (по умолчанию), 'goblins' или 'yantar' (Янтарная гора).
// Задаётся менеджером через переменную окружения FARM_TARGET при запуске сценария (кнопки
// "Квесты + Блейки" / "Квесты + Гоблины" / "Квесты + Янтарная гора").
// Янтарная гора ведёт себя ТОЧНО как Блейк (Паша, 24.09.2026: "сделай идентично блейкам, это
// тоже в море"): остров за платной лодкой, поэтому те же пороги HP и то же правило "с острова
// ради филлеров не уходим" -- в отличие от гоблинов, к которым ведёт бесплатный портал.
const FARM_TARGETS = ['blake', 'goblins', 'yantar'];
const FARM_TARGET_RAW = String(process.env.FARM_TARGET || 'blake').toLowerCase();
const FARM_TARGET = FARM_TARGETS.includes(FARM_TARGET_RAW) ? FARM_TARGET_RAW : 'blake';
const FARM_LABEL = { blake: 'Блейка', goblins: 'гоблинов', yantar: 'Янтарной горой' }[FARM_TARGET];
console.log(`Farm target: ${FARM_TARGET}`);

// Отложенный старт (менеджер, кнопка "Старт Nч") передаёт момент, когда пора включать обычный
// сценарий (квесты/фарм) -- сам браузер/процесс при этом поднимается сразу, а не через N часов,
// чтобы не пропустить мисттаунское событие ("призрак ворот"), если оно выпадает раньше. До этого
// момента процесс только ждёт и ловит due-событие; после -- сам переходит в обычный цикл без
// перезапуска. При запуске без этой переменной (обычный/немедленный старт) ведёт себя как раньше.
const FARM_START_AFTER_MS = Number(process.env.FARM_START_AFTER) || null;


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
let fisherFoodDayKey = '';
let fisherFoodDoneToday = false;
let caravanRobberyDayKey = '';
let caravanRobberyDoneToday = false;
let allowanceDayKey = '';
let allowanceDoneToday = false;
let elkHuntDayKey = '';
let elkHuntDoneToday = false;
let demonHuntDayKey = '';
let demonHuntDoneToday = false;
let schoolTempleDayKey = '';
let schoolTempleDoneToday = false;
// Ордо Экзекуторс: у каждого из двух заданий свой запрет после победы (час на главаря, 10 мин на
// банду), плюс бэкоффы на случай "не выдали задание"/"кончился резерв". Ключ -> timestamp, раньше
// которого к башне не ходим. ordoItemsCollected -- счётчик квестовых предметов, добытых ботом
// (Медальон бандита / Костяная цепь бандита); мы их НЕ сдаём, а копим, поэтому это просто
// накопительный счётчик для лога, переживающий перезапуск процесса.
let ordoNextTryAt = {};
let ordoItemsCollected = 0;
// Галерея искусств (лазулиты): многоразовый квест Рыбацкой деревни. В меню Q не показывается,
// поэтому единственный гейт -- собственный период. 25.09.2026 сразу после сдачи в каталоге
// встало «через 6 дн.», значит период около недели.
let galleryLastDoneAt = 0;
const GALLERY_PERIOD_MS = 7 * 24 * 60 * 60 * 1000;
// Порогов для этого квеста Паша не задавал -- это осторожный дефолт: в сценке два боя подряд
// плюс десяток переходов.
const GALLERY_MIN_RESERVE_MINUTES = 15;
const GALLERY_MIN_HP = 1300;
// Рыбный ресторан (Гретхис): ежедневный квест форта «Жженый лист». Пороги -- по замеру 26.09.2026:
// за прогон резерв ушёл с 23 до -4, с вынужденным отдыхом 5 мин посреди сцены, поэтому 25 минут,
// а не 15. HP -- как у Кораблекрушения: в худших ветках два-три боя подряд.
const FISH_RESTAURANT_MIN_RESERVE_MINUTES = 25;
const FISH_RESTAURANT_MIN_HP = 1300;
// Мисттаунское событие "Тайны ...": дата+время старта для каждой из 4 тем, полученные от
// уличного зазывалы и закэшированные, чтобы не ходить к нему каждый цикл (см. комментарий у
// goToMisttownSecretArea/runMisttownSecretEventIfDue). misttownSecretAttemptedAt хранит,
// какой именно запуск (по значению dueAt) уже пробовали, чтобы не повторять один и тот же запуск
// после наступления его времени, пока не появится следующая дата.
let misttownSecretDueAt = {};
let misttownSecretAttemptedAt = {};
let lastMisttownSecretCheckAt = 0;
// Ставится в true сразу после выстрела из лука в мисттаунском событии; сбрасывается после
// успешного фарма стрелы у Старого лучника (см. maybeFarmArrow). Требует >=10 резервных минут и
// >2000 HP -- два обычных боя с волками, не должны начинаться на пустом резерве/HP.
let needsArrowFarm = false;
const ARROW_FARM_MIN_RESERVE_MINUTES = 10;
const ARROW_FARM_MIN_HP = 2000;
let extraDailyDayKey = '';
let extraDailyDoneToday = false;
// Thursday's 3 hunts each hit a real in-game per-target attack cooldown ("Вы слишком устали,
// приходите через N мин"), same as regular farm cooldown. Turns out Wednesday's (and the boar/
// bison/varan routes shared with Friday/Sunday) hit the exact same cooldown -- see huntStateDayKey
// below -- so progress there is tracked per-fight too and can span multiple cycles.
let thursdayDayKey = '';
let thursdayGravediggerDoneToday = false;
let thursdayButcherFightsToday = 0;
let thursdayWitchFightsToday = 0;
// Shared per-fight progress for the boar/bison/varan hunts (used by Wednesday/Friday/Sunday) and
// Wednesday's mountain-spirit/hyena hunts. Only one weekday's extra daily runs on any given real
// day, so a single day-keyed reset is enough -- no separate state needed per weekday.
let huntStateDayKey = '';
let wednesdayMountainSpiritDoneToday = false;
let wednesdayHyenaFightsToday = 0;
let boarHuntFightsToday = 0;
let bisonHuntFightsToday = 0;
let varanHuntFightsToday = 0;
let harpyHuntFightsToday = 0;

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

  if (typeof s.tavernDayKey === 'string') tavernDayKey = s.tavernDayKey;
  if (typeof s.tavernDoneToday === 'boolean') tavernDoneToday = s.tavernDoneToday;

  if (typeof s.shtolniDayKey === 'string') shtolniDayKey = s.shtolniDayKey;
  if (typeof s.shtolniDoneToday === 'boolean') shtolniDoneToday = s.shtolniDoneToday;

  if (typeof s.rumaForgeDayKey === 'string') rumaForgeDayKey = s.rumaForgeDayKey;
  if (typeof s.rumaForgeDoneToday === 'boolean') rumaForgeDoneToday = s.rumaForgeDoneToday;

  if (typeof s.fisherFoodDayKey === 'string') fisherFoodDayKey = s.fisherFoodDayKey;
  if (typeof s.fisherFoodDoneToday === 'boolean') fisherFoodDoneToday = s.fisherFoodDoneToday;

  if (typeof s.caravanRobberyDayKey === 'string') caravanRobberyDayKey = s.caravanRobberyDayKey;
  if (typeof s.caravanRobberyDoneToday === 'boolean') caravanRobberyDoneToday = s.caravanRobberyDoneToday;

  if (typeof s.allowanceDayKey === 'string') allowanceDayKey = s.allowanceDayKey;
  if (typeof s.allowanceDoneToday === 'boolean') allowanceDoneToday = s.allowanceDoneToday;

  if (typeof s.elkHuntDayKey === 'string') elkHuntDayKey = s.elkHuntDayKey;
  if (typeof s.elkHuntDoneToday === 'boolean') elkHuntDoneToday = s.elkHuntDoneToday;

  if (typeof s.demonHuntDayKey === 'string') demonHuntDayKey = s.demonHuntDayKey;
  if (typeof s.demonHuntDoneToday === 'boolean') demonHuntDoneToday = s.demonHuntDoneToday;

  if (typeof s.schoolTempleDayKey === 'string') schoolTempleDayKey = s.schoolTempleDayKey;
  if (typeof s.schoolTempleDoneToday === 'boolean') schoolTempleDoneToday = s.schoolTempleDoneToday;

  if (s.ordoNextTryAt && typeof s.ordoNextTryAt === 'object') ordoNextTryAt = s.ordoNextTryAt;
  if (Number.isFinite(s.ordoItemsCollected)) ordoItemsCollected = s.ordoItemsCollected;
  if (Number.isFinite(s.galleryLastDoneAt)) galleryLastDoneAt = s.galleryLastDoneAt;

  if (s.misttownSecretDueAt && typeof s.misttownSecretDueAt === 'object') misttownSecretDueAt = s.misttownSecretDueAt;
  if (s.misttownSecretAttemptedAt && typeof s.misttownSecretAttemptedAt === 'object') misttownSecretAttemptedAt = s.misttownSecretAttemptedAt;
  if (Number.isFinite(s.lastMisttownSecretCheckAt)) lastMisttownSecretCheckAt = s.lastMisttownSecretCheckAt;
  if (typeof s.needsArrowFarm === 'boolean') needsArrowFarm = s.needsArrowFarm;

  if (typeof s.extraDailyDayKey === 'string') extraDailyDayKey = s.extraDailyDayKey;
  if (typeof s.extraDailyDoneToday === 'boolean') extraDailyDoneToday = s.extraDailyDoneToday;

  if (typeof s.thursdayDayKey === 'string') thursdayDayKey = s.thursdayDayKey;
  if (typeof s.thursdayGravediggerDoneToday === 'boolean') thursdayGravediggerDoneToday = s.thursdayGravediggerDoneToday;
  if (Number.isFinite(s.thursdayButcherFightsToday)) thursdayButcherFightsToday = s.thursdayButcherFightsToday;
  if (Number.isFinite(s.thursdayWitchFightsToday)) thursdayWitchFightsToday = s.thursdayWitchFightsToday;

  if (typeof s.huntStateDayKey === 'string') huntStateDayKey = s.huntStateDayKey;
  if (typeof s.wednesdayMountainSpiritDoneToday === 'boolean') wednesdayMountainSpiritDoneToday = s.wednesdayMountainSpiritDoneToday;
  if (Number.isFinite(s.wednesdayHyenaFightsToday)) wednesdayHyenaFightsToday = s.wednesdayHyenaFightsToday;
  if (Number.isFinite(s.boarHuntFightsToday)) boarHuntFightsToday = s.boarHuntFightsToday;
  if (Number.isFinite(s.bisonHuntFightsToday)) bisonHuntFightsToday = s.bisonHuntFightsToday;
  if (Number.isFinite(s.varanHuntFightsToday)) varanHuntFightsToday = s.varanHuntFightsToday;
  if (Number.isFinite(s.harpyHuntFightsToday)) harpyHuntFightsToday = s.harpyHuntFightsToday;

  if (typeof s.fishingDayKey === 'string') fishingDayKey = s.fishingDayKey;
  if (Number.isFinite(s.fishingCatchesToday)) fishingCatchesToday = s.fishingCatchesToday;

  if (typeof s.morningScreenshotDayKey === 'string') morningScreenshotDayKey = s.morningScreenshotDayKey;
  if (typeof s.morningScreenshotDoneToday === 'boolean') morningScreenshotDoneToday = s.morningScreenshotDoneToday;
}

restoreDailyQuestState();

function persistDailyQuestState() {
  Object.assign(persistedState, {
    lastLifeTreeRunAt, lifeTreeDayKey, lifeTreeRunsToday,
    lastFishEyeRunAt, fishEyeDayKey, fishEyeFightsToday, fishEyeRewardClaimedToday,
    lastDrabasRunAt, drabasDayKey, drabasRunsToday,
    lastVinogradRunAt,
    lastStatueRunAt, nextStatueDueAt,
    tavernDayKey, tavernDoneToday,
    shtolniDayKey, shtolniDoneToday,
    rumaForgeDayKey, rumaForgeDoneToday,
    fisherFoodDayKey, fisherFoodDoneToday,
    caravanRobberyDayKey, caravanRobberyDoneToday,
    allowanceDayKey, allowanceDoneToday,
    elkHuntDayKey, elkHuntDoneToday,
    demonHuntDayKey, demonHuntDoneToday,
    schoolTempleDayKey, schoolTempleDoneToday,
    ordoNextTryAt, ordoItemsCollected, galleryLastDoneAt,
    misttownSecretDueAt, misttownSecretAttemptedAt, lastMisttownSecretCheckAt, needsArrowFarm,
    extraDailyDayKey, extraDailyDoneToday,
    thursdayDayKey, thursdayGravediggerDoneToday, thursdayButcherFightsToday, thursdayWitchFightsToday,
    huntStateDayKey, wednesdayMountainSpiritDoneToday, wednesdayHyenaFightsToday,
    boarHuntFightsToday, bisonHuntFightsToday, varanHuntFightsToday, harpyHuntFightsToday,
    fishingDayKey, fishingCatchesToday,
    morningScreenshotDayKey, morningScreenshotDoneToday,
  });
  saveStateToDisk(persistedState);
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

async function getMailCountFromPage(page) {
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

function buildMailSignature(mail) {
  return [
    String(mail?.sender || '').trim(),
    String(mail?.date || '').trim(),
    String(mail?.body || '').trim().slice(0, 500),
  ].join('|');
}

async function openMailbox(page) {
  const ok = await clickByTexts(page, ['Письма'], 'Письма');

  if (!ok) {
    console.log('Не удалось нажать на "Письма"');
    return false;
  }

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

  console.log('??????? ????? ??????: ' + mailCount);

  let openedMailbox = false;
  const handledSignatures = new Set();
  let handledAny = false;

  try {
    openedMailbox = await openMailbox(page);

    if (!openedMailbox) {
      console.log('?? ??????? ??????? ?????? ??????');
      return false;
    }

    for (let i = 0; i < mailCount; i++) {
      if (i > 0) {
        openedMailbox = await openMailbox(page);
        if (!openedMailbox) {
          console.log('?? ??????? ?????? ??????? ?????? ??????');
          break;
        }
      }

      const openedThread = await clickMailThread(page, true);
      if (!openedThread) {
        if (i === 0) {
          console.log('?? ??????? ??????? ?? ???? ????????????? ??????');
          return false;
        }
        break;
      }

      const mail = await readCurrentMail(page);
      if (!mail) {
        console.log('?? ??????? ????????? ??????');
        break;
      }

      const signature = buildMailSignature(mail);
      if (handledSignatures.has(signature)) {
        console.log('????????? ?? ?? ?????? ????????, ???????????? ?????? ?????');
        break;
      }

      handledSignatures.add(signature);
      handledAny = true;

      if (signature === lastHandledMailSignature) {
        console.log('??? ?????? ??? ????????? ? Telegram, ???????? ?? ???');
      } else {
        lastHandledMailSignature = signature;

        emitMailMessage({
          sender: mail.sender,
          body: mail.body,
        });

        console.log('?????? ' + (i + 1) + '/' + mailCount + ' ?????????? ? Telegram ????? manager_bot.js');
      }
    }

    return handledAny;
  } catch (e) {
    console.log('?????? ????????? ??????: ' + e.message);
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
}

function isExclusiveQQuestInProgress() {
  checkExclusiveQuestTimeouts();
  const now = Date.now();
  const tavernActive = tavernTakenToday && !tavernDoneToday && now >= tavernSuppressedUntil;
  const shtolniActive = shtolniTakenToday && !shtolniDoneToday && now >= shtolniSuppressedUntil;
  return tavernActive || shtolniActive;
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

  const qMatch = normalized.match(/\bQ\s*(\d+)\b/i);
  const dMatch = normalized.match(/\bD\s*(\d+)\b/i);
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
  const variants = [];
  if (Number.isFinite(questCount) && questCount > 0) {
    variants.push(`Q${questCount}`);
  }
  variants.push('Q', '\u041a\u0432\u0435\u0441\u0442\u044b', '\u043a\u0432\u0435\u0441\u0442\u044b');

  const ok = await clickByTexts(page, variants, 'open quests menu');
  if (!ok) {
    return false;
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

  // Finally: only attempt turn-in after all 3 bot steps are completed.
  // Otherwise we can incorrectly "report" without having anything to report.
  if (botsDone) {
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

async function runQuestStepSafe(page, label, fn) {
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
    return ok;
  } catch (e) {
    // Пауза -- не ошибка квеста: ни логов о провале, ни recoverToCity (он бы увёл страницу).
    if (isScenarioPausedError(e)) throw e;
    console.log(`Quest step error (${label}): ${e.message}`);
    await recoverToCity(page, `${label}: ${e.message}`);

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

  // Exclusive quests: while one of these is in progress, do not start any other Q-quests.
  const exclusiveInProgress = [];
  const now = Date.now();
  const tavernSuppressed = now < tavernSuppressedUntil;
  const shtolniSuppressed = now < shtolniSuppressedUntil;
  if (tavernTakenToday && !tavernDoneToday && !tavernSuppressed) exclusiveInProgress.push('Харчевня');
  if (shtolniTakenToday && !shtolniDoneToday && !shtolniSuppressed) exclusiveInProgress.push('Штольни');
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
    'Варьете',
    'Рыбный ресторан',
    // Квесты по записанным маршрутам берём прямо из реестра guides/quests.js -- иначе каждый
    // новый .steps пришлось бы дублировать ещё и здесь, и забытый квест молча уступал бы ферме.
    ...GUIDE_QUESTS.map((q) => q.name),
    ...ORDO_QUESTS.map((q) => q.menu),
  ];

  // Начатая цепочка по маршруту (guides/*.steps) из меню Q пропадает -- квест уже взят, а сцена
  // живёт на локации. Считаем её "целевым квестом", иначе цикл решит, что делать нечего, и уедет
  // фармить на Блейка (платный проход), бросив недоигранную сцену.
  const hasAnyTargetQuest = TARGET_Q_QUESTS.some((q) => isQuestInMenu(listedQuests, q))
    || hasGuideQuestInProgress();

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

  // Искать травы: список доступных трав виден прямо в тексте меню квестов, отдельный кулдаун-таймер
  // не нужен -- игра сама не покажет траву, если та ещё не выросла. Пробуем в этом же цикле ВСЕ
  // травы, которые окажутся доступны одновременно (не только первую), чтобы не растягивать сбор на
  // несколько циклов, если игра предложила сразу несколько разом.
  if (exclusiveInProgress.length === 0) {
    let herbMenuText = menuText;
    for (const herbName of HERB_QUEST_NAMES) {
      if (!herbMenuText.includes(herbName)) continue;
      const herbOk = await runQuestStepSafe(page, herbName, () => progressHerbQuest(page, herbName, { questCount }));
      if (herbOk) {
        didAnything = true;
      }

      // Семя винограда нужно посадить сразу же, а не ждать своего 8-часового таймера полива --
      // иначе оно просто пролежит в инвентаре до следующего захода на виноградник.
      if (herbOk && herbName === 'Семя винограда') {
        console.log('Виноград: только что собрали семя, сразу иду сажать');
        await runVinogradTask(page);
        lastVinogradRunAt = Date.now();
        persistDailyQuestState();
      }

      await resetToQuestMenu(page, questCount);
      herbMenuText = await getBodyText(page);
      listedQuests = parseQuestNamesFromQMenuText(herbMenuText);
    }
  }

  if (!shtolniSuppressed && isQQuestAllowed('Штольни') && isQuestInMenu(listedQuests, 'Штольни') && !(tavernTakenToday && !tavernDoneToday)) {
    const shtolniInProgress = shtolniTakenToday && !shtolniDoneToday;
    if (!shtolniInProgress && (typeof reserveMinutes !== 'number' || reserveMinutes < 20)) {
      console.log(`Quest step skip: Штольни (need >=20 reserve minutes to start, have=${reserveMinutes ?? 'n/a'})`);
    } else {
      if (await runQuestStepSafe(page, 'Штольни', () => progressShtolniQuest(page))) {
        didAnything = true;
      }
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

  // Варьете: длинная линейная цепочка диалогов + один бой, появляется от случая к случаю (не
  // привязана к дню недели). Требуем достаточный запас времени до кулдауна, как и другие
  // Q-квесты с реальным переходом на карту, чтобы не начинать длинный маршрут перед самым
  // кулдауном/атакой.
  if (isQQuestAllowed('Варьете') && isQuestInMenu(listedQuests, 'Варьете')) {
    if (typeof reserveMinutes !== 'number' || reserveMinutes < 15) {
      console.log(`Quest step skip: Варьете (need >=15 reserve minutes, have=${reserveMinutes ?? 'n/a'})`);
    } else {
      if (await runQuestStepSafe(page, 'Варьете', () => progressVarieteQuest(page, { questCount }))) {
        didAnything = true;
      }
    }
    await resetToQuestMenu(page, questCount);
    listedQuests = parseQuestNamesFromQMenuText(await getBodyText(page));
  }

  // Рыбный ресторан: ежедневный квест форта «Жженый лист». Ветка выбирается не здесь, а внутри
  // прохождения -- по [Журнал наград], который виден только у взятого задания (см. комментарий в
  // guides/fish_restaurant.js). Поэтому гейт тут обычный: квест в меню, есть резерв и HP.
  if (isQQuestAllowed('Рыбный ресторан') && isQuestInMenu(listedQuests, 'Рыбный ресторан')) {
    const restMisttownSoon = misttownSecretDueWithinMs(GUIDE_QUEST_MISTTOWN_GUARD_MS);
    const restHp = typeof stats?.hpCurrent === 'number' ? stats.hpCurrent : null;
    if (restMisttownSoon) {
      console.log(`Ресторан: пропускаю, скоро мисттаунское событие (${restMisttownSoon}).`);
    } else {
      await runQuestStepSafe(page, 'Рыбный ресторан', () => runFishRestaurantQuest(page, {
        fightLoop,
        throwIfPaused: throwIfPausedByManager,
        resetToQuestMenu: (p) => resetToQuestMenu(p, questCount),
        clickInfoForQuest,
        hpCurrent: restHp,
        reserveMinutes,
        minHp: FISH_RESTAURANT_MIN_HP,
        minReserveMinutes: FISH_RESTAURANT_MIN_RESERVE_MINUTES,
      })) && (didAnything = true);
    }
    await resetToQuestMenu(page, questCount);
    listedQuests = parseQuestNamesFromQMenuText(await getBodyText(page));
  }

  // Ордо Экзекуторс: задания берутся не из меню Q, а в самой башне -- меню только объявляет, что
  // они доступны. Занимают слот "Текущее задание", поэтому только когда эксклюзивного квеста нет.
  // Маршрут длинный (башня -> миссия -> башня), так что перед мисттаунским событием не начинаем.
  if (exclusiveInProgress.length === 0) {
    const ordoMisttownSoon = misttownSecretDueWithinMs(GUIDE_QUEST_MISTTOWN_GUARD_MS);
    if (ordoMisttownSoon && ORDO_QUESTS.some((q) => isQuestInMenu(listedQuests, q.menu))) {
      console.log(`Ордо: пропускаю, скоро мисттаунское событие (${ordoMisttownSoon}).`);
    } else if (!ordoMisttownSoon) {
      const didOrdo = await runOrdoQuestsIfAvailable(page, {
        listedQuests,
        reserveMinutes,
        hpCurrent: typeof stats?.hpCurrent === 'number' ? stats.hpCurrent : null,
      });
      if (didOrdo) {
        didAnything = true;
        await resetToQuestMenu(page, questCount);
        listedQuests = parseQuestNamesFromQMenuText(await getBodyText(page));
      }
    }
  }

  // Галерея искусств (лазулиты): в меню Q не показывается вообще, берётся прямо у Марсиуса в
  // Рыбацкой деревне, поэтому гейт только по собственному периоду. Маршрут -- guides/gallery.js.
  if (exclusiveInProgress.length === 0 && Date.now() - galleryLastDoneAt >= GALLERY_PERIOD_MS) {
    const galleryMisttownSoon = misttownSecretDueWithinMs(GUIDE_QUEST_MISTTOWN_GUARD_MS);
    const galleryHp = typeof stats?.hpCurrent === 'number' ? stats.hpCurrent : null;
    if (galleryMisttownSoon) {
      console.log(`Галерея: пропускаю, скоро мисттаунское событие (${galleryMisttownSoon}).`);
    } else if (typeof reserveMinutes !== 'number' || reserveMinutes < GALLERY_MIN_RESERVE_MINUTES) {
      console.log(`Галерея: пропускаю (нужно >=${GALLERY_MIN_RESERVE_MINUTES} резервных минут, есть=${reserveMinutes ?? 'n/a'})`);
    } else {
      const galleryOk = await runNonQQuestSafe(page, 'Галерея искусств', () => runGalleryLazuliteQuest(page, {
        fightLoop,
        throwIfPaused: throwIfPausedByManager,
        hpCurrent: galleryHp,
        minHp: GALLERY_MIN_HP,
      }));
      if (galleryOk) {
        didAnything = true;
        galleryLastDoneAt = Date.now();
        persistDailyQuestState();
      }
      await resetToQuestMenu(page, questCount);
      listedQuests = parseQuestNamesFromQMenuText(await getBodyText(page));
    }
  }

  // Квесты по записанным маршрутам (guides/*.steps): длинные цепочки из ЖГ-гайдов, которые
  // расписаны пошагово и выполняются общим раннером. Он сам лечится на месте перед боями, ждёт
  // отдых при кончившемся резерве и останавливается, если игра разошлась с маршрутом (тогда
  // guides/quests.js ставит паузу, а не долбит одно и то же). Не запускаем, пока идёт
  // эксклюзивный квест (Харчевня/Штольни) -- они занимают тот же слот задания.
  if (exclusiveInProgress.length === 0) {
    // Цепочка занимает цикл надолго (лечение на месте, отдых, десятки экранов), а мисттаунское
    // событие идёт строго по часам -- поэтому перед ним за маршрут не беремся.
    const misttownSoon = misttownSecretDueWithinMs(GUIDE_QUEST_MISTTOWN_GUARD_MS);
    if (misttownSoon) {
      console.log(`Квесты по маршрутам: пропускаю, скоро мисттаунское событие (${misttownSoon}).`);
    } else {
      try {
        const didGuide = await runGuideQuestsIfDue(page, {
          fightLoop,
          resetToQuestMenu,
          clickInfoForQuest,
          reserveMinutes,
          hpCurrent: typeof stats?.hpCurrent === 'number' ? stats.hpCurrent : null,
          isInMenu: (name) => isQuestInMenu(listedQuests, name),
          throwIfPaused: throwIfPausedByManager,
        });
        if (didGuide) didAnything = true;
      } catch (e) {
        if (isScenarioPausedError(e)) throw e;
        console.log(`Квесты по маршрутам: ошибка (${e.message})`);
      }
      await resetToQuestMenu(page, questCount);
      listedQuests = parseQuestNamesFromQMenuText(await getBodyText(page));
    }
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

// Утренний скриншот: раз в день, отправляется в самом начале первого цикла после смены дня
// (см. вызов в doScenario) — при неудаче флаг не выставляется, и следующий цикл пробует снова.
function canRunMorningScreenshotNow() {
  const key = getDayKeyNow();
  if (morningScreenshotDayKey !== key) {
    morningScreenshotDayKey = key;
    morningScreenshotDoneToday = false;
  }
  return !morningScreenshotDoneToday;
}

function canRunAllowanceNow() {
  const key = getDayKeyNow();
  if (allowanceDayKey !== key) {
    allowanceDayKey = key;
    allowanceDoneToday = false;
  }
  return !allowanceDoneToday;
}

// Elk hunting spot ("бот" killable once/day server-wide) can simply be absent when we arrive —
// that's normal, not an error. Either outcome (fought it, or found it already gone) means today
// is done; only tomorrow's dayKey re-opens the attempt.
function canRunElkHuntNow() {
  const key = getDayKeyNow();
  if (elkHuntDayKey !== key) {
    elkHuntDayKey = key;
    elkHuntDoneToday = false;
  }
  return !elkHuntDoneToday;
}

// Охота на демона: личный квест (взять у NPC в Цитадели -> убить -> доложить), раз в день,
// не привязан к дню недели. Как оказалось на практике, сервер всё равно может показать "Вы уже
// выполняли это задание сегодня" по пути к цели (см. проверку в runDemonHuntTask) -- обрабатываем
// это как нормальный "уже сделано" исход, как и в Охоте на лосей.
function canRunDemonHuntNow() {
  const key = getDayKeyNow();
  if (demonHuntDayKey !== key) {
    demonHuntDayKey = key;
    demonHuntDoneToday = false;
  }
  return !demonHuntDoneToday;
}

// Квест (школа/казарма/храм, название пока не уточнено): личный квест, раз в день, требует >=20
// резервных минут (проверка в дозвоне ниже). Если маршрут внутри runSchoolTempleQuest прерывается
// (в т.ч. из-за собственных действий пользователя в игре параллельно с ботом), попытка на сегодня
// всё равно считается использованной -- сервер сам отменяет выполнение при нарушении маршрута, и
// повторная попытка в тот же день не поможет, поэтому не ретраим внутри дня.
function canRunSchoolTempleQuestNow() {
  const key = getDayKeyNow();
  if (schoolTempleDayKey !== key) {
    schoolTempleDayKey = key;
    schoolTempleDoneToday = false;
  }
  return !schoolTempleDoneToday;
}

// Extra daily ("дейлик"): a bonus task for extra reward whose route changes by day of week.
// Only days present in EXTRA_DAILY_TASKS below have a known route; other days are simply skipped
// (not marked done) until their route is added. getDay(): 0=Вс, 1=Пн, 2=Вт, 3=Ср, 4=Чт, 5=Пт, 6=Сб.
function canRunExtraDailyNow() {
  const key = getDayKeyNow();
  if (extraDailyDayKey !== key) {
    extraDailyDayKey = key;
    extraDailyDoneToday = false;
  }
  return !extraDailyDoneToday;
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

// Искать травы ("Заросли"): мини-игра-сапёр 4x4 внутри квеста сбора трав (Дикий пустолист,
// Трава арайя, Кустарник травии, Семя винограда). Клетки -- ссылки .../loc.php?r=X&obj=5134&gamekl=N
// (N=1..16, построчно слева направо сверху вниз). Клик по безопасной клетке открывает цифру
// (число шипов среди 8 соседей, как в обычном сапёре); клик по шипу -- "Вы укололись о ядовитый
// шип и ничего не нашли!" (провал, игровой кулдаун ~4ч); клик по треве (зелёная #) -- успех
// (кулдаун ~12ч). Если ПЕРВЫЙ клик в свежей попытке попадает на шип/траву, это бесплатный
// "мираж" ("То было наваждение. Рвите снова." + ссылка "Далее") -- поле просто перегенерируется
// без потери попытки. Доступность конкретной травы отражается прямо в списке квестов (Q), так что
// отдельный кулдаун-таймер в состоянии бота не нужен -- as-is: пробуем, если трава видна в меню.
const HERB_BOARD_COLS = 4;
const HERB_BOARD_ROWS = 4;
// Диапазон общего числа шипов на поле, по факту 3 и 4 уже наблюдались на разных досках -- используется
// решателем как мягкое ограничение (наравне с открытыми цифрами), чтобы правильно оценивать
// клетки, ещё не соседствующие ни с одной открытой цифрой.
const HERB_MINE_COUNT_RANGE = [3, 4];
const HERB_QUEST_NAMES = [
  'Дикий пустолист',
  'Трава арайя',
  'Кустарник травии',
  'Семя винограда',
];

function herbCellRowCol(gamekl) {
  const idx = gamekl - 1;
  return { row: Math.floor(idx / HERB_BOARD_COLS), col: idx % HERB_BOARD_COLS };
}

function herbCellNeighbors(gamekl) {
  const { row, col } = herbCellRowCol(gamekl);
  const result = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const r = row + dr;
      const c = col + dc;
      if (r >= 0 && r < HERB_BOARD_ROWS && c >= 0 && c < HERB_BOARD_COLS) {
        result.push(r * HERB_BOARD_COLS + c + 1);
      }
    }
  }
  return result;
}

// Перебирает все комбинации шипов среди ещё не открытых клеток, отсекает несовместимые с уже
// открытыми цифрами и с ожидаемым общим числом шипов (HERB_MINE_COUNT_RANGE), затем выбирает
// клетку с наименьшей долей "плохих" комбинаций. Поле маленькое (максимум 15 неоткрытых клеток
// после первого хода), так что полный перебор (2^15 = 32768) занимает миллисекунды.
function solveHerbBoard(openedNumbers, unopenedCells) {
  const n = unopenedCells.length;
  if (n === 0) return null;

  const indexOf = new Map(unopenedCells.map((v, i) => [v, i]));
  const constraints = [];
  for (const [cellStr, digit] of Object.entries(openedNumbers)) {
    const cell = Number(cellStr);
    const relevant = herbCellNeighbors(cell)
      .filter((nb) => indexOf.has(nb))
      .map((nb) => indexOf.get(nb));
    constraints.push({ relevant, digit });
  }

  const mineCounts = new Array(n).fill(0);
  let validCombos = 0;
  const totalCombos = 1 << n;

  for (let mask = 0; mask < totalCombos; mask++) {
    let ok = true;
    for (const c of constraints) {
      let cnt = 0;
      for (const idx of c.relevant) {
        if (mask & (1 << idx)) cnt++;
      }
      if (cnt !== c.digit) { ok = false; break; }
    }
    if (!ok) continue;

    let popcount = 0;
    for (let i = 0; i < n; i++) if (mask & (1 << i)) popcount++;
    if (popcount < HERB_MINE_COUNT_RANGE[0] || popcount > HERB_MINE_COUNT_RANGE[1]) continue;

    validCombos++;
    for (let i = 0; i < n; i++) if (mask & (1 << i)) mineCounts[i]++;
  }

  if (validCombos === 0) {
    console.log('Искать травы: решатель не нашёл согласованных комбинаций (диапазон шипов не подошёл), кликаю наугад');
    return unopenedCells[Math.floor(Math.random() * unopenedCells.length)];
  }

  let bestCell = unopenedCells[0];
  let bestProb = Infinity;
  for (let i = 0; i < n; i++) {
    const prob = mineCounts[i] / validCombos;
    if (prob < bestProb) {
      bestProb = prob;
      bestCell = unopenedCells[i];
    }
  }

  console.log(`Искать травы: решатель выбрал клетку ${bestCell} (P(шип)~${Math.round(bestProb * 100)}%, вариантов=${validCombos}, осталось клеток=${n})`);
  return bestCell;
}

async function parseHerbBoard(page) {
  return await page.evaluate(() => {
    const table = document.querySelector('table');
    if (!table) {
      return { hasGrid: false, unopenedCells: [], openedNumbers: {} };
    }

    const cells = Array.from(table.querySelectorAll('td'));
    const unopenedCells = [];
    const openedNumbers = {};

    cells.forEach((td, i) => {
      const gamekl = i + 1;
      const link = td.querySelector('a[href*="gamekl="]');
      if (link) {
        unopenedCells.push(gamekl);
        return;
      }
      const txt = (td.textContent || '').replace(/ /g, ' ').trim();
      if (/^\d+$/.test(txt)) {
        openedNumbers[gamekl] = Number(txt);
      }
    });

    return { hasGrid: cells.length > 0, unopenedCells, openedNumbers };
  }).catch(() => ({ hasGrid: false, unopenedCells: [], openedNumbers: {} }));
}

async function clickHerbCell(page, gamekl) {
  const locator = page.locator(`a[href$="gamekl=${gamekl}"]`).first();
  const count = await locator.count().catch(() => 0);
  if (count === 0) {
    console.log(`Искать травы: не нашёл ссылку для клетки ${gamekl}`);
    return false;
  }

  try {
    await locator.click({ timeout: 8000 });
    await pause(page, 800, 1600);
    return true;
  } catch (e) {
    console.log(`Искать травы: не смог кликнуть клетку ${gamekl}: ${e.message}`);
    return false;
  }
}

const HERB_BOARD_MAX_ROUNDS = 20;
const HERB_BOARD_MAX_REROLLS = 5;

// Играет один заход в "Заросли" от текущей страницы (уже после клика по "Искать травы") до
// терминального состояния: 'thorn' (провал, шип), 'cooldown' (растение ещё не выросло -- не
// должно случиться сразу после успешного захода на шаг, но страхуемся), 'done' (любое другое
// финальное сообщение -- в т.ч. успешный сбор травы, текст которого мы заранее не знаем) или
// 'error' (не смогли разобрать страницу / кончились попытки).
async function playHerbBoard(page) {
  let rerollsLeft = HERB_BOARD_MAX_REROLLS;

  for (let round = 0; round < HERB_BOARD_MAX_ROUNDS; round++) {
    const text = await getBodyText(page);

    if (/еще не успело вырасти|ещё не успело вырасти/i.test(text)) {
      console.log('Искать травы: растение ещё не выросло (кулдаун) -> пропускаю');
      return { outcome: 'cooldown' };
    }

    if (/То было наваждение/i.test(text)) {
      if (rerollsLeft <= 0) {
        console.log('Искать травы: слишком много "наваждений" подряд, прекращаю');
        return { outcome: 'error' };
      }
      rerollsLeft--;
      const ok = await clickByTexts(page, ['Далее', 'далее'], 'Далее (наваждение)');
      if (!ok) {
        console.log('Искать травы: не нашёл "Далее" после наваждения');
        return { outcome: 'error' };
      }
      await pause(page, 800, 1600);
      continue;
    }

    if (/укололись о ядовитый шип/i.test(text)) {
      console.log('Искать травы: наступили на шип, попытка окончена (игровой кулдаун)');
      return { outcome: 'thorn' };
    }

    const board = await parseHerbBoard(page);

    if (!board.hasGrid) {
      // Сетки нет -- скорее всего терминальное сообщение, которое мы не распознали текстом выше
      // (например успешный сбор травы). Считаем раунд завершённым и логируем текст для диагностики.
      console.log(`Искать травы: сетки нет на странице, считаю раунд завершённым (текст: ${text.slice(0, 200)})`);
      return { outcome: 'done', text };
    }

    if (board.unopenedCells.length === 0) {
      // Ни "укололись", ни "наваждение" не совпали, но свободных клеток не осталось -- скорее всего
      // это и есть успешный сбор травы (в т.ч. через цепную реакцию открытия пустых клеток, которая
      // задевает и саму траву). Текст здесь ещё точно не подтверждён -- логируем целиком для проверки.
      console.log(`Искать травы: все клетки открыты без шипа -- считаю успехом. Текст: ${text.slice(0, 500)}`);
      return { outcome: 'done', text };
    }

    const pick = solveHerbBoard(board.openedNumbers, board.unopenedCells);
    if (pick === null) {
      console.log('Искать травы: решатель не смог выбрать клетку');
      return { outcome: 'error' };
    }

    const clicked = await clickHerbCell(page, pick);
    if (!clicked) {
      return { outcome: 'error' };
    }
  }

  console.log('Искать травы: превышен лимит раундов, прекращаю');
  return { outcome: 'error' };
}

// Тот же минёр-виджет (та же таблица с gamekl=-ссылками и числами-подсказками), что и в травах,
// переиспользуется в квесте "Жертвоприношение" (поле 6x6, "Достаньте это, не напоровшись на
// шип"). В отличие от трав здесь нет своих "наваждение"/"не выросло" веток -- только шип (провал,
// текст тот же движковый "укололись о ядовитый шип") и успех (текст меняется от квеста к квесту,
// поэтому не проверяем его конкретно -- как и в травах, судим об успехе по тому, что сетка
// пропала со страницы).
async function playSapperBoardOnce(page) {
  for (let round = 0; round < HERB_BOARD_MAX_ROUNDS; round++) {
    const text = await getBodyText(page);

    if (/укололись о ядовитый шип/i.test(text)) {
      return { outcome: 'thorn' };
    }

    const board = await parseHerbBoard(page);

    if (!board.hasGrid || board.unopenedCells.length === 0) {
      return { outcome: 'done', text };
    }

    const pick = solveHerbBoard(board.openedNumbers, board.unopenedCells);
    if (pick === null) {
      console.log('Сапёр: решатель не смог выбрать клетку');
      return { outcome: 'error' };
    }

    const clicked = await clickHerbCell(page, pick);
    if (!clicked) {
      return { outcome: 'error' };
    }
  }

  console.log('Сапёр: превышен лимит раундов, прекращаю');
  return { outcome: 'error' };
}

// Провал сапёра здесь роняет HP в глубокий минус вместо обычного игрового кулдауна ("растение не
// выросло") -- восстановление происходит через ~1 минуту ожидания и клик "Продолжить квест"/
// "Далее", после чего попытка начинается заново с новой (пере-сгенерированной) доски. Ограничиваем
// число попыток, чтобы неудачная серия не зависала в этой функции на весь цикл бота.
async function solveSapperUntilDone(page, { maxAttempts = 6, label = 'Сапёр' } = {}) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const result = await playSapperBoardOnce(page);

    if (result.outcome === 'done') {
      return true;
    }

    if (result.outcome === 'thorn') {
      console.log(`${label}: наступили на шип (попытка ${attempt}/${maxAttempts}), жду ~65 сек и продолжаю`);
      await fixedPause(page, 65000);
      // Пользователь не уверен, какая именно кнопка появится после провала -- пробуем "Далее"
      // первым (наиболее вероятный вариант), "Продолжить квест" оставляем как запасной.
      const continued = await clickByTexts(
        page,
        ['Далее', 'далее', 'Продолжить квест', 'продолжить квест'],
        `${label}: продолжить после провала`
      );
      if (!continued) {
        console.log(`${label}: не нашёл кнопку продолжения после провала`);
        return false;
      }
      await pause(page, 800, 1600);
      continue;
    }

    console.log(`${label}: не удалось разобрать доску (outcome=${result.outcome})`);
    return false;
  }

  console.log(`${label}: превышен лимит попыток (${maxAttempts}), прекращаю`);
  return false;
}

// Квест "Жертвоприношение": особый, длится 3 дня, появляется в Q-меню от случая к случаю (как
// Варьете). Маршрут продиктован пользователем по дням; здесь только день 1 -- дни 2 и 3 будут
// дописаны позже. Клики форсированные (без nextTexts), как и в Варьете, т.к. большинство экранов
// не имеют предсказуемого "следующего шага". Реплики выбора матчатся по короткой уникальной
// подстроке без начального тире-маркера и без опечаток пользователя там, где они могли быть
// (напр. "дщбвинили" -> матчим по "в колдовстве", а не по всей фразе).
async function runSacrificeQuestDay1(page) {
  async function click(text, label) {
    await performStep(page, {
      stepName: label || text,
      currentTexts: [text, text.toLowerCase()],
      retries: 3,
    });
  }

  async function stepMany(text, count) {
    for (let i = 0; i < count; i++) {
      const ok = await tryPerformStepOptional(page, {
        stepName: `${text} (${i + 1}/${count})`,
        currentTexts: [text, text.toLowerCase()],
      });
      if (!ok) break;
    }
  }

  console.log('Жертвоприношение (день 1): начинаю маршрут');

  await click('Амулет', 'Амулет');
  await performStep(page, {
    stepName: 'Таверна «Три поросенка»',
    currentTexts: ['Таверна «Три поросенка»', 'таверна «три поросенка»', 'Таверна'],
    retries: 3,
  });
  await click('Крестьянин', 'Крестьянин');

  await click('стряслось', '"Что стряслось?"');
  await click('в колдовстве', '"Почему ее обвинили в колдовстве?"');
  await click('давай карту', '"Хорошо, давай карту."');

  if (await existsAnyText(page, ['В игру', 'в игру'])) {
    await clickByTexts(page, ['В игру', 'в игру'], 'В игру').catch(() => {});
    await pause(page, 800, 1600);
  }

  await click('Юг', 'Юг');
  await stepMany('Восток', 2);

  await click('Помощь Ахмату', 'Помощь Ахмату');
  await click('охраняете, хлопцы', '"Кого охраняете, хлопцы?"');
  await click('Подожди. Они', '"Подожди. Они?"');
  await click('Скатор и где его найти', '"Кто такой Скатор и где его найти?"');
  await click('где содержатся', '"А две другие ведьмы где содержатся?"');
  await click('можно поговорить', '"А с ведьмой можно поговорить?"');
  await click('к дому Скатора', '"Что ж, идти к дому Скатора"');
  await click('по поводу ведьм', '"по поводу ведьм хочу поговорить"');
  await click('вичхантеров', '"А в гильдию вичхантеров вы обращались?"');
  await click('почему вообще решили', '"А кто две остальные ведьмы..."');
  await click('единственная вина', '"Черные волосы это ее единственная вина?"');
  await click('продлится расследование', '"Сколько продлится расследование?..."');

  await click('Выйти на улицу', 'Выйти на улицу');
  await click('Идти к знахарке Раке', 'Идти к знахарке Раке');
  await click('не боитесь', '"Рака, вы не боитесь?"');
  await click('есть враги', '"У вас есть враги?"');
  await click('этим Киркиным', '"Спасибо. Я поговорю с этим Киркиным."');

  await click('Идти к месту ритуала', 'Идти к месту ритуала');
  await click('Осмотреться', 'Осмотреться');

  const sapperSolved = await solveSapperUntilDone(page, { label: 'Жертвоприношение (сапёр)' });
  if (!sapperSolved) {
    console.log('Жертвоприношение (день 1): не удалось решить сапёр, прекращаю на сегодня');
    return false;
  }

  await stepMany('Далее', 1);
  await click('Уйти', 'Уйти');

  console.log('Жертвоприношение (день 1): маршрут завершён');
  return true;
}

// В меню квестов травы перечислены обычным форматом "• Травы: <название> [инфо]", как и
// остальные Q-квесты (Харчевня, Дерево жизни и т.д.) -- открываются через [инфо] рядом со строкой.
function herbMenuLabel(herbName) {
  return `Травы: ${herbName}`;
}

async function openHerbQuestFromMenu(page, questCount, herbName) {
  if (!await resetToQuestMenu(page, questCount)) {
    return false;
  }

  const menuLabel = herbMenuLabel(herbName);
  let opened = await clickInfoForQuest(page, menuLabel);

  if (!opened) {
    // На случай, если на повторных заходах трава видна только под "Все квесты".
    const allOk = await clickByTexts(page, ['Все квесты', 'все квесты'], 'Все квесты');
    if (allOk) {
      opened = await clickInfoForQuest(page, menuLabel);
    }
  }

  return opened;
}

async function progressHerbQuest(page, herbName, { questCount } = {}) {
  console.log(`Искать травы: пробую собрать "${herbName}"`);

  try {
    const opened = await openHerbQuestFromMenu(page, questCount, herbName);
    if (!opened) {
      const menuSnapshot = (await getBodyText(page)).replace(/\s+/g, ' ').trim().slice(0, 1500);
      console.log(`Искать травы: не нашёл "${herbName}" в меню квестов. Текст страницы: ${menuSnapshot}`);
      return false;
    }

    await performStep(page, {
      stepName: 'К месту выполнения',
      currentTexts: ['К месту выполнения', 'к месту выполнения'],
      waitAfterClickMs: 7000,
      retries: 3,
    });

    if (await existsAnyText(page, ['В пути', 'в пути', 'В пути еще', 'в пути еще'])) {
      await clickByTexts(page, ['В пути еще', 'в пути еще', 'В пути', 'в пути'], 'В пути');
      await pause(page, 800, 1600);
    }

    const searchOk = await performStep(page, {
      stepName: 'Искать травы',
      currentTexts: ['Искать травы', 'искать травы'],
      retries: 4,
    });

    if (!searchOk) {
      console.log('Искать травы: шаг "Искать травы" недоступен');
      return false;
    }

    const result = await playHerbBoard(page);
    console.log(`Искать травы: "${herbName}" -> ${result.outcome}`);

    await clickByTexts(page, ['В игру', 'в игру'], 'В игру (после трав)').catch(() => {});

    return result.outcome === 'done';
  } catch (e) {
    console.log(`Искать травы: ошибка (${herbName}): ${e.message}`);
    return false;
  }
}

async function runFishEyeRouteToArena(page) {
  const AMULET = '\u0410\u043c\u0443\u043b\u0435\u0442';
  const DEVTOWN = '\u0414\u0435\u0432\u0442\u0430\u0443\u043d';
  const EAST_CRAFT = '\u041d\u0430 \u0432\u043e\u0441\u0442\u043e\u043a, \u0432 \u0440\u0435\u043c\u0435\u0441\u043b\u0435\u043d\u043d\u044b\u0439 \u0440\u0430\u0439\u043e\u043d';
  const GO_EAST = '\u0418\u0434\u0442\u0438 \u043d\u0430 \u0432\u043e\u0441\u0442\u043e\u043a';
  const PORT = '\u043f\u043e\u0440\u0442\u043e\u0432\u044b\u0439 \u0440\u0430\u0439\u043e\u043d';
  const FISH_EYE_TAVERN_FULL = '\u0422\u0440\u0430\u043a\u0442\u0438\u0440 \u00ab\u0420\u044b\u0431\u0438\u0439 \u0433\u043b\u0430\u0437\u00bb';
  const FISH_EYE_TAVERN_PLAIN = '\u0420\u044b\u0431\u0438\u0439 \u0433\u043b\u0430\u0437';
  const DESCEND = '\u0421\u043f\u0443\u0441\u0442\u0438\u0442\u044c\u0441\u044f \u043d\u0430 \u0430\u0440\u0435\u043d\u0443';

  const amuletOk = await clickByTexts(page, [AMULET, AMULET.toLowerCase()], 'Amulet');
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
  try {
    return await fn();
  } catch (e) {
    if (isScenarioPausedError(e)) throw e;
    console.log(`${label} error: ${e.message}`);
    await recoverToCity(page, `${label}: ${e.message}`);
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

// Квест "Варьете": появляется в Q-меню от случая к случаю (не привязан к дню недели), длинная
// линейная цепочка диалогов с одним обычным боем в середине. Маршрут продиктован пользователем
// целиком (см. runQuestStepSafe caller ниже) -- клики форсированные (без nextTexts/skip-эвристики,
// см. route-steps-forced-clicks), т.к. большинство экранов не имеют предсказуемого "следующего
// шага" для проверки. Реплики выбора (варианты с "—") матчатся по короткой уникальной подстроке
// без начального тире и знаков пунктуации на конце -- сам тире, скорее всего, лишь маркер списка
// в описании квеста, а не часть текста кнопки в игре.
async function progressVarieteQuest(page, { questCount } = {}) {
  const QUEST = 'Варьете'; // "Варьете"

  if (!await existsAnyText(page, [QUEST])) {
    return false;
  }

  const infoClicked = await clickInfoForQuest(page, QUEST);
  if (!infoClicked) {
    console.log('Варьете: не удалось открыть инфо квеста.');
    return false;
  }

  // "Выполнение" -- кнопка/ссылка перехода к месту исполнения квеста, как и в других Q-квестах
  // (там она называется иначе, напр. "К месту выполнения") -- пробуем оба варианта.
  await tryPerformStepOptional(page, {
    stepName: 'Выполнение',
    currentTexts: [
      'Выполнение', 'выполнение',
      'К месту выполнения', 'к месту выполнения',
    ],
    waitAfterClickMs: 3000,
  });

  async function click(text, label) {
    await performStep(page, {
      stepName: label || text,
      currentTexts: [text, text.toLowerCase()],
      retries: 3,
    });
  }

  async function stepMany(text, count) {
    for (let i = 0; i < count; i++) {
      const ok = await tryPerformStepOptional(page, {
        stepName: `${text} (${i + 1}/${count})`,
        currentTexts: [text, text.toLowerCase()],
      });
      if (!ok) break;
    }
  }

  const DALEE = 'Далее'; // "Далее"

  await click('Амулет', 'Амулет'); // Амулет
  await click('Три поросенка', 'Три поросенка'); // Три поросенка
  await performStep(page, {
    stepName: 'Таверна «Три поросенка»',
    currentTexts: ['Таверна «Три поросенка»', 'таверна «три поросенка»', 'Таверна'],
    retries: 3,
  }); // Таверна «Три поросенка»
  await click('Пройти в зал варьете', 'Пройти в зал варьете'); // Пройти в Зал варьете

  await stepMany(DALEE, 2);
  await click('занять место', 'Занять место за столиком рядом со сценой'); // Занять место за столиком рядом со сценой
  await stepMany(DALEE, 4);
  await click('к скамьям в конец зала', 'Молча подняться и пройти к скамьям в конец зала'); // Молча подняться и пройти к скамьям в конец зала

  await click('когда начнется представление', '"когда начнется представление"'); // — Хм, уважаемый, когда начнется представление?
  await click('интересно посмотреть, что это такое', '"интересно посмотреть, что это такое"'); // — Да, интересно посмотреть, что это такое вообще.
  await click('Рад знакомству', 'Рад знакомству'); // — Рад знакомству
  await click('люблю посмотр', '"да, люблю посмотреть"'); // — Да, люблю посмотреть.
  await click('больше посмотреть', '"нет, я больше посмотреть"'); // — Нет, я больше посмотреть.

  await stepMany(DALEE, 9);

  await click('не хочется', '"нет, не хочется"'); // — Нет, не хочется.
  await click('займу столик', '"займу столик"'); // — Да, я пожалуй займу столик, спасибо.
  await stepMany(DALEE, 1);

  await click('сесть за столик к ашаи', 'Сесть за столик к Ашаи'); // Сесть за столик к Ашаи
  await stepMany(DALEE, 1);

  await click('просто потерять', '"могла его просто потерять"'); // — Она могла его просто потерять?
  await click('именно украли', '"почему именно украли"'); // — Почему именно украли?
  await click('зацепки откуда начать поиски', '"какие-то зацепки откуда начать поиски"'); // — Хорошо, я посмотрю что можно сделать. Есть какие-то зацепки откуда начать поиски?
  await stepMany(DALEE, 1);

  await click('давно вы работаете', '"как давно вы работаете здесь"'); // — Это все? Как давно вы работаете здесь?
  await click('да уж', 'Да уж'); // Да уж
  await stepMany(DALEE, 1);

  await click('найти дим пупса', 'Найти Дим Пупса'); // Найти Дим Пупса
  await click('поговорить об одной из танцовщиц', '"поговорить об одной из танцовщиц"'); // — Я хочу поговорить об одной из танцовщиц.
  await click('Мара', 'Мара'); // Мара
  await click('какие у тебя с ней отношения', '"какие у тебя с ней отношения"'); // — А какие у тебя с ней отношения?
  await click('догадки кто мог украсть', '"есть догадки кто мог украсть"'); // — Да говорят ожерелье у нее пропало... может есть догадки кто мог украсть?
  await click('спасибо, помог', '"спасибо, помог"'); // — Спасибо, помог.

  await click('поговорить с двумя наемниками', 'Поговорить с двумя наемниками'); // Поговорить с двумя наемниками
  await stepMany(DALEE, 1);

  await click('хотите их обсудить', '"хотите их обсудить"'); // — Проблем много в этом мире. Хотите их обсудить?
  await click('однако он беспокоится', '"однако он беспокоится"'); // — Однако он беспокоится.

  await click('незаметно подставить официанту подножку', 'Незаметно подставить официанту подножку'); // Незаметно подставить официанту подножку
  await stepMany(DALEE, 2);

  await click('в бой', 'В бой'); // В бой (обычный бой)
  await fightLoop(page);
  await click('продолжить квест', 'Продолжить квест'); // Продолжить квест
  await stepMany(DALEE, 1);

  await click('поговорить с брумом', 'Поговорить с Брумом'); // Поговорить с Брумом
  await stepMany(DALEE, 2);

  await click('спасибо за информацию', '"спасибо за информацию"'); // — Спасибо за информацию.
  await click('клэр хитцу', 'Найти эльфийку-фокусницу Клэр хитцу'); // Найти эльфийку-фокусницу Клэр Хитцу
  await click('присесть рядом', 'Присесть рядом'); // Присесть рядом

  await click('номер был шикарен', '"ваш номер был шикарен"'); // — Ваш номер был шикарен!
  await click('не трудно выступать после танцовщиц', '"не трудно выступать после танцовщиц"'); // — Не трудно выступать после танцовщиц?
  await click('танцовщицам вы нрав', '"а девушкам-танцовщицам вы нравитесь"'); // — М-м-м, да... А девушкам-танцовщицам вы нравитесь?

  await click('хочу помочь Маре', '"хочу помочь Маре"'); // — Нет, я просто хочу помочь Маре, у нее пропало ожерелье...
  await click('очень помогли', '"спасибо, очень помогли"'); // — Спасибо, очень помогли.

  await click('пройти в комнату к маре', 'Пройти в комнату к Маре в комнату'); // Пройти в комнату к Маре в комнату

  // "Свидетели говорят..." -- финальная реплика-описание, не кнопка (в отличие от "Задание
  // завершено", которое пользователь явно пометил как кнопку).
  await click('задание завершено', 'задание завершено'); // Задание завершено

  console.log('Варьете: квест завершён.');

  if (await existsAnyText(page, ['В игру', 'в игру'])) {
    await clickByTexts(page, ['В игру', 'в игру'], 'В игру (after Варьете)');
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

  caravanRobberyDoneToday = true;
  persistDailyQuestState();
  console.log('Caravan Robbery quest: done today');
  return true;
}

async function readHpFromLocationInNewTab(page) {
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
    return stats.hpCurrent;
  } catch (e) {
    return null;
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
  const stats = lastCycleStats;
  const reserveMinutes = typeof stats?.reserveMinutes === 'number' ? stats.reserveMinutes : stats?.cooldown;
  const hpCurrent = typeof stats?.hpCurrent === 'number' ? stats.hpCurrent : null;
  const reserveOk = typeof reserveMinutes === 'number' && reserveMinutes >= SHTOLNI_MIN_RESERVE_MINUTES;
  const hpOk = typeof hpCurrent === 'number' && hpCurrent >= SHTOLNI_MIN_HP;

  if (!reserveOk || !hpOk) {
    console.log(`Shtolni gate: need reserve>=${SHTOLNI_MIN_RESERVE_MINUTES} and hp>=${SHTOLNI_MIN_HP}; have reserve=${reserveMinutes ?? 'n/a'} hp=${hpCurrent ?? 'n/a'}`);
    return false;
  }

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
  if (!await waitForReserveAtLeast(page, 20, { waitMs: 7 * 60 * 1000, maxWaits: 20 })) {
    console.log('Shtolni quest: reserve gate timed out, stop for now.');
    return false;
  }

  // As soon as we start interacting with the quest, consider it "taken/in progress"
  // to prevent parallel exclusive quest handling.
  shtolniTakenToday = true;
  if (!shtolniFocusStartedAt) shtolniFocusStartedAt = Date.now();

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

  let hadFirstFight = false;
  let hadSecondFight = false;
  if (await existsAnyText(page, ['\u0412 \u0431\u043e\u0439!', '\u0432 \u0431\u043e\u0439!', '\u0412 \u0431\u043e\u0439', '\u0432 \u0431\u043e\u0439'])) {
    await performStep(page, {
      stepName: '\u0412 \u0431\u043e\u0439!',
      currentTexts: ['\u0412 \u0431\u043e\u0439!', '\u0432 \u0431\u043e\u0439!', '\u0412 \u0431\u043e\u0439', '\u0432 \u0431\u043e\u0439'],
      retries: 4,
    });
    await fightLoop(page);
    hadFirstFight = true;
  }

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
  if (hadFirstFight || hasVorvatsya) {
    let clickedVorvatsya = false;
    if (await existsAnyText(page, ['\u0412\u043e\u0440\u0432\u0430\u0442\u044c\u0441\u044f', '\u0412\u043e\u0440\u0432\u0430\u0442\u044c\u0441\u044f \u0432 \u043a\u043e\u043c\u043d\u0430\u0442\u0443'])) {
      try {
        clickedVorvatsya = await tryClickVorvatsya();
      } catch (e) {
        // ignore
      }
    }
    if (!clickedVorvatsya && await existsAnyText(page, ['\u0416\u0434\u0430\u0442\u044c', '\u0436\u0434\u0430\u0442\u044c'])) {
      await tryPerformStepOptional(page, { stepName: '\u0416\u0434\u0430\u0442\u044c', currentTexts: ['\u0416\u0434\u0430\u0442\u044c', '\u0436\u0434\u0430\u0442\u044c'] });
      if (await existsAnyText(page, ['\u0412\u043e\u0440\u0432\u0430\u0442\u044c\u0441\u044f', '\u0412\u043e\u0440\u0432\u0430\u0442\u044c\u0441\u044f \u0432 \u043a\u043e\u043c\u043d\u0430\u0442\u0443'])) {
        try {
          await tryClickVorvatsya();
        } catch (e) {
          // ignore
        }
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
    const hpNow = await getHpCurrentSafe(page);
    if (hpNow !== null && hpNow <= 2000) {
      if (!await waitForHpAbove(page, 2000, { waitMs: 5 * 60 * 1000, maxWaits: 24 })) {
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
  }

  // Wrap up and exit.
  // Only try to exit/turn-in after the second fight.
  if (!hadSecondFight) {
    return progressed;
  }

  const exitSteps = [
    '\u041f\u0440\u043e\u0434\u043e\u043b\u0436\u0438\u0442\u044c \u043a\u0432\u0435\u0441\u0442',
    '\u0414\u0430\u043b\u0435\u0435',
    '\u0418\u0434\u0442\u0438 \u043d\u0430 \u044e\u0433',
    '\u0418\u0434\u0442\u0438 \u043d\u0430 \u0437\u0430\u043f\u0430\u0434',
    '\u041f\u043e\u0433\u043e\u0432\u043e\u0440\u0438\u0442\u044c \u0441 \u0436\u0435\u043d\u0449\u0438\u043d\u043e\u0439',
    '\u041e\u0442\u043a\u0430\u0437\u0430\u0442\u044c\u0441\u044f',
    '\u0412\u0435\u0440\u043d\u0443\u0442\u044c\u0441\u044f',
  ];

  let didExit = false;
  for (let i = 0; i < exitSteps.length; i++) {
    const step = exitSteps[i];
    const next = exitSteps[i + 1] ? [exitSteps[i + 1], exitSteps[i + 1].toLowerCase()] : [];
    const ok = await tryPerformStepOptional(page, {
      stepName: step,
      currentTexts: [step, step.toLowerCase()],
      nextTexts: next,
    });
    if (ok) progressed = true;
    if (step === '\u0412\u0435\u0440\u043d\u0443\u0442\u044c\u0441\u044f' && ok) didExit = true;
  }

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

function emitMorningScreenshotAlert(payload) {
  try {
    const json = JSON.stringify(payload || {});
    const encoded = Buffer.from(json, 'utf8').toString('base64');
    console.log(`MORNING_SCREENSHOT:${encoded}`);
  } catch (e) {
    console.log(`Не удалось сериализовать утренний скриншот: ${e.message}`);
  }
}

async function takeMorningScreenshot(page) {
  try {
    fs.mkdirSync(ATTACK_SCREENSHOT_DIR, { recursive: true });
    const ts = formatTimestampForFilename(new Date());
    const filePath = path.join(ATTACK_SCREENSHOT_DIR, `${ts}__morning_zazyvala.png`);
    await page.screenshot({ path: filePath, fullPage: true });
    return filePath;
  } catch (e) {
    console.log(`Не удалось сделать утренний скриншот: ${e.message}`);
    return null;
  }
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
  const isRealAttacker = opponentName ? LATIN_NICK_RE.test(opponentName) : true;

  if (!isRealAttacker) {
    console.log(`"В бой" -> противник "${opponentName}" (не игрок) -> это бой с ${FARM_LABEL}, не атака`);
    await runIncomingAttackPvpLoop(page).catch(() => {});
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

function buildSelectorsForText(text) {
  // Use these selectors when we intend to CLICK something.
  // Avoid `text=` for clicking because it can match non-clickable text and lead to wrong clicks
  // (e.g. hitting "Настройка" or other nearby labels).
  return [
    `a:has-text("${text}")`,
    `button:has-text("${text}")`,
    `input[value="${text}"]`,
  ];
}

function buildSelectorsForClickableDetect(text) {
  // Use these selectors when we want to DETECT that a clickable action is available.
  // Some lbast pages use non-standard clickable elements.
  return [
    ...buildSelectorsForText(text),
    `[onclick]:has-text("${text}")`,
    `[role="link"]:has-text("${text}")`,
    `[role="button"]:has-text("${text}")`,
  ];
}

function buildSelectorsForTextAny(text) {
  // Use these selectors when we only want to DETECT that text exists on the page.
  return [...buildSelectorsForText(text), `text=${text}`];
}

function escapeRegexLiteral(str) {
  return String(str || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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

// Exact (whole-text) match, unlike clickByTexts' :has-text() substring match. Needed when the
// target text is itself a prefix/substring of another button on the same page (e.g. "Охотиться"
// vs "Охотиться на лосей") — a substring match would ambiguously hit the wrong one.
async function clickByTextsExact(page, texts, stepName) {
  for (const text of texts) {
    const selectors = [
      `a:text-is("${text}")`,
      `button:text-is("${text}")`,
      `input[value="${text}"]`,
    ];

    for (const selector of selectors) {
      const locator = page.locator(selector).first();
      const count = await locator.count().catch(() => 0);

      if (count > 0) {
        try {
          await locator.click({ timeout: 8000, noWaitAfter: true });
          console.log(`OK: ${stepName} -> ${text} (exact)`);
          uiStuckState = { stepName: '', count: 0, firstAt: 0 };
          return true;
        } catch (e) {
          console.log(`Не смог кликнуть ${stepName} -> ${text} (exact): ${e.message}`);
        }
      }
    }
  }

  console.log(`Не найдено точное совпадение для шага "${stepName}": ${texts.join(', ')}`);
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
  // Главная точка реакции на паузу: через performStep идёт КАЖДЫЙ шаг любого маршрута, а бои
  // (fightLoop, clickByTexts напрямую) -- нет, и потому начатый бой всегда доигрывается до конца,
  // а не бросается на середине. Маршруты и так прерываемы: незаконченные квесты сценарий
  // доделывает в следующем цикле.
  throwIfPausedByManager(config?.stepName || 'шаг маршрута');

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

// Янтарная гора (порт из yantar_v_gore.js). Первая половина маршрута -- та же, что у Блейка
// (Амулет -> Девтаун -> ремесленный район -> восток -> Пристань), дальше другая лодка: остров
// Старого башмака вместо острова Блейка, и вместо хижины -- шахта в горе.
// Полный маршрут, продиктованный пользователем:
//   Пристань -> Взять лодку до острова Старого башмака за 10 дин -> Далее -> Идти на восток ->
//   Идти на север x3 -> Идти к горе x2 -> Спуститься в шахту -> Идти дальше -> Идти налево ->
//   Идти дальше -> В бой!
// ВАЖНО: ссылки направлений ("Идти на север", "Идти к горе") остаются видимыми и ПОСЛЕ клика,
// поэтому у повторяющихся шагов nextTexts пуст и skipIfNextVisible выключен -- иначе performStep
// решит, что следующий шаг уже виден, и не докликает нужное число раз.
async function goRouteToAmber(page) {
  console.log('Иду по маршруту к Янтарной горе');

  const AMULET     = 'Амулет';
  const DEVTOWN    = 'Девтаун';
  const EAST_CRAFT = 'На восток, в ремесленный район';
  const GO_EAST    = 'Идти на восток';
  const PORT       = 'портовый район';
  const PIER       = 'Пристань';
  const BOAT       = 'Взять лодку до острова Старого башмака за 10 дин';
  const BOAT_SHORT = 'острова Старого башмака';
  const NEXT       = 'Далее';
  const NORTH      = 'Идти на север';
  const TO_MOUNT   = 'Идти к горе';

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
    nextTexts: [BOAT, BOAT.toLowerCase(), BOAT_SHORT, BOAT_SHORT.toLowerCase()],
    retries: 4,
  });

  // Текст лодки в игре периодически меняется (регистр, стрелки-префиксы, формат цены), поэтому
  // короткий вариант "острова Старого башмака" оставлен запасным.
  await performStep(page, {
    stepName: BOAT,
    currentTexts: [BOAT, BOAT.toLowerCase(), BOAT_SHORT, BOAT_SHORT.toLowerCase()],
    waitAfterClickMs: 7000,
    nextTexts: [NEXT, NEXT.toLowerCase(), GO_EAST, GO_EAST.toLowerCase()],
    retries: 3,
  });

  if (await existsAnyText(page, [GO_EAST, GO_EAST.toLowerCase()])) {
    console.log('После лодки уже доступен шаг "Идти на восток", шаг "Далее" пропускаю');
  } else {
    await performStep(page, {
      stepName: NEXT,
      currentTexts: [NEXT, NEXT.toLowerCase()],
      nextTexts: [GO_EAST, GO_EAST.toLowerCase()],
      retries: 3,
    });
  }

  await performStep(page, {
    stepName: `${GO_EAST} (остров)`,
    currentTexts: [GO_EAST, GO_EAST.toLowerCase()],
    nextTexts: [NORTH, NORTH.toLowerCase()],
    retries: 3,
  });

  for (let i = 0; i < 3; i++) {
    await performStep(page, {
      stepName: `${NORTH} (${i + 1}/3)`,
      currentTexts: [NORTH, NORTH.toLowerCase()],
      nextTexts: [],
      skipIfNextVisible: false,
      retries: 3,
    });
  }

  for (let i = 0; i < 2; i++) {
    await performStep(page, {
      stepName: `${TO_MOUNT} (${i + 1}/2)`,
      currentTexts: [TO_MOUNT, TO_MOUNT.toLowerCase(), 'К горе', 'к горе'],
      nextTexts: [],
      skipIfNextVisible: false,
      retries: 3,
    });
  }

  await openAmberFight(page);
}

// Внутри горы: шахта -> дальше -> налево -> дальше -> В бой. Каждый шаг необязателен по
// отдельности -- если мы вернулись сюда после боя, часть экранов уже пройдена.
async function openAmberFight(page) {
  const SHAFT   = 'Спуститься в шахту';
  const FORWARD = 'Идти дальше';
  const LEFT    = 'Идти налево';
  const TO_MOUNT = 'Идти к горе';
  const UDAR_RE = /Ударить/i;
  const DONE_RE = /Бой завершен!/i;
  const FIGHT_TEXTS = ['В бой!', 'в бой!', 'В бой', 'в бой'];

  const text = await getBodyText(page);
  if (UDAR_RE.test(text) || DONE_RE.test(text)) {
    console.log('Экран боя уже открыт');
    return;
  }

  // После боя игра выбрасывает обратно к подножию -- тогда до шахты снова два клика "Идти к горе".
  for (let i = 0; i < 2; i++) {
    if (!await existsAnyText(page, [TO_MOUNT, TO_MOUNT.toLowerCase(), 'К горе', 'к горе'])) break;
    await performStep(page, {
      stepName: `${TO_MOUNT} (возврат ${i + 1}/2)`,
      currentTexts: [TO_MOUNT, TO_MOUNT.toLowerCase(), 'К горе', 'к горе'],
      nextTexts: [],
      skipIfNextVisible: false,
      retries: 3,
    });
  }

  const INSIDE = [
    { name: SHAFT,   texts: [SHAFT, SHAFT.toLowerCase(), 'Войти в шахту', 'войти в шахту'] },
    { name: FORWARD, texts: [FORWARD, FORWARD.toLowerCase()] },
    { name: LEFT,    texts: [LEFT, LEFT.toLowerCase(), 'Налево', 'налево'] },
    { name: FORWARD, texts: [FORWARD, FORWARD.toLowerCase()] },
  ];

  for (const step of INSIDE) {
    if (await existsAnyText(page, [...FIGHT_TEXTS, 'Ударить', 'ударить'])) break;
    if (!await existsAnyText(page, step.texts)) continue;
    await performStep(page, {
      stepName: `Янтарная гора: ${step.name}`,
      currentTexts: step.texts,
      nextTexts: [],
      skipIfNextVisible: false,
      retries: 3,
    });
  }

  const refreshed = await getBodyText(page);
  if (/В\s*бой/i.test(refreshed) && !UDAR_RE.test(refreshed)) {
    await performStep(page, {
      stepName: 'В бой (Янтарная гора)',
      currentTexts: FIGHT_TEXTS,
      nextTexts: ['Ударить', 'ударить', 'Бой завершен!'],
      retries: 3,
    });
    await pause(page, 1000, 2000);
  }
}

function isAmberLocation(text) {
  const s = String(text || '');
  return /Янтарная\s+гора/i.test(s) || /Спуститься в шахту/i.test(s) || /Идти к горе/i.test(s);
}

async function ensureAmberFightScreen(page) {
  const UDAR_RE = /Ударить/i;
  const DONE_RE = /Бой завершен!/i;

  const text = await getBodyText(page);
  if (UDAR_RE.test(text) || DONE_RE.test(text)) return;

  if (isAmberLocation(text) || /В\s*бой/i.test(text)) {
    await openAmberFight(page);
    return;
  }

  await goRouteToAmber(page);
}

// Farm-target-aware wrappers: pick Blake, goblins or Янтарная гора depending on FARM_TARGET so
// doScenario's farm loop stays generic. Goblins reach their spot via the Амулет -> Последний
// портал shortcut; Блейк и Янтарная гора -- оба острова за платной лодкой, поэтому у них одни и
// те же пороги HP и одинаковое поведение "остаёмся на месте до следующего цикла".
function shouldFightFarmByStats(stats) {
  return FARM_TARGET === 'goblins' ? shouldFightByStats(stats) : shouldFightBlakeByStats(stats);
}

function isFarmLocation(text) {
  if (FARM_TARGET === 'goblins') return isGoblinsLocation(text);
  if (FARM_TARGET === 'yantar') return isAmberLocation(text);
  return isBlakeLocation(text);
}

async function ensureFarmFightScreen(page) {
  if (FARM_TARGET === 'goblins') return ensureGoblinFightScreen(page);
  if (FARM_TARGET === 'yantar') return ensureAmberFightScreen(page);
  return ensureBlakeFightScreen(page);
}

const STONEGUARD_FASTWAY_URL = 'http://lbast.ru/location.php?r=6174&mod=fastway&lway=2';
const CITY_FASTWAY_URL = 'http://lbast.ru/location.php?r=7900&mod=fastway&lway=2';

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

async function fightLoop(page) {
  const UDAR = '\u0423\u0434\u0430\u0440\u0438\u0442\u044c';
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

  for (let i = 0; i < 300; i++) {
    const text = await getBodyText(page);

    if (await existsAnyText(page, DONE_TEXTS)) {
      const ok = await clickByTexts(page, DONE_TEXTS, 'fight done/return');
      if (!ok) throw new Error('fight_done_click_failed');
      await pause(page, 800, 2000);
      return true;
    }

    // Some targets (e.g. Thursday's Могильщик/Мясник/Ведьма) have a real in-game per-target
    // cooldown, same as regular farm fights: "Вы слишком устали, приходите через N мин." Detect it
    // and abort immediately with a distinguishable error instead of burning through MAX_STUCK
    // iterations trying to find a fight that isn't there right now.
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
    //
    // parseStats() requires a third "(reserve/cooldown)" parenthetical group after "(hp/max)" --
    // that group is only present on the location/stats page, not on the fight screen itself, so it
    // always returned null HP here and "Прием" never actually got clicked. Same simple "(hp/max)"
    // pattern already used elsewhere for combat-screen HP (see handleIncomingAttackIfAny) works
    // reliably on this screen.
    const hpMatch = text.match(/\((-?\d+)\s*\/\s*(\d+)\)/);
    const fightHpCurrent = hpMatch ? Number(hpMatch[1]) : null;
    const fightHpMax = hpMatch ? Number(hpMatch[2]) : null;
    if (
      Number.isFinite(fightHpCurrent) &&
      Number.isFinite(fightHpMax) &&
      fightHpMax > 0 &&
      fightHpCurrent < fightHpMax * 0.75 &&
      await existsAnyText(page, RECEPTION_TEXTS)
    ) {
      const receptionOk = await clickByTexts(page, RECEPTION_TEXTS, 'Прием');
      if (receptionOk) {
        await pause(page, 500, 1200);
      }
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

// Unlike Blake (paid boat passage, so staying put avoids paying twice), goblins reach their farm
// spot via a free Fastway portal — no reason to idle there once the cooldown is spent. Rest in
// Стоунгард (safe from PvP) whenever HP is positive; by the time doScenario reaches this point,
// negative-HP cases have already been routed to Кулак хаоса / Последний дом.
async function maybeRestGoblinAtStoneguard(page, stats) {
  if (FARM_TARGET !== 'goblins') return false;
  if (typeof stats?.hpCurrent !== 'number' || stats.hpCurrent < 0) return false;

  console.log(`Goblins farm: HP positive (${stats.hpCurrent}) -> rest at Стоунгард`);
  await useRecovery(page);
  return true;
}

async function goToChaosByAmulet(page) {
  const AMULET = '\u0410\u043c\u0443\u043b\u0435\u0442';
  const CHAOS = '\u041a\u0443\u043b\u0430\u043a \u0445\u0430\u043e\u0441\u0430';

  // "\u0410\u043c\u0443\u043b\u0435\u0442" is the persistent top-nav link, so a miss here is almost always a transient page-load
  // race, not a real absence \u2014 retry once after a short reload instead of silently stranding the
  // caller wherever fishing/etc. left the page (observed: this cascaded into "\u0424\u043e\u0440\u043f\u043e\u0441\u0442" not found
  // and the whole \u041f\u043e\u0441\u043b\u0435\u0434\u043d\u0438\u0439 \u0434\u043e\u043c recovery throwing).
  let amuletOk = await clickByTexts(page, [AMULET, AMULET.toLowerCase()], AMULET);
  if (!amuletOk) {
    await pause(page, 1000, 2000);
    amuletOk = await clickByTexts(page, [AMULET, AMULET.toLowerCase()], AMULET);
  }
  if (amuletOk) await pause(page, 800, 2000);

  const chaosOk = await clickByTexts(page, [CHAOS, CHAOS.toLowerCase()], CHAOS);
  if (chaosOk) await pause(page, 800, 2000);
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
      throwIfPausedByManager('Последний дом: ожидание кулдауна станций');
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
  // Станция на кулдауне (20-25 мин) остаётся на странице обычной ссылкой: клик "проходит", бот
  // считает шаг успешным, но HP не растёт. Раньше цикл этого не замечал и, пока резерв был
  // неотрицательным, прокручивал все 200 итераций подряд без единой паузы -- 22.09.2026 это дало
  // 733 клика по станциям и гигантский лог ни о чём. Поэтому смотрим не на клик, а на факт: выросло
  // ли HP. Если подряд не помогла ни одна станция -- значит все на кулдауне, надо ждать.
  let uselessInARow = 0;
  let lastHp = null;

  for (let i = 0; i < LAST_HOUSE_MAX_ITERATIONS; i++) {
    // Восстановление длится часами -- без этой проверки пауза, нажатая посреди него, замечалась
    // только когда HP наконец дорастал до порога (Паша, 24.09.2026: "нажал на паузу, но скрипт
    // пожарил рыбу").
    throwIfPausedByManager('Последний дом: цикл станций');
    await clickHealingRefreshLink(page);
    let stats = parseStats(await getBodyText(page));
    const hpNow = typeof stats.hpCurrent === 'number' ? stats.hpCurrent : null;

    if (hpNow !== null && hpNow >= BLAKE_MIN_HP) {
      console.log(`Последний дом: HP восстановлено до ${hpNow} (>= ${BLAKE_MIN_HP}) -> выхожу`);
      break;
    }

    if (hpNow === null || (lastHp !== null && hpNow <= lastHp)) {
      uselessInARow += 1;
    } else {
      uselessInARow = 0;
    }
    lastHp = hpNow;

    if (uselessInARow >= STATIONS.length) {
      const waitMinutes = 20 + Math.floor(Math.random() * 6);
      await waitStationCooldown(waitMinutes, `HP не растёт (${hpNow ?? 'n/a'}), все станции на кулдауне`);
      uselessInARow = 0;
      continue;
    }

    console.log(`Последний дом: HP ${hpNow ?? 'n/a'}/${stats.hpMax ?? 'n/a'}, итерация ${i + 1}/${LAST_HOUSE_MAX_ITERATIONS}`);

    // Combine station use with fishing: whenever fishing is due (daily catches left, 2-minute
    // cooldown elapsed), take that detour instead of a station, then jump to Кулак хаоса
    // (fastest heal) and come back to the Последний дом station rotation.
    if (canRunFishingNow()) {
      console.log('Последний дом: пробую совместить с рыбалкой');
      await runFishingViaLastPortalOrRoute(page);
      await enterLastHouse();
      // Крюк за рыбалкой сам по себе HP не даёт -- иначе он бы считался "бесполезной станцией".
      uselessInARow = 0;
      lastHp = null;
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
    // Результат станции проверяет начало следующей итерации (выросло ли HP) -- отдельный опрос
    // статов здесь только удваивал загрузки страницы и строки в логе.
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
  // Между фазами цикла статы перечитываются почти всегда -- удобная граница, чтобы заметить паузу
  // до перехода к следующему блоку (и до навигации, которая сбила бы пользователю экран).
  throwIfPausedByManager(`чтение статов (${label})`);

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

  const vineyardText = await getBodyText(page);

  const HARVEST = 'Собрать урожай';

  async function tryPlantVineyardSeed() {
    const planted = await clickByTexts(
      page,
      ['Посадить семя винограда', 'посадить семя винограда', 'Посадить', 'посадить'],
      'Посадить',
    );
    if (planted) {
      console.log('Виноград: посадили новое семя');
      await pause(page, 800, 1600);
    } else {
      // Нет семени винограда в инвентаре -- это нормально, не ошибка. Семя добывается отдельно
      // через "Искать травы" (Семя винограда); просто продолжаем обычный сценарий дальше.
      console.log('Виноград: нет семени винограда для посадки -- пропускаю, продолжаю обычный сценарий');
    }
    return planted;
  }

  // Цикл виноградника: полив -> (когда созрело) "Собрать урожай" вместо полива -> после сбора
  // появляется "Посадить" (нужно семя винограда, добываемое через "Искать травы") -> и снова полив.
  if (new RegExp(HARVEST, 'i').test(vineyardText)) {
    console.log('Виноград: урожай созрел, собираю');
    await performStep(page, {
      stepName: HARVEST,
      currentTexts: [HARVEST, HARVEST.toLowerCase()],
      retries: 3,
      skipIfNextVisible: false,
    });
    await pause(page, 800, 1600);

    const afterHarvestText = await getBodyText(page);
    if (/Посадить/i.test(afterHarvestText)) {
      await tryPlantVineyardSeed();
    }

    await clickByTexts(page, [V_IGRU, V_IGRU.toLowerCase()], V_IGRU).catch(() => {});
    return;
  }

  // Виноградник уже собран раньше (в прошлый заход семени не было), сейчас просто ждёт посадки.
  if (/Посадить/i.test(vineyardText)) {
    console.log('Виноград: урожай уже собран ранее, пробую посадить семя');
    await tryPlantVineyardSeed();
    await clickByTexts(page, [V_IGRU, V_IGRU.toLowerCase()], V_IGRU).catch(() => {});
    return;
  }

  // Watering can be unavailable (e.g. "Сделать вино (квестзапрет 6ч)" shown instead) —
  // that's a normal state, not an error. Just bail out; VINOGRAD_INTERVAL_MS handles retiming.
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

// Довольствие: простой ежедневный маршрут без боя.
// Амулет -> Дорожный крест -> Казначейство Тригмагистрата -> Получить довольствие -> В игру.
async function runAllowanceTask(page) {
  console.log('Довольствие: маршрут Амулет -> Дорожный крест -> Казначейство Тригмагистрата -> Получить довольствие -> В игру');

  const AMULET     = 'Амулет';
  const ROAD_CROSS = 'Дорожный крест';
  const TREASURY   = 'Казначейство Тригмагистрата';
  const GET_ALLOWANCE = 'Получить довольствие';
  const V_IGRU     = 'В игру';

  await performStep(page, {
    stepName: AMULET,
    currentTexts: [AMULET, AMULET.toLowerCase()],
    nextTexts: [ROAD_CROSS, ROAD_CROSS.toLowerCase()],
    retries: 3,
  });

  await performStep(page, {
    stepName: ROAD_CROSS,
    currentTexts: [ROAD_CROSS, ROAD_CROSS.toLowerCase()],
    nextTexts: [TREASURY, TREASURY.toLowerCase()],
    retries: 3,
  });

  await performStep(page, {
    stepName: TREASURY,
    currentTexts: [TREASURY, TREASURY.toLowerCase()],
    nextTexts: [GET_ALLOWANCE, GET_ALLOWANCE.toLowerCase()],
    retries: 3,
  });

  // Довольствие может быть уже получено сегодня (в игре свой кулдаун) — это нормально, не ошибка.
  const treasuryText = await getBodyText(page);
  if (!/Получить довольствие/i.test(treasuryText)) {
    console.log('Довольствие: получить нельзя (уже получено сегодня) — это нормально');
    await clickByTexts(page, [V_IGRU, V_IGRU.toLowerCase()], V_IGRU).catch(() => {});
    return;
  }

  await performStep(page, {
    stepName: GET_ALLOWANCE,
    currentTexts: [GET_ALLOWANCE, GET_ALLOWANCE.toLowerCase()],
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

// Утренний скриншот для Telegram: Стоунгард (Fastway) -> Центральная площадь -> Уличный зазывала.
// Возвращает true только если скриншот реально сделан и отправлен на алерт-канал (stdout);
// при false вызывающий код не помечает день выполненным, и следующий цикл пробует снова.
async function runMorningScreenshotTask(page) {
  console.log('Утренний скриншот: маршрут Стоунгард -> Центральная площадь -> Уличный зазывала');

  const CENTRAL_SQUARE = 'Центральная площадь';
  const STREET_TOUT = 'Уличный зазывала';
  const V_IGRU = 'В игру';

  const stoneguardOk = await goToStoneguardViaFastway(page, 'Стоунгард (утренний скриншот)');
  if (!stoneguardOk) {
    console.log('Утренний скриншот: не удалось попасть в Стоунгард, попробую в следующем цикле');
    return false;
  }

  const squareOk = await performStep(page, {
    stepName: CENTRAL_SQUARE,
    currentTexts: [CENTRAL_SQUARE, CENTRAL_SQUARE.toLowerCase()],
    nextTexts: [STREET_TOUT, STREET_TOUT.toLowerCase()],
    retries: 3,
  });
  if (!squareOk) {
    console.log('Утренний скриншот: не удалось попасть на Центральную площадь, попробую в следующем цикле');
    return false;
  }

  const toutOk = await clickByTexts(page, [STREET_TOUT, STREET_TOUT.toLowerCase()], STREET_TOUT);
  if (!toutOk) {
    console.log('Утренний скриншот: не нашёл "Уличный зазывала" на площади, попробую в следующем цикле');
    return false;
  }
  await pause(page, 800, 1800);

  const screenshotPath = await takeMorningScreenshot(page);
  if (!screenshotPath) {
    console.log('Утренний скриншот: скриншот не удался, попробую в следующем цикле');
    return false;
  }

  emitMorningScreenshotAlert({
    screenshotPath,
    occurredAt: new Date().toISOString(),
  });

  await clickByTexts(page, [V_IGRU, V_IGRU.toLowerCase()], V_IGRU).catch(() => {});
  return true;
}

// Охота на демона: личный квест у NPC в Цитадели, раз в день. Взять задание: Амулет ->
// Дорожный крест -> Цитадель Ордена Тригмагистров -> Получить задание -> В игру. Дойти до цели:
// Конь -> Ивовое озеро -> (ожидание 7с/подтверждение поездки) -> Запад -> Поросль камышей ->
// Идти по левой -> Идти дальше -> обычный бой (fightLoop). Сдать: Амулет -> Дорожный крест ->
// Цитадель Ордена Тригмагистров -> Доложить о задании.
async function runDemonHuntTask(page) {
  console.log('Охота на демона: маршрут Амулет -> Дорожный крест -> Цитадель -> Получить задание -> Конь -> Ивовое озеро -> Запад -> Поросль камышей -> Идти по левой -> Идти дальше -> бой -> сдать задание');

  const AMULET = 'Амулет';
  const ROAD_CROSS = 'Дорожный крест';
  const CITADEL = 'Цитадель Ордена Тригмагистров';
  const GET_QUEST = 'Получить задание';
  const V_IGRU = 'В игру';
  const HORSE = 'Конь';
  const WILLOW_LAKE = 'Ивовое озеро';
  const V_PUTI   = 'В пути';
  const V_PUTI_E = 'В пути еще';
  const V_PUTI_Y = 'В пути ещё';
  const WEST = 'Запад';
  const REEDS = 'Поросль камышей';
  const GO_LEFT = 'Идти по левой';
  const GO_FURTHER = 'Идти дальше';
  const REPORT_QUEST = 'Доложить о задании';

  // Взять задание.
  await performStep(page, {
    stepName: AMULET,
    currentTexts: [AMULET, AMULET.toLowerCase()],
    nextTexts: [ROAD_CROSS, ROAD_CROSS.toLowerCase()],
    retries: 3,
  });

  await performStep(page, {
    stepName: ROAD_CROSS,
    currentTexts: [ROAD_CROSS, ROAD_CROSS.toLowerCase()],
    nextTexts: [CITADEL, CITADEL.toLowerCase()],
    retries: 3,
  });

  await performStep(page, {
    stepName: CITADEL,
    currentTexts: [CITADEL, CITADEL.toLowerCase()],
    nextTexts: [GET_QUEST, GET_QUEST.toLowerCase()],
    retries: 3,
  });

  await performStep(page, {
    stepName: GET_QUEST,
    currentTexts: [GET_QUEST, GET_QUEST.toLowerCase()],
    retries: 3,
  });

  if (await existsAnyText(page, [V_IGRU, V_IGRU.toLowerCase()])) {
    await clickByTexts(page, [V_IGRU, V_IGRU.toLowerCase()], V_IGRU).catch(() => {});
    await pause(page, 800, 1600);
  }

  // Дойти до демона и убить.
  await performStep(page, {
    stepName: HORSE,
    currentTexts: [HORSE, HORSE.toLowerCase()],
    nextTexts: [WILLOW_LAKE, WILLOW_LAKE.toLowerCase()],
    retries: 3,
  });

  await performStep(page, {
    stepName: WILLOW_LAKE,
    currentTexts: [WILLOW_LAKE, WILLOW_LAKE.toLowerCase()],
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
    waitForNextMs: 30000,
  });

  // Сервер может на любом шаге между "Ивовое озеро" и самим боем внезапно показать "Вы уже
  // выполняли это задание сегодня" вместо ожидаемого продолжения маршрута -- на практике это
  // всплыло именно после "Поросль камышей" (перед "Идти по левой"), а не сразу на "Ивовое озеро"
  // как предполагалось раньше, так что проверяем после КАЖДОГО шага этого участка, а не только в
  // одном месте. Раньше необработанный случай приводил к исключению глубже по маршруту и общему
  // бэкоффу цикла на ~20+ минут -- вместо этого просто уходим и завершаем на сегодня, как и в
  // Охоте на лосей.
  async function bailIfAlreadyDoneToday() {
    const text = await getBodyText(page);
    if (/уже\s+выполняли\s+(это\s+)?задание/i.test(text)) {
      console.log('Охота на демона: "уже выполняли это задание сегодня" — квест уже засчитан, ухожу');
      await clickByTexts(page, ['Уйти', 'уйти'], 'Уйти').catch(() => {});
      await pause(page, 800, 1600);
      return true;
    }
    return false;
  }

  if (await bailIfAlreadyDoneToday()) return;

  await performStep(page, {
    stepName: WEST,
    currentTexts: [WEST, WEST.toLowerCase()],
    nextTexts: [REEDS, REEDS.toLowerCase()],
    retries: 3,
  });

  if (await bailIfAlreadyDoneToday()) return;

  await performStep(page, {
    stepName: REEDS,
    currentTexts: [REEDS, REEDS.toLowerCase()],
    nextTexts: [GO_LEFT, GO_LEFT.toLowerCase()],
    retries: 3,
  });

  if (await bailIfAlreadyDoneToday()) return;

  await performStep(page, {
    stepName: GO_LEFT,
    currentTexts: [GO_LEFT, GO_LEFT.toLowerCase()],
    nextTexts: [GO_FURTHER, GO_FURTHER.toLowerCase()],
    retries: 3,
  });

  if (await bailIfAlreadyDoneToday()) return;

  // Демон иногда нападает сразу после "Идти по левой", минуя "Идти дальше" -- вместо ссылки на
  // следующий шаг сразу показывается "На вас кидается демон! В бой!". Раньше это считалось
  // ошибкой маршрута (3 неудачные попытки найти "Идти дальше" -> Cycle error -> ~17-минутный
  // бэкофф), а бой в итоге доставался общему обработчику входящих атак в начале СЛЕДУЮЩЕГО цикла
  // (бьётся с любым не-игроком как с блейком) -- из-за этого маршрут никогда не доходил до
  // "Доложить о задании" и квест не сдавался, хотя демон был убит.
  const FIGHT_PROMPT_TEXTS = ['В бой!', 'в бой!', 'В бой', 'в бой'];
  if (await existsAnyClickable(page, FIGHT_PROMPT_TEXTS)) {
    console.log('Охота на демона: демон напал сразу после "Идти по левой", пропускаю "Идти дальше"');
  } else {
    await performStep(page, {
      stepName: GO_FURTHER,
      currentTexts: [GO_FURTHER, GO_FURTHER.toLowerCase()],
      retries: 3,
    });
  }

  if (await bailIfAlreadyDoneToday()) return;

  await fightLoop(page);

  // Сдать задание.
  await performStep(page, {
    stepName: `${AMULET} (сдать)`,
    currentTexts: [AMULET, AMULET.toLowerCase()],
    nextTexts: [ROAD_CROSS, ROAD_CROSS.toLowerCase()],
    retries: 3,
  });

  await performStep(page, {
    stepName: `${ROAD_CROSS} (сдать)`,
    currentTexts: [ROAD_CROSS, ROAD_CROSS.toLowerCase()],
    nextTexts: [CITADEL, CITADEL.toLowerCase()],
    retries: 3,
  });

  await performStep(page, {
    stepName: `${CITADEL} (сдать)`,
    currentTexts: [CITADEL, CITADEL.toLowerCase()],
    nextTexts: [REPORT_QUEST, REPORT_QUEST.toLowerCase()],
    retries: 3,
  });

  await performStep(page, {
    stepName: REPORT_QUEST,
    currentTexts: [REPORT_QUEST, REPORT_QUEST.toLowerCase()],
    retries: 3,
  });

  if (await existsAnyText(page, [V_IGRU, V_IGRU.toLowerCase()])) {
    await clickByTexts(page, [V_IGRU, V_IGRU.toLowerCase()], V_IGRU).catch(() => {});
    await pause(page, 800, 1600);
  }
}

// Название квеста пока не уточнено у пользователя. Требует >=20 резервных минут (проверка на
// стороне вызывающего кода, здесь не реализована -- см. TODO при подключении к диспетчеру).
// Маршрут: Амулет -> Дорожный крест -> Север x2 -> школа (три обычных боя подряд: тренажёрный
// зал, вторая комната в казарме, храм) -> В игру. В отличие от других личных квестов, здесь НЕТ
// обычного "доложить о задании" -- квест не завершается сам после боёв, вместо этого его нужно
// вручную отклонить на странице персонажа (свой ник -> строка "Текущее задание" -> "отказаться").
// Пользователь явно предупредил: кликать "отказаться" ТОЛЬКО в строке "Текущее задание" -- на
// странице персонажа есть другие похожие ссылки, отказ не в той строке отменит не то, что нужно.
// Поэтому используем clickLinkNextToQuest (тот же приём, что и для "инфо" рядом с квестом), а не
// простой clickByTexts по одному лишь слову "отказаться".
const PLAYER_NICK = 'Tsunami';

async function runSchoolTempleQuest(page) {
  console.log('Квест (школа/казарма/храм): маршрут Амулет -> Дорожный крест -> Север x2 -> школа -> 3 боя -> отказ от задания на странице персонажа');

  async function click(text, label) {
    await performStep(page, {
      stepName: label || text,
      currentTexts: [text, text.toLowerCase()],
      retries: 3,
    });
  }

  // Маршрут может быть нарушен по ходу (в т.ч. собственными действиями пользователя в игре
  // параллельно с ботом) -- сервер в этом случае сам отменяет выполнение квеста. Независимо от
  // того, прошли ли все 3 боя успешно или маршрут где-то сломался, ФИНАЛЬНЫЙ шаг один и тот же и
  // обязателен в обоих случаях: вернуться в игру и отказаться от задания в анкете (иначе
  // "Текущее задание" останется висеть незавершённым до следующей попытки).
  let routeError = null;
  try {
    await click('Амулет', 'Амулет');
    await click('Дорожный крест', 'Дорожный крест');
    await click('Север', 'Север (1/2)');
    await click('Север', 'Север (2/2)');
    await click('Идти к школе', 'Идти к школе');
    await click('Осмотреться', 'Осмотреться');
    await click('Подняться по ступеням', 'Подняться по ступеням');
    await click('Идти по парку', 'Идти по парку');

    // Бой 1: тренажёрный зал.
    await click('Войти в тренажерный зал', 'Войти в тренажерный зал');
    await click('Принять бой', 'Принять бой (тренажёрный зал)');
    await click('В бой', 'В бой (тренажёрный зал)');
    await fightLoop(page);
    await click('Продолжить квест', 'Продолжить квест (тренажёрный зал)');

    // Бой 2: казарма.
    await click('Выйти из зала', 'Выйти из зала');
    await click('Войти в казарму', 'Войти в казарму');
    await click('Открыть дверь ключом', 'Открыть дверь ключом');
    await click('Зайти во вторую комнату', 'Зайти во вторую комнату');
    await click('Принять бой', 'Принять бой (казарма)');
    await click('В бой', 'В бой (казарма)');
    await fightLoop(page);
    await click('Продолжить квест', 'Продолжить квест (казарма)');

    // Бой 3: храм.
    await click('Идти дальше по дорожке', 'Идти дальше по дорожке');
    await click('Идти к строениям', 'Идти к строениям');
    await click('Войти в храм', 'Войти в храм');
    await click('Опустить белый рычаг', 'Опустить белый рычаг');
    await click('Напасть на степняка', 'Напасть на степняка');
    await click('В бой', 'В бой (храм)');
    await fightLoop(page);
    await click('Продолжить квест', 'Продолжить квест (храм)');

    await click('Выйти из храма', 'Выйти из храма');
  } catch (e) {
    // На паузе в анкету не идём: задание останется висеть до следующего цикла, это штатно.
    if (isScenarioPausedError(e)) throw e;
    routeError = e;
    console.log(`Квест (школа/казарма/храм): маршрут нарушен (${e.message}) -- всё равно иду отказываться от задания в анкете`);
  }

  // Вернуться в игру перед открытием анкеты -- после обрыва маршрута мы можем быть где угодно.
  try {
    await page.goto('http://lbast.ru/location.php', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await pause(page, 800, 1600);
  } catch (e) {
    console.log(`Квест (школа/казарма/храм): не удалось вернуться в игру перед анкетой (${e.message})`);
  }

  await performStep(page, {
    stepName: PLAYER_NICK,
    currentTexts: [PLAYER_NICK, PLAYER_NICK.toLowerCase()],
    retries: 3,
  }).catch((e) => {
    console.log(`Квест (школа/казарма/храм): не удалось открыть анкету (${e.message})`);
  });

  const declined = await clickLinkNextToQuest(
    page,
    'Текущее задание',
    ['отказаться', 'Отказаться'],
    'Отказаться (строка "Текущее задание")'
  );
  if (!declined) {
    console.log('Квест (школа/казарма/храм): не нашёл "отказаться" в строке "Текущее задание"');
  }

  if (routeError) {
    console.log('Квест (школа/казарма/храм): день завершён с обрывом маршрута, попытка на сегодня использована');
    return false;
  }

  console.log('Квест (школа/казарма/храм): маршрут пройден успешно, задание отклонено в анкете');
  return true;
}

// ===================================================================================
// Гильдия Ордо Экзекуторс -- два повторяемых задания, дающих мораль В ПЛЮС и медали ордо.
// Маршруты перенесены из проекта AI-персонажа (ветка claude/lbast-character-registration-gc7bey,
// файл ai_char/lib/quests_story.js), где обе ветки пройдены вживую 18.09.2026 и принесли
// Медальон бандита и Костяную цепь бандита. Официальный гайд игры: library/help/index.php?mod=102.
//
// Вход: Стоунгард -> Южные ворота -> Идти на юг -> Идти на восток -> Башня Ордо Экзекуторс.
// Гайд предупреждает: с МИНУСОВОЙ моралью внутрь не пустят ("вам здесь не рады") -- ловим это по
// тексту и уходим в суточный бэкофф, чтобы не таскаться к башне каждый цикл впустую.
//
// Задание Ордо занимает тот же слот "Текущее задание", что Харчевня/Штольни/школа преторианцев,
// поэтому берём его только когда эксклюзивного квеста нет (гейт стоит в runDailyQuests).
//
// Главарь банды (zad=1, Рыбацкая деревня, конь lway=q2001_1):
//   Идти за скальную гряду -> Идти по тропе -> Идти дальше -> Залезть в люк -> Прокрасться ->
//   Идти дальше -> Напасть -> бой. Вживую подтверждено, что охрана с паролем сидит на ветке
//   "Идти по дороге", поэтому её в списке шагов НЕТ намеренно (в гайде безопасный путь назван
//   "по скалам" -- на экране игры это "Идти по тропе"). У костра могут заметить: тогда будет
//   лишний бой по дороге, это штатно. После победы -- Медальон бандита и час запрета.
// Банда (zad=2, Пещера бандитов в горах Дарии, конь lway=q2001_2):
//   Добить бандитов -> В бой! -> Костяная цепь бандита, запрет 10 мин.
//
// ПРЕДМЕТЫ ЗАДАНИЯ НЕ СДАЁМ. Сдача в башне дала бы +3 морали и медаль ордо, но Паша 24.09.2026:
// "Цунами сдал квестовый предмет, а нужно их собирать" -- Медальон бандита и Костяная цепь
// бандита передаются и продаются, поэтому копим их в инвентаре. Слот "Текущее задание"
// освобождается сразу после победы, предмет в сумке ничему не мешает, и второй заход в башню
// после боя не нужен (это экономит ещё и резерв на обратную дорогу).
// ===================================================================================
const ORDO_TOWER = 'Башня Ордо Экзекуторс';
const ORDO_MIN_HP = 2000;
const ORDO_MIN_RESERVE_MINUTES = 15;
const ORDO_TOWER_ROUTE = ['Южные ворота', 'Идти на юг', 'Идти на восток', ORDO_TOWER];

const ORDO_QUESTS = [
  {
    key: 'leader',
    zad: 1,
    label: 'Ордо: главарь банды',
    menu: 'Ордо экзекуторс: Уничтожить главаря банды',
    take: 'Уничтожить главаря банды',
    banMinutes: 60,
  },
  {
    key: 'band',
    zad: 2,
    label: 'Ордо: банда',
    menu: 'Ордо экзекуторс: Уничтожить банду',
    take: 'Уничтожить банду',
    banMinutes: 10,
  },
];

// Порядок = приоритет: на одном экране видно несколько вариантов, берём первый из списка.
// "Сдаться", "Спрыгнуть на него", "Идти по дороге" и "Слезть к пещере" сюда не входят намеренно.
const ORDO_MISSION_STEPS = [
  'Идти за скальную гряду',
  'Идти по тропе',
  'Залезть в люк',
  'Прокрасться',
  'Идти дальше',
  'Добить бандитов',
  'Напасть',
  'В бой!',
];

function ordoRestMinutesFromText(text) {
  const m = String(text || '').match(/отдохнуть\s+еще\s+(\d+)\s*мин/i);
  if (!m) return null;
  return Number(m[1]) || 1;
}

function isOrdoQuestReady(key) {
  const until = ordoNextTryAt[key];
  return !Number.isFinite(until) || Date.now() >= until;
}

function delayOrdoQuest(key, minutes, reason) {
  ordoNextTryAt[key] = Date.now() + minutes * 60 * 1000;
  persistDailyQuestState();
  console.log(`Ордо (${key}): следующая попытка не раньше чем через ${minutes} мин (${reason})`);
}

// Прямой goto на конь-шорткат иногда приземляется на промежуточный экран поездки ("В пути еще
// N сек") вместо конечной локации -- ждём и перезагружаем location.php, пока не доедем.
async function waitOutOrdoHorseTravel(page, maxAttempts = 8) {
  for (let i = 0; i < maxAttempts; i++) {
    const text = await getBodyText(page);
    if (!/В\s*пути/i.test(text)) return;
    await pause(page, 2000, 3000);
    await page.goto('http://lbast.ru/location.php', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  }
}

async function walkToOrdoTower(page) {
  if (!(await goToStoneguardViaFastway(page, 'Стоунгард (Ордо)'))) {
    throw new Error('ordo_no_stoneguard');
  }

  for (const step of ORDO_TOWER_ROUTE) {
    await performStep(page, {
      stepName: step,
      currentTexts: [step, step.toLowerCase()],
      retries: 3,
    });
  }

  const text = await getBodyText(page);
  if (/не\s+рады/i.test(text)) {
    console.log(`Ордо: в гильдию не пустили -- мораль ниже нуля (${snapshotText(text, 300)})`);
    throw new Error('ordo_not_welcome');
  }
  return text;
}

async function progressOrdoQuest(page, q) {
  console.log(`${q.label}: маршрут Стоунгард -> ${ORDO_TOWER_ROUTE.join(' -> ')} -> "${q.take}" -> конь q2001_${q.zad} -> бой`);

  await walkToOrdoTower(page);

  const taken = await clickByTexts(page, [q.take, q.take.toLowerCase()], `Ордо: взять "${q.take}"`);
  if (!taken) {
    console.log(`${q.label}: в башне нет ссылки "${q.take}"`);
    delayOrdoQuest(q.key, 60, 'нет ссылки на задание в башне');
    return false;
  }
  await pause(page, 800, 1500);

  const takeText = await getBodyText(page);
  const restAtTower = ordoRestMinutesFromText(takeText);
  if (restAtTower !== null) {
    console.log(`${q.label}: кончился резерв прямо в башне (отдохнуть ещё ${restAtTower} мин)`);
    delayOrdoQuest(q.key, restAtTower + 2, 'кончился резерв');
    return false;
  }

  if (!/Задание принято/i.test(takeText) && !/у\s*вас\s*уже\s*есть\s*задание/i.test(takeText)) {
    // Начало страницы башни -- описание Ордена; причина отказа ниже, в списке заданий и строке
    // "Текущее задание", поэтому печатаем именно этот кусок, а не первые 600 символов описания.
    const at = takeText.search(/Задания:|Выполняйте задания|Текущее задание/);
    console.log(`${q.label}: задание не выдали: ${snapshotText(at >= 0 ? takeText.slice(at) : takeText, 600)}`);
    delayOrdoQuest(q.key, 60, 'задание не выдали');
    return false;
  }

  const horseUrl = `http://lbast.ru/location.php?mod=konj&lway=q2001_${q.zad}`;
  await page.goto(horseUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await pause(page, 900, 1500);
  await waitOutOrdoHorseTravel(page);

  let fought = false;

  for (let i = 0; i < 14; i++) {
    throwIfPausedByManager(`${q.label}: шаг миссии`);
    const text = await getBodyText(page);

    const restNow = ordoRestMinutesFromText(text);
    if (restNow !== null) {
      console.log(`${q.label}: кончился резерв по дороге (отдохнуть ещё ${restNow} мин) -> прерываю маршрут`);
      delayOrdoQuest(q.key, restNow + 2, 'кончился резерв по дороге');
      break;
    }

    if (/Ударить/i.test(text)) {
      await fightLoop(page);
      fought = true;
      await pause(page, 800, 1500);
      // После победы нас выбрасывает на локацию, где снова виден ВХОД в миссию -- по второму кругу
      // её начинать не надо. Бой посреди пути (заметили у костра) входа не показывает.
      const after = await getBodyText(page);
      if (after.includes('Идти за скальную гряду') || after.includes('Добить бандитов')) break;
      continue;
    }

    const next = ORDO_MISSION_STEPS.find((s) => text.includes(s));
    if (!next) break; // миссия кончилась -- под ногами обычная локация
    await clickByTexts(page, [next], `${q.label}: ${next}`);
    await pause(page, 800, 1500);
  }

  if (!fought) {
    console.log(`${q.label}: до боя не дошёл -- вернусь, когда квест снова появится в меню Q`);
    return false;
  }

  ordoItemsCollected += 1;
  delayOrdoQuest(q.key, q.banMinutes, 'запрет после победы');
  // Никакой сдачи: предмет остаётся в сумке (Паша: "нужно их собирать"). Слот задания игра
  // освободила сама после победы, так что возвращаться в башню незачем.
  console.log(`${q.label}: бой пройден, предмет задания в инвентаре (всего собрано за время работы бота: ${ordoItemsCollected})`);
  return true;
}

async function runOrdoQuestsIfAvailable(page, opts = {}) {
  const { listedQuests = [], reserveMinutes = null, hpCurrent = null } = opts;

  const due = ORDO_QUESTS.filter((q) => isQuestInMenu(listedQuests, q.menu) && isOrdoQuestReady(q.key));
  if (!due.length) return false;

  if (typeof reserveMinutes !== 'number' || reserveMinutes < ORDO_MIN_RESERVE_MINUTES
    || typeof hpCurrent !== 'number' || hpCurrent < ORDO_MIN_HP) {
    console.log(`Ордо: пропускаю цикл (нужно >=${ORDO_MIN_RESERVE_MINUTES} резервных минут и >=${ORDO_MIN_HP} HP, есть резерв=${reserveMinutes ?? 'n/a'}, HP=${hpCurrent ?? 'n/a'})`);
    return false;
  }

  for (const q of due) {
    const ok = await runNonQQuestSafe(page, q.label, () => progressOrdoQuest(page, q));
    // Маршрут к башне и обратно + миссия съедают почти весь резерв, поэтому за цикл делаем не
    // больше одного задания Ордо; второе подхватится следующим циклом, оно никуда не денется.
    if (ok) return true;
  }
  return false;
}

// "Старый лучник": не отдельный квест из Q-меню, а способ зафармить стрелу для лука -- вызывается
// после того, как стрела была выпущена в групповом бою (см. runMisttownSecretEventIfDue, которая
// зовёт эту функцию сразу после fightLoopMisttownEvent, если bowUsed). Сами бои здесь обычные
// (без лука/стрел -- пользователь явно пометил "обычный бой"), 2 волка подряд.
// Конь -> Леса Эльсены -> Лесопилка -> Старый лучник -> Охотиться на волков -> Напасть на волка x2
// (каждый через В бой -> fightLoop -> Продолжить квест) -> Уйти.
async function runOldArcherWolfQuest(page) {
  console.log('Квест (Старый лучник): маршрут Конь -> Леса Эльсены -> Лесопилка -> Старый лучник -> Охотиться на волков x2 -> Уйти');

  const HORSE    = 'Конь';
  const ELSENA   = 'Леса Эльсены';
  const V_PUTI   = 'В пути';
  const V_PUTI_E = 'В пути еще';
  const V_PUTI_Y = 'В пути ещё';
  const TO_SAWMILL = 'к лесопилке';
  const SAWMILL    = 'Лесопилка';
  const OLD_ARCHER = 'Старый лучник';
  const HUNT_WOLVES = 'Охотиться на волков';
  const ATTACK_WOLF = 'Напасть на волка';
  const FIGHT = 'В бой';
  const CONTINUE_QUEST = 'Продолжить квест';
  const LEAVE = 'Уйти';

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
      TO_SAWMILL, TO_SAWMILL.toLowerCase(),
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
    nextTexts: [TO_SAWMILL, TO_SAWMILL.toLowerCase()],
    waitForNextMs: 30000,
  });

  await performStep(page, {
    stepName: TO_SAWMILL,
    currentTexts: [TO_SAWMILL, TO_SAWMILL.toLowerCase()],
    nextTexts: [SAWMILL, SAWMILL.toLowerCase()],
    retries: 3,
  });

  await performStep(page, {
    stepName: SAWMILL,
    currentTexts: [SAWMILL, SAWMILL.toLowerCase()],
    nextTexts: [OLD_ARCHER, OLD_ARCHER.toLowerCase()],
    retries: 3,
  });

  await performStep(page, {
    stepName: OLD_ARCHER,
    currentTexts: [OLD_ARCHER, OLD_ARCHER.toLowerCase()],
    nextTexts: [HUNT_WOLVES, HUNT_WOLVES.toLowerCase()],
    retries: 3,
  });

  await performStep(page, {
    stepName: HUNT_WOLVES,
    currentTexts: [HUNT_WOLVES, HUNT_WOLVES.toLowerCase()],
    nextTexts: [ATTACK_WOLF, ATTACK_WOLF.toLowerCase()],
    retries: 3,
  });

  for (let i = 0; i < 2; i++) {
    await performStep(page, {
      stepName: `${ATTACK_WOLF} (${i + 1}/2)`,
      currentTexts: [ATTACK_WOLF, ATTACK_WOLF.toLowerCase()],
      retries: 3,
    });

    await performStep(page, {
      stepName: `${FIGHT} (волк ${i + 1}/2)`,
      currentTexts: [FIGHT, FIGHT.toLowerCase()],
      retries: 3,
    });

    await fightLoop(page);

    await performStep(page, {
      stepName: `${CONTINUE_QUEST} (волк ${i + 1}/2)`,
      currentTexts: [CONTINUE_QUEST, CONTINUE_QUEST.toLowerCase()],
      retries: 3,
    });
  }

  await performStep(page, {
    stepName: LEAVE,
    currentTexts: [LEAVE, LEAVE.toLowerCase()],
    retries: 3,
  });

  console.log('Квест (Старый лучник): маршрут завершён');
  return true;
}

// Вызывается каждый цикл из doScenario. Если стрела была выпущена (needsArrowFarm), но HP/резерва
// не хватает на ещё два боя с волками -- просто ждём следующего цикла, флаг остаётся выставленным.
async function maybeFarmArrow(page, stats) {
  if (!needsArrowFarm) return false;

  const reserveMinutes = typeof stats?.reserveMinutes === 'number' ? stats.reserveMinutes : stats?.cooldown;
  const hpCurrent = typeof stats?.hpCurrent === 'number' ? stats.hpCurrent : null;

  if (typeof reserveMinutes !== 'number' || reserveMinutes < ARROW_FARM_MIN_RESERVE_MINUTES || hpCurrent === null || hpCurrent <= ARROW_FARM_MIN_HP) {
    console.log(`Фарм стрелы: пропускаю цикл (нужно >=${ARROW_FARM_MIN_RESERVE_MINUTES} резервных минут и >${ARROW_FARM_MIN_HP} HP, есть резерв=${reserveMinutes ?? 'n/a'}, HP=${hpCurrent ?? 'n/a'})`);
    return false;
  }

  console.log('Фарм стрелы: условия позволяют, иду к Старому лучнику');
  await runOldArcherWolfQuest(page);
  needsArrowFarm = false;
  persistDailyQuestState();
  return true;
}

// Мисттаунское событие "Тайны ...": объявляется уличным зазывалой в Стоунгарде с конкретной датой
// и временем старта ("Миссию можно начать на N-й день месяца в HH:MM:SS"). Окно на вход всего
// ~20-30 секунд, обычный цикл бота (~10-14 мин) для этого слишком редкий -- расписание читается у
// зазывалы и кэшируется (misttownSecretDueAt), следующее пробуждение цикла подгоняется под момент
// старта (см. scheduleMisttownSecretWakeupIfSoon / runMisttownSecretEventIfDue ниже). 50 мест по
// словам пользователя реально не заканчиваются -- отдельного детекта "опоздал по местам" не нужно.
// После боя ничего особенного не происходит, как в обычном бою.
//
// Общий выход из города один для всех 4 тем, дальше расходится по улице на запад: каждая
// "остановка" имеет свою кнопку "Спуститься вниз" (текст одинаковый, ведёт в разную тему в
// зависимости от того, где на улице её нажали) -- огонь (запад x2) -> земля (ещё запад, x3) ->
// смерть (ещё запад, x4) -> жизнь (от точки смерти на юг, а не на запад).
//
// "Спуститься вниз" доступна всегда (не привязана ко времени старта), но страница статична --
// просто стоять на уже загруженной странице и перечитывать её текст бесполезно, сервер не
// обновит её сам. Поэтому НЕ спускаемся заранее: встаём на уличную точку перед "Спуститься вниз"
// (goToMisttownSecretStreetSpot), ждём заявленное время +1-2 сек (запас на рассинхрон часов), и
// только тогда нажимаем её -- каждый клик это свежая загрузка страницы, так что при необходимости
// повторяем клик с коротким интервалом, а не проверяем один и тот же статичный DOM в цикле
// (см. runMisttownSecretEventIfDue).
const MISTTOWN_SECRET_WEST_COUNT = {
  'огонь': 2,
  'земля': 3,
  'смерть': 4,
  'жизнь': 4, // + Юг после этого
};

async function goToMisttownSecretStreetSpot(page, theme) {
  if (!Object.prototype.hasOwnProperty.call(MISTTOWN_SECRET_WEST_COUNT, theme)) {
    throw new Error(`unknown misttown secret theme: ${theme}`);
  }

  console.log(`Мисттаунское событие (${theme}): маршрут Конь -> Мисттоун -> Идти в город -> Запад -> (место перед "Спуститься вниз")`);

  const HORSE    = 'Конь';
  const MISTTOWN = 'Мисттоун';
  const V_PUTI   = 'В пути';
  const V_PUTI_E = 'В пути еще';
  const V_PUTI_Y = 'В пути ещё';
  const GO_CITY  = 'Идти в город';
  const WEST     = 'Запад';
  const SOUTH    = 'Юг';

  await performStep(page, {
    stepName: HORSE,
    currentTexts: [HORSE, HORSE.toLowerCase()],
    nextTexts: [MISTTOWN, MISTTOWN.toLowerCase()],
    retries: 3,
  });

  await performStep(page, {
    stepName: MISTTOWN,
    currentTexts: [MISTTOWN, MISTTOWN.toLowerCase()],
    waitAfterClickMs: 7000,
    nextTexts: [
      V_PUTI, V_PUTI.toLowerCase(),
      V_PUTI_E, V_PUTI_E.toLowerCase(),
      V_PUTI_Y, V_PUTI_Y.toLowerCase(),
      GO_CITY, GO_CITY.toLowerCase(),
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
    nextTexts: [GO_CITY, GO_CITY.toLowerCase()],
    waitForNextMs: 30000,
  });

  await performStep(page, {
    stepName: GO_CITY,
    currentTexts: [GO_CITY, GO_CITY.toLowerCase()],
    retries: 3,
  });

  const westCount = MISTTOWN_SECRET_WEST_COUNT[theme];
  for (let i = 0; i < westCount; i++) {
    await performStep(page, {
      stepName: `${WEST} (${i + 1}/${westCount})`,
      currentTexts: [WEST, WEST.toLowerCase()],
      retries: 3,
    });
  }

  if (theme === 'жизнь') {
    await performStep(page, {
      stepName: SOUTH,
      currentTexts: [SOUTH, SOUTH.toLowerCase()],
      retries: 3,
    });
  }
}

// Массовый бой мисттаунского события: десятки участников бьют одновременно за ограниченное время,
// поэтому обычный fightLoop с паузами 700-2000мс между действиями категорически не годится --
// нужно жать "Ударить" 3-4 раза в секунду (интервал ~250-330мс). "Лук" -- активная кнопка сразу
// при входе в бой, нажимается один раз (не по условию HP, как "Прием" в обычном fightLoop) --
// в групповых боях стрельнуть можно только один раз за бой, дальше только "Ударить".
// 50 мест не заканчиваются (по словам пользователя), и после боя ничего особенного не происходит --
// обычные DONE_TEXTS ("Бой завершен!"/"Вернуться") без дополнительных шагов, как в обычном бою.
//
// Возвращает { bowUsed }: если стрела была выпущена в этом бою, вызывающий код (см.
// runMisttownSecretEventIfDue) должен потом сходить зафармить новую через runOldArcherWolfQuest --
// если стрелы не было (кнопка "Лук" не появилась), фармить нечего.
async function fightLoopMisttownEvent(page) {
  const UDAR = 'Ударить';
  const BOW = 'Лук';
  const START_FIGHT_TEXTS = ['В бой!', 'в бой!', 'В бой', 'в бой'];
  const DONE_TEXTS = ['Бой завершен!', 'Вернуться', 'вернуться'];
  const MAX_STUCK = 15;

  if (!/Ударить/i.test(await getBodyText(page))) {
    const startOk = await clickByTexts(page, START_FIGHT_TEXTS, 'В бой (мисттаунское событие)');
    if (!startOk) {
      throw new Error('misttown_event_fight_not_reached');
    }
    await pause(page, 300, 600);
  }

  let bowUsed = false;
  if (await existsAnyText(page, [BOW, BOW.toLowerCase()])) {
    bowUsed = await clickByTexts(page, [BOW, BOW.toLowerCase()], BOW);
    await pause(page, 150, 300);

    // Флаг ставим СРАЗУ после выстрела, а не по возвращении из боя. 22.09.2026 ("жизнь") стрела
    // была выпущена, но следом бой упал с ui_stuck:Ударить -- исключение унесло управление в
    // catch вызывающего кода, а вместе с ним и отметку "надо зафармить стрелу": бот её просто
    // не поставил. Стрела к тому моменту уже потрачена, поэтому факт выстрела и надо фиксировать
    // по самому выстрелу.
    if (bowUsed && !needsArrowFarm) {
      needsArrowFarm = true;
      persistDailyQuestState();
      console.log('Стрела выпущена -> отмечено "нужно зафармить" (Старый лучник), сделаем когда позволят HP/резерв');
    }
  }

  let stuck = 0;
  for (let i = 0; i < 1200; i++) {
    if (await existsAnyText(page, DONE_TEXTS)) {
      const ok = await clickByTexts(page, DONE_TEXTS, 'misttown event fight done/return');
      if (!ok) throw new Error('misttown_event_fight_done_click_failed');
      return { bowUsed };
    }

    const ok = await clickByTexts(page, [UDAR, UDAR.toLowerCase()], UDAR);
    if (!ok) {
      stuck += 1;
      // Между разменами в массовом бою кнопки может не быть секунду-другую, поэтому ждём дольше,
      // чем раньше (15 попыток по ~0.2 сек = всего 2.4 сек -- слишком нетерпеливо). Если всё же
      // сдаёмся, пишем в лог сам экран: иначе по "ui_stuck" непонятно, чем бой закончился.
      if (stuck >= MAX_STUCK) {
        const text = (await getBodyText(page)).replace(/\s+/g, ' ').slice(0, 300);
        console.log(`Мисттаунское событие: кнопки "Ударить" нет ${MAX_STUCK} раз подряд, экран: ${text}`);
        throw new Error('misttown_event_fight_stuck');
      }
      await pause(page, 600, 900);
      continue;
    }

    stuck = 0;
    await pause(page, 250, 330);
  }

  throw new Error('misttown_event_fight_timeout');
}

// Расписание мисттаунского события читается у "Уличного зазывалы" (Стоунгард -> Центральная
// площадь), тот же NPC, что и для утреннего скриншота (см. runMorningScreenshotTask). Текст вида:
// "Спешите, только пятьдесят человек смогут познать тайны огня! ... Миссию можно начать на
// 23-й день месяца в 15:51:32". Кэшируем результат в misttownSecretDueAt, чтобы не ходить туда
// каждый цикл -- см. needMisttownSecretRefresh/refreshMisttownSecretSchedule.
const MISTTOWN_SECRET_THEMES = ['огонь', 'земля', 'смерть', 'жизнь'];
const MISTTOWN_SECRET_THEME_WORDS = {
  'огня': 'огонь',
  'земли': 'земля',
  'смерти': 'смерть',
  'жизни': 'жизнь',
};

function parseMisttownSecretSchedule(text) {
  const normalized = String(text || '').replace(/ /g, ' ');
  const result = {};
  const blockRe = /тайны\s+(огня|земли|смерти|жизни)[\s\S]{0,200}?на\s+(\d{1,2})-\S*\s*день\s+месяца\s+в\s+(\d{2}):(\d{2}):(\d{2})/gi;
  let m;
  while ((m = blockRe.exec(normalized)) !== null) {
    const theme = MISTTOWN_SECRET_THEME_WORDS[m[1].toLowerCase()];
    if (!theme) continue;
    result[theme] = {
      day: Number(m[2]),
      hour: Number(m[3]),
      minute: Number(m[4]),
      second: Number(m[5]),
    };
  }
  return result;
}

// "N-й день месяца" без указания месяца -- если этот день в текущем месяце уже прошёл, значит
// речь про следующий месяц (JS Date сам корректно переносит переполнение через setMonth).
function misttownSecretDayTimeToDate({ day, hour, minute, second }, now) {
  const candidate = new Date(now.getFullYear(), now.getMonth(), day, hour, minute, second, 0);
  if (candidate.getTime() <= now.getTime()) {
    candidate.setMonth(candidate.getMonth() + 1);
  }
  return candidate;
}

const MISTTOWN_SECRET_RECHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

// Пол на частоту походов к зазывале. Признак "дата в прошлом" сам по себе не гаснет: если зазывала
// объявил что-то, чего мы не распознали (не распарсили строку, разошлись часы), условие остаётся
// истинным и поход повторяется на каждом заходе. В ночном ожидании, где сон считается по
// будильникам, это выливалось бы в поездку в Стоунгард каждые несколько минут до утра.
const MISTTOWN_SECRET_MIN_RECHECK_MS = 15 * 60 * 1000;

function needMisttownSecretRefresh(now) {
  // Дат нет вовсе -- расписание нужно немедленно, никакой пол тут не уместен.
  if (MISTTOWN_SECRET_THEMES.some((t) => !Number.isFinite(misttownSecretDueAt[t]))) return true;
  if (now - lastMisttownSecretCheckAt < MISTTOWN_SECRET_MIN_RECHECK_MS) return false;
  if (MISTTOWN_SECRET_THEMES.some((t) => misttownSecretDueAt[t] <= now)) return true;
  if (now - lastMisttownSecretCheckAt >= MISTTOWN_SECRET_RECHECK_INTERVAL_MS) return true;
  return false;
}

async function refreshMisttownSecretSchedule(page) {
  console.log('Мисттаунское событие: иду к Уличному зазывале обновить расписание');

  const CENTRAL_SQUARE = 'Центральная площадь';
  const STREET_TOUT = 'Уличный зазывала';

  const stoneguardOk = await goToStoneguardViaFastway(page, 'Стоунгард (расписание мисттаунского события)');
  if (!stoneguardOk) {
    console.log('Мисттаунское событие: не удалось попасть в Стоунгард, попробую в следующем цикле');
    return false;
  }

  const squareOk = await performStep(page, {
    stepName: CENTRAL_SQUARE,
    currentTexts: [CENTRAL_SQUARE, CENTRAL_SQUARE.toLowerCase()],
    nextTexts: [STREET_TOUT, STREET_TOUT.toLowerCase()],
    retries: 3,
  });
  if (!squareOk) {
    console.log('Мисттаунское событие: не удалось попасть на Центральную площадь, попробую в следующем цикле');
    return false;
  }

  const toutOk = await clickByTexts(page, [STREET_TOUT, STREET_TOUT.toLowerCase()], STREET_TOUT);
  if (!toutOk) {
    console.log('Мисттаунское событие: не нашёл "Уличный зазывала" на площади, попробую в следующем цикле');
    return false;
  }
  await pause(page, 800, 1600);

  const text = await getBodyText(page);
  const parsed = parseMisttownSecretSchedule(text);
  const now = Date.now();

  for (const theme of MISTTOWN_SECRET_THEMES) {
    if (!parsed[theme]) continue;
    const dueAt = misttownSecretDayTimeToDate(parsed[theme], new Date(now)).getTime();
    if (misttownSecretDueAt[theme] !== dueAt) {
      misttownSecretDueAt[theme] = dueAt;
      console.log(`Мисттаунское событие (${theme}): дата старта ${new Date(dueAt).toLocaleString()}`);
    }
  }
  lastMisttownSecretCheckAt = now;
  persistDailyQuestState();

  if (await existsAnyText(page, ['В игру', 'в игру'])) {
    await clickByTexts(page, ['В игру', 'в игру'], 'В игру').catch(() => {});
    await pause(page, 800, 1600);
  }

  return true;
}

// Насколько заранее вставать на уличную точку и как долго после заявленного времени ещё пытаться
// (окно входа ~20-30 сек по словам пользователя, берём с запасом на рассинхрон часов/сервера).
const MISTTOWN_SECRET_PRE_POSITION_MS = 3 * 60 * 1000;
const MISTTOWN_SECRET_POLL_WINDOW_MS = 90 * 1000;
// Не подгоняем пробуждение цикла, если до нужного момента ещё дольше, чем обычный цикл и так бы
// сработал (getRandomCycleDelayMs даёт 10-14 мин) -- иначе рискуем внезапно проспать 3 часа вместо
// обычных 10-14 минут, если это событие ещё далеко.
const MISTTOWN_SECRET_MAX_OVERRIDE_LOOKAHEAD_MS = 15 * 60 * 1000;

function findDueMisttownSecretTheme(now) {
  for (const theme of MISTTOWN_SECRET_THEMES) {
    const dueAt = misttownSecretDueAt[theme];
    if (!Number.isFinite(dueAt)) continue;
    if (misttownSecretAttemptedAt[theme] === dueAt) continue;
    if (now >= dueAt - MISTTOWN_SECRET_PRE_POSITION_MS && now <= dueAt + MISTTOWN_SECRET_POLL_WINDOW_MS) {
      return theme;
    }
  }
  return null;
}

// Есть ли неотработанное мисттаунское событие в ближайшие windowMs. Нужно длинным задачам, которые
// занимают цикл надолго (цепочки квестов по маршрутам, см. runDailyQuests): событие идёт по часам,
// окно на вход ~20-30 сек, и опоздать из-за двухчасового квеста нельзя.
function misttownSecretDueWithinMs(windowMs) {
  const now = Date.now();
  for (const theme of MISTTOWN_SECRET_THEMES) {
    const dueAt = misttownSecretDueAt[theme];
    if (!Number.isFinite(dueAt)) continue;
    if (misttownSecretAttemptedAt[theme] === dueAt) continue;
    if (dueAt + MISTTOWN_SECRET_POLL_WINDOW_MS >= now && dueAt - now <= windowMs) return theme;
  }
  return null;
}

// Сколько осталось до момента, когда пора вставать на уличную точку у ближайшего неотработанного
// события (null -- ничего не запланировано). Нужно, чтобы длинные сны никогда не перепрыгивали
// событие: окно на вход ~20-30 сек, промахнуться мимо него нельзя.
function msUntilNextMisttownPrePosition() {
  const now = Date.now();
  let soonest = null;
  for (const theme of MISTTOWN_SECRET_THEMES) {
    const dueAt = misttownSecretDueAt[theme];
    if (!Number.isFinite(dueAt)) continue;
    if (misttownSecretAttemptedAt[theme] === dueAt) continue;
    const wakeAt = dueAt - MISTTOWN_SECRET_PRE_POSITION_MS;
    if (wakeAt > now && (soonest === null || wakeAt < soonest)) soonest = wakeAt;
  }
  return soonest === null ? null : soonest - now;
}

// Насколько близко должно быть событие, чтобы выводить окно браузера вперёд (bringToFront).
const NIGHT_WAIT_ACTIVE_WINDOW_MS = 60 * 60 * 1000;

// Запас после объявленного момента, по истечении которого дата считается заведомо прошедшей.
const MISTTOWN_SECRET_STALE_MARGIN_MS = 2 * 60 * 1000;

// Через сколько расписание протухнет и его пора будет перечитать у зазывалы. Нужно отдельно от
// пре-позиции: место на событие занимается ЗА 3 МИНУТЫ до старта, поэтому сразу после попытки
// объявленная дата всё ещё в будущем, и needMisttownSecretRefresh не считает её устаревшей.
// Без этого будильника ночное ожидание после события считало бы срок по остальным трём темам и
// могло проспать новую дату только что отработавшей (Паша, 25.09.2026: "и после прошедшего
// события запишется новое и так же отработает?").
function msUntilMisttownScheduleStale() {
  const now = Date.now();
  let soonest = null;
  for (const theme of MISTTOWN_SECRET_THEMES) {
    const dueAt = misttownSecretDueAt[theme];
    if (!Number.isFinite(dueAt)) return 0; // даты нет вовсе -- расписание нужно прямо сейчас
    const staleAt = dueAt + MISTTOWN_SECRET_POLL_WINDOW_MS + MISTTOWN_SECRET_STALE_MARGIN_MS;
    if (soonest === null || staleAt < soonest) soonest = staleAt;
  }
  return soonest === null ? null : Math.max(0, soonest - now);
}

// Сон в режиме ночного ожидания: СРАЗУ до пре-позиции ближайшего события, без промежуточных
// пробуждений. Изначально здесь стояла обычная задержка цикла (14-21 мин) независимо от того,
// через сколько событие, и бот перезагружал страницу каждые ~18 минут, хотя ближайшее событие
// могло быть через двое суток (Паша, 24.09.2026: "зачем так часто обновляется в игре когда ждет
// событие? если ближайшее не сегодня даже"). Промежуточный пульс нужен был только ради отлова
// PvP-атаки, но по логам их 1-4 в сутки -- 25.09.2026 Паша решил, что это лишнее.
// Расписание событий уже лежит в состоянии, перечитывать его незачем; а сон всё равно ограничен
// сверху стартом обычного сценария (обычно 6 часов), так что на протухшем расписании мы застрять
// не можем -- дальше начинается обычный цикл со своей проверкой.
// Будильников два: пре-позиция ближайшего неотработанного события и момент, когда расписание
// протухнет и за ним надо будет сходить к зазывале. Берём тот, что раньше.
// null -- расписания нет вовсе, спать можно до самого старта обычного сценария.
function nightWaitSleepMs() {
  const candidates = [];

  const untilPre = msUntilNextMisttownPrePosition();
  if (untilPre !== null) candidates.push(Math.max(30 * 1000, untilPre));

  // Будить себя раньше, чем needMisttownSecretRefresh разрешит следующий поход, бессмысленно --
  // проснёмся и ничего не сделаем. Поэтому берём максимум из "когда протухнет" и "когда можно".
  const untilStale = msUntilMisttownScheduleStale();
  if (untilStale !== null) {
    const untilAllowed = Math.max(0, lastMisttownSecretCheckAt + MISTTOWN_SECRET_MIN_RECHECK_MS - Date.now());
    candidates.push(Math.max(30 * 1000, untilStale, untilAllowed));
  }

  return candidates.length ? Math.min(...candidates) : null;
}

// Подводит следующее пробуждение цикла к моменту, когда пора вставать на уличную точку заранее --
// вызывается в конце каждого цикла (см. doScenario), не только когда событие уже "due".
function scheduleMisttownSecretWakeupIfSoon() {
  const now = Date.now();
  let soonestWakeAt = null;

  for (const theme of MISTTOWN_SECRET_THEMES) {
    const dueAt = misttownSecretDueAt[theme];
    if (!Number.isFinite(dueAt)) continue;
    if (misttownSecretAttemptedAt[theme] === dueAt) continue;

    const wakeAt = dueAt - MISTTOWN_SECRET_PRE_POSITION_MS;
    if (wakeAt > now && (soonestWakeAt === null || wakeAt < soonestWakeAt)) {
      soonestWakeAt = wakeAt;
    }
  }

  if (soonestWakeAt === null) return;

  const msUntilWake = soonestWakeAt - now;
  if (msUntilWake <= 0 || msUntilWake > MISTTOWN_SECRET_MAX_OVERRIDE_LOOKAHEAD_MS) return;

  if (nextCycleDelayOverrideMs === null || msUntilWake < nextCycleDelayOverrideMs) {
    nextCycleDelayOverrideMs = msUntilWake;
    console.log(`Мисттаунское событие: подвожу следующее пробуждение цикла к ${new Date(soonestWakeAt).toLocaleString()} (через ${Math.round(msUntilWake / 1000)} сек)`);
  }
}

// Главная точка входа, вызывается каждый цикл из doScenario. Возвращает true, если что-то делали
// (не даёт остальным пунктам цикла считать, что "ничего не произошло").
async function runMisttownSecretEventIfDue(page) {
  const now = Date.now();

  const dueTheme = findDueMisttownSecretTheme(now);
  if (dueTheme) {
    const dueAt = misttownSecretDueAt[dueTheme];
    console.log(`Мисттаунское событие (${dueTheme}): время подошло (${new Date(dueAt).toLocaleString()}), иду занимать место`);

    try {
      // Встаём на уличную точку заранее, но "Спуститься вниз" НЕ нажимаем сразу -- страница
      // статична, стоять на уже загруженной и перечитывать её бесполезно (сервер её не обновит).
      // Ждём заявленное время +1-2 сек запаса на рассинхрон часов и только тогда жмём вниз --
      // это свежая загрузка страницы, так что сразу увидим бой, если он уже начался.
      await goToMisttownSecretStreetSpot(page, dueTheme);

      const clickBufferMs = 1000 + Math.round(Math.random() * 1000);
      const clickAt = dueAt + clickBufferMs;
      if (Date.now() < clickAt) {
        await sleepPlain(clickAt - Date.now());
      }

      const GO_DOWN = 'Спуститься вниз';
      const FIGHT_TEXTS = ['В бой!', 'в бой!', 'В бой', 'в бой'];

      // Один точно рассчитанный клик вниз (не полагаемся на повторные клики "Спуститься вниз" --
      // после первого клика мы уже не на уличной странице, где эта ссылка была, так что повторить
      // именно её нельзя; если не получилось с первого раза, честно сообщаем и не пытаемся дальше).
      const clicked = await clickByTexts(page, [GO_DOWN, GO_DOWN.toLowerCase()], GO_DOWN);
      if (!clicked) {
        console.log(`Мисттаунское событие (${dueTheme}): не нашёл "Спуститься вниз"`);
      } else {
        await pause(page, 300, 600);

        if (await existsAnyClickable(page, FIGHT_TEXTS)) {
          // Отметку "стрела потрачена" ставит сам fightLoopMisttownEvent сразу после выстрела --
          // чтобы она не потерялась, если бой дальше упадёт. Фарм стрелы не срочный: им займётся
          // обычный диспетчер (maybeFarmArrow в doScenario), когда позволят HP и резерв.
          const { bowUsed } = await fightLoopMisttownEvent(page);
          console.log(`Мисттаунское событие (${dueTheme}): бой пройден${bowUsed ? ' (стрела выпущена)' : ''}`);
        } else {
          // Отличаем "опоздал" от "не пустили": при нулевом/отрицательном резерве игра на спуск
          // отвечает "Вы слишком устали. Требуется отдых еще N мин." -- боя на экране нет по
          // совершенно другой причине, и лечится это не таймингом, а сохранённым резервом
          // (см. MISTTOWN_PREP_GUARD_MS).
          const downText = await getBodyText(page);
          const tired = downText.match(/слишком\s+устали[^.]*?(\d+)\s*мин/i);
          if (tired) {
            console.log(`Мисттаунское событие (${dueTheme}): в бой не пустили -- кончился резерв ("слишком устали", ещё ${tired[1]} мин). Резерв надо копить заранее.`);
          } else {
            console.log(`Мисттаунское событие (${dueTheme}): спустился вниз, но бой ещё не появился -- похоже, опоздал или разошёлся по времени с сервером`);
          }
        }
      }
    } catch (e) {
      console.log(`Мисттаунское событие (${dueTheme}): ошибка (${e.message})`);
    }

    misttownSecretAttemptedAt[dueTheme] = dueAt;
    persistDailyQuestState();

    try {
      await page.goto('http://lbast.ru/location.php', { waitUntil: 'domcontentloaded', timeout: 60000 });
      await pause(page, 800, 1600);
    } catch (e) { /* ignore, main loop will recover if needed */ }

    return true;
  }

  if (needMisttownSecretRefresh(now)) {
    return await refreshMisttownSecretSchedule(page);
  }

  return false;
}

// Охота на лосей: раз в день, ходовая точка убивается кем-то на сервере, поэтому "бота" (цели
// охоты) может уже не быть на месте — это нормальное состояние, а не ошибка маршрута.
// Конь -> Леса Эльсены -> (ожидание 7с/подтверждение поездки) -> Запад x2 -> Север ->
// если есть "Охотиться на лосей" -> обычный бой (fightLoop) -> после боя: Амулет -> Стоунгард ->
// Северные ворота -> Идти на север -> Магистратура Империи -> Ратуша -> В игру.
// Если бота нет - дальше идти не нужно, день считается пройденным (canRunElkHuntNow до завтра).
async function runElkHuntTask(page) {
  console.log('Охота на лосей: маршрут Конь -> Леса Эльсены -> Запад x2 -> Север -> проверка бота');

  const HORSE   = 'Конь';
  const ELSENA  = 'Леса Эльсены';
  const V_PUTI   = 'В пути';
  const V_PUTI_E = 'В пути еще';
  const V_PUTI_Y = 'В пути ещё';
  const WEST  = 'Запад';
  const NORTH = 'Север';
  const HUNT  = 'Охотиться на лосей';
  const HUNT_GO = 'Охотиться';
  const AMULET      = 'Амулет';
  const STONEGUARD  = 'Стоунгард';
  const NORTH_GATE  = 'Северные ворота';
  const GO_NORTH    = 'Идти на север';
  const MAGISTRATE  = 'Магистратура Империи';
  const TOWN_HALL   = 'Ратуша';
  const V_IGRU2     = 'В игру';

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
    waitForNextMs: 30000,
  });

  async function stepMany(text, count) {
    for (let i = 0; i < count; i++) {
      const ok = await tryPerformStepOptional(page, {
        stepName: `${text} (${i + 1}/${count})`,
        currentTexts: [text, text.toLowerCase()],
      });
      if (!ok) break;
    }
  }

  await stepMany(WEST, 2);
  await stepMany(NORTH, 1);
  await pause(page, 800, 1600);

  const spotText = await getBodyText(page);
  if (!new RegExp(HUNT, 'i').test(spotText)) {
    console.log('Охота на лосей: бота нет на месте сегодня — это нормально, дальше не иду');
    return;
  }

  console.log('Охота на лосей: бот есть, начинаю бой');
  // "Охотиться" (следующий шаг) is a substring of "Охотиться на лосей" (this step's own button),
  // so a has-text-based nextTexts check would false-positive on the not-yet-clicked HUNT button
  // itself and skip this click entirely. Don't pass nextTexts here — just click unconditionally.
  await performStep(page, {
    stepName: HUNT,
    currentTexts: [HUNT, HUNT.toLowerCase()],
    retries: 3,
  });

  // Промежуточный экран "Вы замечаете рога, торчащие из кустов." с кнопками
  // "Охотиться"/"Уйти". Exact-match click, not clickByTexts' substring match, so it can't hit
  // a lingering "Охотиться на лосей" button by mistake.
  await pause(page, 800, 1600);

  // Сервер может вместо экрана с рогами показать "Вы уже выполняли задание сегодня" (квест уже
  // засчитан на сегодня, например если он был выполнен вручную или ботом раньше в этом же дне,
  // а бот на месте всё равно ещё отображался). Это не ошибка, а нормальный "уже сделано" исход,
  // как и отсутствие бота на месте (см. проверку spotText выше) -- просто возвращаемся.
  const afterHuntClickText = await getBodyText(page);
  if (/уже\s+выполняли\s+задание/i.test(afterHuntClickText)) {
    console.log('Охота на лосей: "уже выполняли задание сегодня" — квест уже засчитан, возвращаюсь');
    await clickByTexts(page, ['Вернуться', 'вернуться'], 'Вернуться').catch(() => {});
    await pause(page, 800, 1600);
    return;
  }

  const huntGoOk = await clickByTextsExact(page, [HUNT_GO, HUNT_GO.toLowerCase()], HUNT_GO);
  if (!huntGoOk) {
    throw new Error('elk_hunt_confirm_not_found');
  }
  await pause(page, 800, 1800);

  await fightLoop(page);

  console.log('Охота на лосей: после боя иду обратно Амулет -> Стоунгард -> Северные ворота -> Идти на север -> Магистратура Империи -> Ратуша -> В игру');

  await performStep(page, {
    stepName: AMULET,
    currentTexts: [AMULET, AMULET.toLowerCase()],
    nextTexts: [STONEGUARD, STONEGUARD.toLowerCase()],
    retries: 3,
  });

  await performStep(page, {
    stepName: STONEGUARD,
    currentTexts: [STONEGUARD, STONEGUARD.toLowerCase()],
    nextTexts: [NORTH_GATE, NORTH_GATE.toLowerCase()],
    retries: 3,
  });

  await performStep(page, {
    stepName: NORTH_GATE,
    currentTexts: [NORTH_GATE, NORTH_GATE.toLowerCase()],
    nextTexts: [GO_NORTH, GO_NORTH.toLowerCase()],
    retries: 3,
  });

  await performStep(page, {
    stepName: GO_NORTH,
    currentTexts: [GO_NORTH, GO_NORTH.toLowerCase()],
    nextTexts: [MAGISTRATE, MAGISTRATE.toLowerCase()],
    retries: 3,
  });

  await performStep(page, {
    stepName: MAGISTRATE,
    currentTexts: [MAGISTRATE, MAGISTRATE.toLowerCase()],
    nextTexts: [TOWN_HALL, TOWN_HALL.toLowerCase()],
    retries: 3,
  });

  // "В игру" is always in the top nav (present even before this click), so skipIfNextVisible's
  // "next step already visible" check would false-positive and skip clicking "Ратуша" entirely.
  await performStep(page, {
    stepName: TOWN_HALL,
    currentTexts: [TOWN_HALL, TOWN_HALL.toLowerCase()],
    nextTexts: [V_IGRU2, V_IGRU2.toLowerCase()],
    retries: 3,
    skipIfNextVisible: false,
  });

  await performStep(page, {
    stepName: V_IGRU2,
    currentTexts: [V_IGRU2, V_IGRU2.toLowerCase()],
    nextTexts: [],
    retries: 3,
  });
}

// Дейлик вторника: Гнёзда гарпий. Конь -> Горы Дарии -> (ожидание 7с/подтверждение поездки) ->
// Идти на запад -> Гнёзда гарпий (обычный бой, ровно 3 раза подряд на том же месте). Как и
// остальные охоты (см. resetHuntStateIfNewDay), цель имеет реальный кулдаун атаки -- прогресс
// (harpyHuntFightsToday) сохраняется между циклами вместо перезапуска всех 3 боёв заново.
async function runTuesdayHarpyExtraDaily(page) {
  resetHuntStateIfNewDay();
  if (harpyHuntFightsToday >= 3) {
    console.log('Дейлик (вторник): гарпии уже сделаны сегодня, пропускаю');
    return true;
  }

  console.log('Дейлик (вторник): маршрут Конь -> Горы Дарии -> Идти на запад -> Гнёзда гарпий x3');

  const HORSE    = 'Конь';
  const DARIA    = 'Горы Дарии';
  const V_PUTI   = 'В пути';
  const V_PUTI_E = 'В пути еще';
  const V_PUTI_Y = 'В пути ещё';
  const GO_WEST  = 'Идти на запад';
  const HARPY_NESTS   = 'Гнёзда гарпий';
  const HARPY_NESTS_E = 'Гнезда гарпий';
  const V_IGRU   = 'В игру';

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
      V_PUTI_E, V_PUTI_E.toLowerCase(),
      V_PUTI_Y, V_PUTI_Y.toLowerCase(),
      GO_WEST, GO_WEST.toLowerCase(),
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
    nextTexts: [GO_WEST, GO_WEST.toLowerCase()],
    waitForNextMs: 30000,
  });

  await performStep(page, {
    stepName: GO_WEST,
    currentTexts: [GO_WEST, GO_WEST.toLowerCase()],
    nextTexts: [HARPY_NESTS, HARPY_NESTS.toLowerCase(), HARPY_NESTS_E, HARPY_NESTS_E.toLowerCase()],
    retries: 3,
  });

  for (let i = harpyHuntFightsToday; i < 3; i++) {
    console.log(`Дейлик (вторник): бой с гарпиями ${i + 1}/3`);
    await performStep(page, {
      stepName: `${HARPY_NESTS} (${i + 1}/3)`,
      currentTexts: [HARPY_NESTS, HARPY_NESTS.toLowerCase(), HARPY_NESTS_E, HARPY_NESTS_E.toLowerCase()],
      retries: 3,
    });

    try {
      await fightLoop(page);
    } catch (e) {
      const waitMinutes = parseCooldownError(e);
      if (waitMinutes !== null) {
        console.log(`Дейлик (вторник): гарпии ещё на кулдауне (${waitMinutes} мин, сделано ${i}/3) -> отложу оставшиеся бои до следующего цикла`);
        harpyHuntFightsToday = i;
        persistDailyQuestState();
        await clickByTexts(page, ['Назад', 'назад'], 'Назад').catch(() => {});
        return false;
      }
      throw e;
    }

    harpyHuntFightsToday = i + 1;
    persistDailyQuestState();
  }

  if (await existsAnyText(page, [V_IGRU, V_IGRU.toLowerCase()])) {
    await clickByTexts(page, [V_IGRU, V_IGRU.toLowerCase()], V_IGRU).catch(() => {});
    await pause(page, 800, 1600);
  }

  return harpyHuntFightsToday >= 3;
}

// Дейлик среды: 5 независимых охот подряд, каждая начинается заново с Амулет/Конь и
// заканчивается своим необязательным "В игру". Каждая цель имеет реальный игровой кулдаун на
// атаку -- прогресс (wednesdayMountainSpiritDoneToday / wednesdayHyenaFightsToday /
// boarHuntFightsToday / bisonHuntFightsToday / varanHuntFightsToday, см. resetHuntStateIfNewDay)
// сохраняется между циклами, поэтому кулдаун на одной охоте откладывает только её остаток, а не
// перезапускает уже пройденные охоты заново.

async function runWednesdayMountainSpirit(page) {
  resetHuntStateIfNewDay();
  if (wednesdayMountainSpiritDoneToday) {
    console.log('Дейлик (среда, 1/5): дух гор уже сделан сегодня, пропускаю');
    return;
  }

  console.log('Дейлик (среда, 1/5): Дух гор — Конь -> Горы Дарии -> запад/юг/запад/запад/север/север -> пещера -> тоннель -> бой');

  const HORSE  = 'Конь';
  const DARIA  = 'Горы Дарии';
  const V_PUTI   = 'В пути';
  const V_PUTI_E = 'В пути еще';
  const V_PUTI_Y = 'В пути ещё';
  const WEST  = 'Запад';
  const SOUTH = 'Юг';
  const NORTH = 'Север';
  const LOOK_CAVE = 'Осмотреть пещеру';
  const DESCEND   = 'Спуститься в тоннель';
  const V_IGRU = 'В игру';

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
    waitForNextMs: 30000,
  });

  async function clickDir(text, stepLabel) {
    await performStep(page, {
      stepName: stepLabel,
      currentTexts: [text, text.toLowerCase()],
      retries: 3,
    });
  }

  await clickDir(WEST, 'Запад (1/6)');
  await clickDir(SOUTH, 'Юг (2/6)');
  await clickDir(WEST, 'Запад (3/6)');
  await clickDir(WEST, 'Запад (4/6)');
  await clickDir(NORTH, 'Север (5/6)');
  await clickDir(NORTH, 'Север (6/6)');

  await performStep(page, {
    stepName: LOOK_CAVE,
    currentTexts: [LOOK_CAVE, LOOK_CAVE.toLowerCase()],
    nextTexts: [DESCEND, DESCEND.toLowerCase()],
    retries: 3,
  });

  await performStep(page, {
    stepName: DESCEND,
    currentTexts: [DESCEND, DESCEND.toLowerCase()],
    retries: 3,
  });

  try {
    await fightLoop(page);
  } catch (e) {
    const waitMinutes = parseCooldownError(e);
    if (waitMinutes !== null) {
      console.log(`Дейлик (среда, 1/5): дух гор ещё на кулдауне (${waitMinutes} мин) -> отложу до следующего цикла`);
      await clickByTexts(page, ['Назад', 'назад'], 'Назад').catch(() => {});
      return;
    }
    throw e;
  }

  wednesdayMountainSpiritDoneToday = true;
  persistDailyQuestState();

  if (await existsAnyText(page, [V_IGRU, V_IGRU.toLowerCase()])) {
    await clickByTexts(page, [V_IGRU, V_IGRU.toLowerCase()], V_IGRU).catch(() => {});
    await pause(page, 800, 1600);
  }
}

async function runWednesdayHyenaHunt(page) {
  resetHuntStateIfNewDay();
  if (wednesdayHyenaFightsToday >= 2) {
    console.log('Дейлик (среда, 2/5): гиены уже сделаны сегодня, пропускаю');
    return;
  }

  console.log('Дейлик (среда, 2/5): Охота на гиен — Амулет -> Таверна -> юг -> запад -> Выслеживать гиен x2');

  const AMULET = 'Амулет';
  const TAVERN = 'Таверна';
  const SOUTH  = 'Юг';
  const WEST   = 'Запад';
  const TRACK_HYENAS = 'Выслеживать гиен';
  const V_IGRU = 'В игру';

  await performStep(page, {
    stepName: AMULET,
    currentTexts: [AMULET, AMULET.toLowerCase()],
    nextTexts: [TAVERN, TAVERN.toLowerCase()],
    retries: 3,
  });

  await performStep(page, {
    stepName: TAVERN,
    currentTexts: [TAVERN, TAVERN.toLowerCase()],
    nextTexts: [SOUTH, SOUTH.toLowerCase()],
    retries: 3,
  });

  // Тот же класс проблемы, что и в runBoarHunt: следующее направление может быть уже видно на
  // хабе ДО реального перехода (несколько направлений на одной странице) -- форсируем клик.
  await performStep(page, {
    stepName: SOUTH,
    currentTexts: [SOUTH, SOUTH.toLowerCase()],
    nextTexts: [WEST, WEST.toLowerCase()],
    retries: 3,
    skipIfNextVisible: false,
  });

  await performStep(page, {
    stepName: WEST,
    currentTexts: [WEST, WEST.toLowerCase()],
    nextTexts: [TRACK_HYENAS, TRACK_HYENAS.toLowerCase()],
    retries: 3,
  });

  for (let i = wednesdayHyenaFightsToday; i < 2; i++) {
    console.log(`Дейлик (среда, 2/5): бой с гиенами ${i + 1}/2`);
    await performStep(page, {
      stepName: `${TRACK_HYENAS} (${i + 1}/2)`,
      currentTexts: [TRACK_HYENAS, TRACK_HYENAS.toLowerCase()],
      retries: 3,
    });

    try {
      await fightLoop(page);
    } catch (e) {
      const waitMinutes = parseCooldownError(e);
      if (waitMinutes !== null) {
        console.log(`Дейлик (среда, 2/5): гиены ещё на кулдауне (${waitMinutes} мин, сделано ${i}/2) -> отложу оставшиеся бои до следующего цикла`);
        wednesdayHyenaFightsToday = i;
        persistDailyQuestState();
        await clickByTexts(page, ['Назад', 'назад'], 'Назад').catch(() => {});
        return;
      }
      throw e;
    }

    wednesdayHyenaFightsToday = i + 1;
    persistDailyQuestState();
  }

  if (await existsAnyText(page, [V_IGRU, V_IGRU.toLowerCase()])) {
    await clickByTexts(page, [V_IGRU, V_IGRU.toLowerCase()], V_IGRU).catch(() => {});
    await pause(page, 800, 1600);
  }
}

// Общий маршрут охоты на кабана: Конь -> Леса Эльсены -> запад -> юг -> Напасть на кабана xN.
// Используется в среду (3/5, x2), пятницу (1/2, x2) и воскресенье (1/2, x3) — маршрут в игре
// идентичен, отличаются только dayLabel в логах и число боёв.
async function runBoarHunt(page, dayLabel, count = 2) {
  resetHuntStateIfNewDay();
  if (boarHuntFightsToday >= count) {
    console.log(`Дейлик (${dayLabel}): кабан уже сделан сегодня, пропускаю`);
    return;
  }

  console.log(`Дейлик (${dayLabel}): Кабан — Конь -> Леса Эльсены -> запад -> юг -> Напасть на кабана x${count}`);

  const HORSE  = 'Конь';
  const ELSENA = 'Леса Эльсены';
  const V_PUTI   = 'В пути';
  const V_PUTI_E = 'В пути еще';
  const V_PUTI_Y = 'В пути ещё';
  const WEST  = 'Запад';
  const SOUTH = 'Юг';
  const ATTACK_BOAR = 'Напасть на кабана';
  const V_IGRU = 'В игру';

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
    waitForNextMs: 30000,
  });

  // "Юг" ведёт к волчьей поляне прямо с этого хаба (см. volki_v_lesu.js), т.е. виден на странице
  // ещё ДО клика по "Запад" -- skipIfNextVisible здесь ложно решил бы, что "Запад" уже пройден,
  // и увёл бы прямиком к волкам вместо кабана. Форсируем реальный клик.
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

  for (let i = boarHuntFightsToday; i < count; i++) {
    console.log(`Дейлик (${dayLabel}): бой с кабаном ${i + 1}/${count}`);
    await performStep(page, {
      stepName: `${ATTACK_BOAR} (${i + 1}/${count})`,
      currentTexts: [ATTACK_BOAR, ATTACK_BOAR.toLowerCase()],
      retries: 3,
    });

    try {
      await fightLoop(page);
    } catch (e) {
      const waitMinutes = parseCooldownError(e);
      if (waitMinutes !== null) {
        console.log(`Дейлик (${dayLabel}): кабан ещё на кулдауне (${waitMinutes} мин, сделано ${i}/${count}) -> отложу оставшиеся бои до следующего цикла`);
        boarHuntFightsToday = i;
        persistDailyQuestState();
        await clickByTexts(page, ['Назад', 'назад'], 'Назад').catch(() => {});
        return;
      }
      throw e;
    }

    boarHuntFightsToday = i + 1;
    persistDailyQuestState();
  }

  if (await existsAnyText(page, [V_IGRU, V_IGRU.toLowerCase()])) {
    await clickByTexts(page, [V_IGRU, V_IGRU.toLowerCase()], V_IGRU).catch(() => {});
    await pause(page, 800, 1600);
  }
}

// Общий маршрут охоты на бизона: Амулет -> Дорожный крест -> восток x2 -> Охотиться xN.
// Используется в среду (4/5, x2) и воскресенье (2/2, x3) — маршрут в игре идентичен, отличаются
// только dayLabel в логах и число боёв. Шаг "восток x2" — навигация до места охоты, не связана
// со счётчиком боёв.
async function runBisonHunt(page, dayLabel, count = 2) {
  resetHuntStateIfNewDay();
  if (bisonHuntFightsToday >= count) {
    console.log(`Дейлик (${dayLabel}): бизон уже сделан сегодня, пропускаю`);
    return;
  }

  console.log(`Дейлик (${dayLabel}): Бизон — Амулет -> Дорожный крест -> восток x2 -> Охотиться x${count}`);

  const AMULET     = 'Амулет';
  const ROAD_CROSS = 'Дорожный крест';
  const EAST = 'Восток';
  const HUNT = 'Охотиться';
  const V_IGRU = 'В игру';

  await performStep(page, {
    stepName: AMULET,
    currentTexts: [AMULET, AMULET.toLowerCase()],
    nextTexts: [ROAD_CROSS, ROAD_CROSS.toLowerCase()],
    retries: 3,
  });

  await performStep(page, {
    stepName: ROAD_CROSS,
    currentTexts: [ROAD_CROSS, ROAD_CROSS.toLowerCase()],
    nextTexts: [EAST, EAST.toLowerCase()],
    retries: 3,
  });

  async function stepMany(text, count) {
    for (let i = 0; i < count; i++) {
      const ok = await tryPerformStepOptional(page, {
        stepName: `${text} (${i + 1}/${count})`,
        currentTexts: [text, text.toLowerCase()],
      });
      if (!ok) break;
    }
  }

  await stepMany(EAST, 2);
  await pause(page, 800, 1600);

  for (let i = bisonHuntFightsToday; i < count; i++) {
    console.log(`Дейлик (${dayLabel}): бой с бизоном ${i + 1}/${count}`);
    // "Охотиться" -- то же слово, что и confirm-кнопка охоты на лосей (см. clickByTextsExact) --
    // кликаем точным совпадением, а не has-text, чтобы не задеть похожую по тексту кнопку.
    const ok = await clickByTextsExact(page, [HUNT, HUNT.toLowerCase()], `${HUNT} (${i + 1}/${count})`);
    if (!ok) throw new Error('bison_hunt_button_not_found');
    await pause(page, 800, 1600);

    try {
      await fightLoop(page);
    } catch (e) {
      const waitMinutes = parseCooldownError(e);
      if (waitMinutes !== null) {
        console.log(`Дейлик (${dayLabel}): бизон ещё на кулдауне (${waitMinutes} мин, сделано ${i}/${count}) -> отложу оставшиеся бои до следующего цикла`);
        bisonHuntFightsToday = i;
        persistDailyQuestState();
        await clickByTexts(page, ['Назад', 'назад'], 'Назад').catch(() => {});
        return;
      }
      throw e;
    }

    bisonHuntFightsToday = i + 1;
    persistDailyQuestState();
  }

  if (await existsAnyText(page, [V_IGRU, V_IGRU.toLowerCase()])) {
    await clickByTexts(page, [V_IGRU, V_IGRU.toLowerCase()], V_IGRU).catch(() => {});
    await pause(page, 800, 1600);
  }
}

// Общий маршрут охоты на варана: Амулет -> Дорожный крест -> юг -> Устроиться на привал x2.
// Используется и в среду (5/5), и в пятницу (2/2) — маршрут в игре идентичен, отличается
// только dayLabel в логах.
async function runVaranHunt(page, dayLabel) {
  resetHuntStateIfNewDay();
  if (varanHuntFightsToday >= 2) {
    console.log(`Дейлик (${dayLabel}): варан уже сделан сегодня, пропускаю`);
    return;
  }

  console.log(`Дейлик (${dayLabel}): Варан — Амулет -> Дорожный крест -> юг -> Устроиться на привал x2`);

  const AMULET     = 'Амулет';
  const ROAD_CROSS = 'Дорожный крест';
  const SOUTH = 'Юг';
  const CAMP  = 'Устроиться на привал';
  const V_IGRU = 'В игру';

  await performStep(page, {
    stepName: AMULET,
    currentTexts: [AMULET, AMULET.toLowerCase()],
    nextTexts: [ROAD_CROSS, ROAD_CROSS.toLowerCase()],
    retries: 3,
  });

  await performStep(page, {
    stepName: ROAD_CROSS,
    currentTexts: [ROAD_CROSS, ROAD_CROSS.toLowerCase()],
    nextTexts: [SOUTH, SOUTH.toLowerCase()],
    retries: 3,
  });

  await performStep(page, {
    stepName: SOUTH,
    currentTexts: [SOUTH, SOUTH.toLowerCase()],
    nextTexts: [CAMP, CAMP.toLowerCase()],
    retries: 3,
  });

  for (let i = varanHuntFightsToday; i < 2; i++) {
    console.log(`Дейлик (${dayLabel}): бой с вараном ${i + 1}/2`);
    await performStep(page, {
      stepName: `${CAMP} (${i + 1}/2)`,
      currentTexts: [CAMP, CAMP.toLowerCase()],
      retries: 3,
    });

    try {
      await fightLoop(page);
    } catch (e) {
      const waitMinutes = parseCooldownError(e);
      if (waitMinutes !== null) {
        console.log(`Дейлик (${dayLabel}): варан ещё на кулдауне (${waitMinutes} мин, сделано ${i}/2) -> отложу оставшиеся бои до следующего цикла`);
        varanHuntFightsToday = i;
        persistDailyQuestState();
        await clickByTexts(page, ['Назад', 'назад'], 'Назад').catch(() => {});
        return;
      }
      throw e;
    }

    varanHuntFightsToday = i + 1;
    persistDailyQuestState();
  }

  if (await existsAnyText(page, [V_IGRU, V_IGRU.toLowerCase()])) {
    await clickByTexts(page, [V_IGRU, V_IGRU.toLowerCase()], V_IGRU).catch(() => {});
    await pause(page, 800, 1600);
  }
}

async function runWednesdayExtraDaily(page) {
  await runWednesdayMountainSpirit(page);
  await runWednesdayHyenaHunt(page);
  await runBoarHunt(page, 'среда, 3/5');
  await runBisonHunt(page, 'среда, 4/5');
  await runVaranHunt(page, 'среда, 5/5');
  return wednesdayMountainSpiritDoneToday && wednesdayHyenaFightsToday >= 2
    && boarHuntFightsToday >= 2 && bisonHuntFightsToday >= 2 && varanHuntFightsToday >= 2;
}

// Дейлик пятницы: 2 охоты, обе используют маршруты, уже описанные для среды (кабан и варан).
async function runFridayExtraDaily(page) {
  await runBoarHunt(page, 'пятница, 1/2');
  await runVaranHunt(page, 'пятница, 2/2');
  return boarHuntFightsToday >= 2 && varanHuntFightsToday >= 2;
}

// Дейлик воскресенья: 2 охоты (кабан x3, бизон x3), маршруты те же, что и в среду/пятницу,
// отличается только число боёв.
async function runSundayExtraDaily(page) {
  await runBoarHunt(page, 'воскресенье, 1/2', 3);
  await runBisonHunt(page, 'воскресенье, 2/2', 3);
  return boarHuntFightsToday >= 3 && bisonHuntFightsToday >= 3;
}

// Дейлик четверга: 3 охоты в Мисттоуне. Все три начинаются одинаково (Конь -> Мисттоун ->
// ожидание 7с -> Идти в город), дальше расходятся по разным домам/переулкам.
//
// Каждая цель (могильщик/мясник/ведьма) имеет реальный игровой кулдаун на атаку ("Вы слишком
// устали, приходите через N мин"), как и обычные фарм-цели (Блейк/гоблины) -- fightLoop бросает
// Error('fight_target_cooldown:N') при обнаружении этого сообщения (см. fightLoop). Прогресс
// (thursdayGravediggerDoneToday / thursdayButcherFightsToday / thursdayWitchFightsToday)
// сохраняется между циклами, чтобы при кулдауне бот не начинал охоту заново, а просто откладывал
// оставшиеся бои до следующего цикла.
function parseCooldownError(e) {
  const m = /^fight_target_cooldown:(\d+)$/.exec(e.message || '');
  return m ? Number(m[1]) : null;
}

function resetThursdayStateIfNewDay() {
  const key = getDayKeyNow();
  if (thursdayDayKey !== key) {
    thursdayDayKey = key;
    thursdayGravediggerDoneToday = false;
    thursdayButcherFightsToday = 0;
    thursdayWitchFightsToday = 0;
  }
}

// Same per-fight cooldown resume as Thursday, but for Wednesday's mountain-spirit/hyena hunts and
// the boar/bison/varan hunts shared by Wednesday/Friday/Sunday -- these hit the exact same
// "Вы слишком устали" cooldown, so retrying the whole chain from scratch every cycle (the old
// behavior) meant a stuck later step (e.g. boar's 2nd fight on cooldown) made the bot re-fight
// already-finished earlier steps (mountain spirit, hyenas) forever, never actually finishing the day.
function resetHuntStateIfNewDay() {
  const key = getDayKeyNow();
  if (huntStateDayKey !== key) {
    huntStateDayKey = key;
    wednesdayMountainSpiritDoneToday = false;
    wednesdayHyenaFightsToday = 0;
    boarHuntFightsToday = 0;
    bisonHuntFightsToday = 0;
    varanHuntFightsToday = 0;
    harpyHuntFightsToday = 0;
  }
}

async function runThursdayGravedigger(page) {
  resetThursdayStateIfNewDay();
  if (thursdayGravediggerDoneToday) {
    console.log('Дейлик (четверг, 1/3): могильщик уже сделан сегодня, пропускаю');
    return;
  }

  console.log('Дейлик (четверг, 1/3): Могильщик — Конь -> Мисттоун -> Идти в город -> запад -> дом могильщика -> левая дверь -> Вниз -> Атаковать');

  const HORSE     = 'Конь';
  const MISTTOWN  = 'Мисттоун';
  const V_PUTI    = 'В пути';
  const V_PUTI_E  = 'В пути еще';
  const V_PUTI_Y  = 'В пути ещё';
  const GO_CITY   = 'Идти в город';
  const WEST      = 'Запад';
  const GRAVEDIGGER_HOUSE = 'Дом могильщика';
  const LEFT_DOOR = 'Идти в левую дверь';
  const DOWN      = 'Вниз';
  const ATTACK    = 'Атаковать';
  const V_IGRU    = 'В игру';

  await performStep(page, {
    stepName: HORSE,
    currentTexts: [HORSE, HORSE.toLowerCase()],
    nextTexts: [MISTTOWN, MISTTOWN.toLowerCase()],
    retries: 3,
  });

  await performStep(page, {
    stepName: MISTTOWN,
    currentTexts: [MISTTOWN, MISTTOWN.toLowerCase()],
    waitAfterClickMs: 7000,
    nextTexts: [
      V_PUTI, V_PUTI.toLowerCase(),
      V_PUTI_E, V_PUTI_E.toLowerCase(),
      V_PUTI_Y, V_PUTI_Y.toLowerCase(),
      GO_CITY, GO_CITY.toLowerCase(),
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
    nextTexts: [GO_CITY, GO_CITY.toLowerCase()],
    waitForNextMs: 30000,
  });

  await performStep(page, {
    stepName: GO_CITY,
    currentTexts: [GO_CITY, GO_CITY.toLowerCase()],
    nextTexts: [WEST, WEST.toLowerCase()],
    retries: 3,
  });

  await performStep(page, {
    stepName: WEST,
    currentTexts: [WEST, WEST.toLowerCase()],
    nextTexts: [GRAVEDIGGER_HOUSE, GRAVEDIGGER_HOUSE.toLowerCase()],
    retries: 3,
  });

  await performStep(page, {
    stepName: GRAVEDIGGER_HOUSE,
    currentTexts: [GRAVEDIGGER_HOUSE, GRAVEDIGGER_HOUSE.toLowerCase()],
    nextTexts: [LEFT_DOOR, LEFT_DOOR.toLowerCase()],
    retries: 3,
  });

  await performStep(page, {
    stepName: LEFT_DOOR,
    currentTexts: [LEFT_DOOR, LEFT_DOOR.toLowerCase()],
    nextTexts: [DOWN, DOWN.toLowerCase()],
    retries: 3,
  });

  await performStep(page, {
    stepName: DOWN,
    currentTexts: [DOWN, DOWN.toLowerCase()],
    nextTexts: [ATTACK, ATTACK.toLowerCase()],
    retries: 3,
  });

  console.log('Дейлик (четверг, 1/3): бой с могильщиком');
  await performStep(page, {
    stepName: ATTACK,
    currentTexts: [ATTACK, ATTACK.toLowerCase()],
    retries: 3,
  });

  try {
    await fightLoop(page);
  } catch (e) {
    const waitMinutes = parseCooldownError(e);
    if (waitMinutes !== null) {
      console.log(`Дейлик (четверг, 1/3): могильщик ещё на кулдауне (${waitMinutes} мин) -> отложу до следующего цикла`);
      await clickByTexts(page, ['Назад', 'назад'], 'Назад').catch(() => {});
      return;
    }
    throw e;
  }

  thursdayGravediggerDoneToday = true;
  persistDailyQuestState();

  if (await existsAnyText(page, [V_IGRU, V_IGRU.toLowerCase()])) {
    await clickByTexts(page, [V_IGRU, V_IGRU.toLowerCase()], V_IGRU).catch(() => {});
    await pause(page, 800, 1600);
  }
}

async function runThursdayButcher(page) {
  resetThursdayStateIfNewDay();
  if (thursdayButcherFightsToday >= 4) {
    console.log('Дейлик (четверг, 2/3): мясник уже сделан сегодня, пропускаю');
    return;
  }

  console.log('Дейлик (четверг, 2/3): Мясник — Конь -> Мисттоун -> Идти в город -> запад -> дом мясника -> желтая дверь -> Атаковать x4');

  const HORSE     = 'Конь';
  const MISTTOWN  = 'Мисттоун';
  const V_PUTI    = 'В пути';
  const V_PUTI_E  = 'В пути еще';
  const V_PUTI_Y  = 'В пути ещё';
  const GO_CITY   = 'Идти в город';
  const WEST      = 'Запад';
  const BUTCHER_HOUSE = 'Дом мясника';
  const YELLOW_DOOR   = 'Желтую дверь';
  const ATTACK    = 'Атаковать';
  const V_IGRU    = 'В игру';

  await performStep(page, {
    stepName: HORSE,
    currentTexts: [HORSE, HORSE.toLowerCase()],
    nextTexts: [MISTTOWN, MISTTOWN.toLowerCase()],
    retries: 3,
  });

  await performStep(page, {
    stepName: MISTTOWN,
    currentTexts: [MISTTOWN, MISTTOWN.toLowerCase()],
    waitAfterClickMs: 7000,
    nextTexts: [
      V_PUTI, V_PUTI.toLowerCase(),
      V_PUTI_E, V_PUTI_E.toLowerCase(),
      V_PUTI_Y, V_PUTI_Y.toLowerCase(),
      GO_CITY, GO_CITY.toLowerCase(),
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
    nextTexts: [GO_CITY, GO_CITY.toLowerCase()],
    waitForNextMs: 30000,
  });

  await performStep(page, {
    stepName: GO_CITY,
    currentTexts: [GO_CITY, GO_CITY.toLowerCase()],
    nextTexts: [WEST, WEST.toLowerCase()],
    retries: 3,
  });

  await performStep(page, {
    stepName: WEST,
    currentTexts: [WEST, WEST.toLowerCase()],
    nextTexts: [BUTCHER_HOUSE, BUTCHER_HOUSE.toLowerCase()],
    retries: 3,
  });

  await performStep(page, {
    stepName: BUTCHER_HOUSE,
    currentTexts: [BUTCHER_HOUSE, BUTCHER_HOUSE.toLowerCase()],
    nextTexts: [YELLOW_DOOR, YELLOW_DOOR.toLowerCase()],
    retries: 3,
  });

  await performStep(page, {
    stepName: YELLOW_DOOR,
    currentTexts: [YELLOW_DOOR, YELLOW_DOOR.toLowerCase()],
    nextTexts: [ATTACK, ATTACK.toLowerCase()],
    retries: 3,
  });

  for (let i = thursdayButcherFightsToday; i < 4; i++) {
    console.log(`Дейлик (четверг, 2/3): бой с мясником ${i + 1}/4`);
    await performStep(page, {
      stepName: `${ATTACK} (${i + 1}/4)`,
      currentTexts: [ATTACK, ATTACK.toLowerCase()],
      retries: 3,
    });

    try {
      await fightLoop(page);
    } catch (e) {
      const waitMinutes = parseCooldownError(e);
      if (waitMinutes !== null) {
        console.log(`Дейлик (четверг, 2/3): мясник ещё на кулдауне (${waitMinutes} мин, сделано ${i}/4) -> отложу оставшиеся бои до следующего цикла`);
        thursdayButcherFightsToday = i;
        persistDailyQuestState();
        await clickByTexts(page, ['Назад', 'назад'], 'Назад').catch(() => {});
        return;
      }
      throw e;
    }

    thursdayButcherFightsToday = i + 1;
    persistDailyQuestState();
  }

  if (await existsAnyText(page, [V_IGRU, V_IGRU.toLowerCase()])) {
    await clickByTexts(page, [V_IGRU, V_IGRU.toLowerCase()], V_IGRU).catch(() => {});
    await pause(page, 800, 1600);
  }
}

async function runThursdayWitch(page) {
  resetThursdayStateIfNewDay();
  if (thursdayWitchFightsToday >= 4) {
    console.log('Дейлик (четверг, 3/3): ведьма уже сделана сегодня, пропускаю');
    return;
  }

  console.log('Дейлик (четверг, 3/3): Ведьма — Конь -> Мисттоун -> Идти в город -> запад x3 -> переулок -> дом -> комната -> Атаковать x4');

  const HORSE      = 'Конь';
  const MISTTOWN   = 'Мисттоун';
  const V_PUTI     = 'В пути';
  const V_PUTI_E   = 'В пути еще';
  const V_PUTI_Y   = 'В пути ещё';
  const GO_CITY    = 'Идти в город';
  const WEST       = 'Запад';
  const TURN_ALLEY = 'Свернуть в переулок';
  const GO_HOUSE   = 'Идти к дому';
  const ENTER_HOUSE = 'Войти в дом';
  const ENTER_DOOR  = 'Войти в дверь';
  const ENTER_ROOM  = 'Войти в комнату';
  const GO_DEEP     = 'Идти в глубь комнаты';
  const ATTACK      = 'Атаковать';
  const V_IGRU      = 'В игру';

  await performStep(page, {
    stepName: HORSE,
    currentTexts: [HORSE, HORSE.toLowerCase()],
    nextTexts: [MISTTOWN, MISTTOWN.toLowerCase()],
    retries: 3,
  });

  await performStep(page, {
    stepName: MISTTOWN,
    currentTexts: [MISTTOWN, MISTTOWN.toLowerCase()],
    waitAfterClickMs: 7000,
    nextTexts: [
      V_PUTI, V_PUTI.toLowerCase(),
      V_PUTI_E, V_PUTI_E.toLowerCase(),
      V_PUTI_Y, V_PUTI_Y.toLowerCase(),
      GO_CITY, GO_CITY.toLowerCase(),
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
    nextTexts: [GO_CITY, GO_CITY.toLowerCase()],
    waitForNextMs: 30000,
  });

  await performStep(page, {
    stepName: GO_CITY,
    currentTexts: [GO_CITY, GO_CITY.toLowerCase()],
    nextTexts: [WEST, WEST.toLowerCase()],
    retries: 3,
  });

  async function stepMany(text, count) {
    for (let i = 0; i < count; i++) {
      const ok = await tryPerformStepOptional(page, {
        stepName: `${text} (${i + 1}/${count})`,
        currentTexts: [text, text.toLowerCase()],
      });
      if (!ok) break;
    }
  }

  await stepMany(WEST, 3);
  await pause(page, 800, 1600);

  await performStep(page, {
    stepName: TURN_ALLEY,
    currentTexts: [TURN_ALLEY, TURN_ALLEY.toLowerCase()],
    nextTexts: [GO_HOUSE, GO_HOUSE.toLowerCase()],
    retries: 3,
  });

  await performStep(page, {
    stepName: GO_HOUSE,
    currentTexts: [GO_HOUSE, GO_HOUSE.toLowerCase()],
    nextTexts: [ENTER_HOUSE, ENTER_HOUSE.toLowerCase()],
    retries: 3,
  });

  await performStep(page, {
    stepName: ENTER_HOUSE,
    currentTexts: [ENTER_HOUSE, ENTER_HOUSE.toLowerCase()],
    nextTexts: [ENTER_DOOR, ENTER_DOOR.toLowerCase()],
    retries: 3,
  });

  await performStep(page, {
    stepName: ENTER_DOOR,
    currentTexts: [ENTER_DOOR, ENTER_DOOR.toLowerCase()],
    nextTexts: [ENTER_ROOM, ENTER_ROOM.toLowerCase()],
    retries: 3,
  });

  await performStep(page, {
    stepName: ENTER_ROOM,
    currentTexts: [ENTER_ROOM, ENTER_ROOM.toLowerCase()],
    nextTexts: [GO_DEEP, GO_DEEP.toLowerCase()],
    retries: 3,
  });

  await performStep(page, {
    stepName: GO_DEEP,
    currentTexts: [GO_DEEP, GO_DEEP.toLowerCase()],
    nextTexts: [ATTACK, ATTACK.toLowerCase()],
    retries: 3,
  });

  for (let i = thursdayWitchFightsToday; i < 4; i++) {
    console.log(`Дейлик (четверг, 3/3): бой с ведьмой ${i + 1}/4`);
    await performStep(page, {
      stepName: `${ATTACK} (${i + 1}/4)`,
      currentTexts: [ATTACK, ATTACK.toLowerCase()],
      retries: 3,
    });

    try {
      await fightLoop(page);
    } catch (e) {
      const waitMinutes = parseCooldownError(e);
      if (waitMinutes !== null) {
        console.log(`Дейлик (четверг, 3/3): ведьма ещё на кулдауне (${waitMinutes} мин, сделано ${i}/4) -> отложу оставшиеся бои до следующего цикла`);
        thursdayWitchFightsToday = i;
        persistDailyQuestState();
        await clickByTexts(page, ['Назад', 'назад'], 'Назад').catch(() => {});
        return;
      }
      throw e;
    }

    thursdayWitchFightsToday = i + 1;
    persistDailyQuestState();
  }

  if (await existsAnyText(page, [V_IGRU, V_IGRU.toLowerCase()])) {
    await clickByTexts(page, [V_IGRU, V_IGRU.toLowerCase()], V_IGRU).catch(() => {});
    await pause(page, 800, 1600);
  }
}

async function runThursdayExtraDaily(page) {
  resetThursdayStateIfNewDay();
  await runThursdayGravedigger(page);
  await runThursdayButcher(page);
  await runThursdayWitch(page);
  return thursdayGravediggerDoneToday && thursdayButcherFightsToday >= 4 && thursdayWitchFightsToday >= 4;
}

// Registry: day-of-week (Date.getDay(): 0=Вс..6=Сб) -> task function. Add new days here as their
// routes are supplied; days not listed are simply skipped by canRunExtraDailyNow's caller.
const EXTRA_DAILY_TASKS = {
  0: runSundayExtraDaily,       // Воскресенье
  2: runTuesdayHarpyExtraDaily, // Вторник
  3: runWednesdayExtraDaily,    // Среда
  4: runThursdayExtraDaily,     // Четверг
  5: runFridayExtraDaily,       // Пятница
};

// Returns whether today's дейлик is now fully complete. Most days' task functions always finish
// in one run (return undefined -> treated as complete); Thursday's can return false when a
// per-target cooldown left some fights for a later cycle (see runThursdayExtraDaily).
async function runExtraDailyQuest(page) {
  const weekday = new Date().getDay();
  const task = EXTRA_DAILY_TASKS[weekday];
  if (!task) return true;
  const result = await task(page);
  return result !== false;
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
async function castFishingRodAndDetectCatch(page) {
  const FISH_SPOT = 'Рыбачить';
  const CAST = 'Забросить удочку';

  await performStep(page, {
    stepName: FISH_SPOT,
    currentTexts: [FISH_SPOT, FISH_SPOT.toLowerCase()],
    nextTexts: [CAST, CAST.toLowerCase()],
    retries: 3,
  });

  // Если бот был перезапущен посреди уже закинутой (в прошлом запуске) удочки, вместо
  // "Забросить удочку" здесь показывается "Подождем еще N сек, авось клюнет" с кнопкой "Ждать" --
  // дожидаемся результата этого старого заброса, прежде чем продолжать как обычно.
  let afterRodText = await getBodyText(page);
  for (let i = 0; i < 3; i++) {
    const pendingBiteMatch = afterRodText.match(/Подожд[её]м\s+еще\s+(\d+)\s*сек/i);
    if (!pendingBiteMatch) break;
    const waitSec = Number(pendingBiteMatch[1]) || 5;
    console.log(`Рыбалка: старый заброс ещё не завершился, жду ~${waitSec} сек и жму "Ждать" (${i + 1}/3)`);
    await fixedPause(page, (waitSec + 2) * 1000);
    await clickByTexts(page, ['Ждать', 'ждать'], 'Ждать (старый заброс)').catch(() => {});
    await pause(page, 800, 1600);
    afterRodText = await getBodyText(page);
  }

  // Дневной лимит рыбы кончился: после "Рыбачить" игра показывает "Похоже, вы выловили всю рыбу,
  // приходите завтра" вместо кнопки "Забросить удочку". Наш счётчик может ещё показывать <6 (лимит
  // считается на сервере), поэтому выставляем его в лимит, чтобы canRunFishingNow больше не гонял
  // на рыбалку, и выходим чисто — без ошибки и общего бэкоффа "Retry after N min".
  if (/выловили\s+всю\s+рыбу/i.test(afterRodText)) {
    console.log('Рыбалка: на сегодня рыба закончилась ("выловили всю рыбу") -> отмечаю лимит и выхожу');
    syncFishingDayState();
    fishingCatchesToday = FISHING_DAILY_CATCH_LIMIT;
    lastFishingAttemptAt = Date.now();
    persistDailyQuestState();
    await leaveFishingResultToGame(page);
    return false;
  }

  await performStep(page, {
    stepName: CAST,
    currentTexts: [CAST, CAST.toLowerCase()],
    nextTexts: [],
    retries: 3,
    skipIfNextVisible: false,
  });

  // Confirmed real success text: "...Вы с легким усилием вытаскиваете из воды карася! Далее".
  // Match on the "карас" stem anywhere in the result rather than the exact phrasing, since a
  // failed attempt presumably doesn't mention the fish at all.
  const resultText = await getBodyText(page);
  const caught = /карас[а-я]*/i.test(resultText);

  lastFishingAttemptAt = Date.now();

  if (caught) {
    syncFishingDayState();
    fishingCatchesToday += 1;
    persistDailyQuestState();
    console.log(`Рыбалка: поймали карася (${fishingCatchesToday}/${FISHING_DAILY_CATCH_LIMIT} today)`);
  } else {
    console.log('Рыбалка: не повезло в этот раз');
  }

  // The result (catch or miss) is usually a separate confirmation screen with "В игру", but the
  // game sometimes drops us straight back to the location view (no "В игру"). Handle both cleanly.
  await leaveFishingResultToGame(page);

  return caught;
}

// Used between quests: full route there, fish once, return to the city.
// castFishingRodAndDetectCatch already clicks "В игру" at the end, landing back on the main
// location page.
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

  // Мисттаунское событие: проверяем максимально рано и раньше остальных подзадач -- если время
  // уже подошло, окно на вход всего ~20-30 сек и опаздывать нельзя. В остальные циклы это дешёвая
  // проверка (без похода к зазывале, см. needMisttownSecretRefresh) либо подгонка следующего
  // пробуждения цикла под скорое время старта.
  const misttownEventHappened = await runMisttownSecretEventIfDue(page);
  scheduleMisttownSecretWakeupIfSoon();

  // Массовый бой мисттаунского события реально бьёт по HP (50 ударов с несколькими противниками),
  // а `stats` на этот момент — снимок ДО боя. Без обновления farm-логика ниже принимала решение
  // "можно драться" по старому полному HP, хотя после события реальный HP мог упасть до опасного
  // уровня (баг: ушли на Блейка с ~420 HP сразу после события).
  if (misttownEventHappened) {
    read = await goToLocationAndReadStats(page, 'stats after misttown event');
    if (read.attackHandled) {
      return;
    }
    stats = read.stats;
    lastCycleStats = stats;
  }

  // Резерв -- это пропуск в событие: без него игра не пускает ни вниз, ни в бой. В ночь на
  // 22.09.2026 цикл начался за 3 мин 9 сек до "земли", то есть окно пре-позиции (3 мин) ещё не
  // наступило на 9 секунд -- и бот пошёл делать обычные дела: школа/казарма/храм (3 боя), лось,
  // демон. За две минуты резерв ушёл с 30 до -3, и к спуску игра ответила "Вы слишком устали" --
  // боя не было. Поэтому в преддверии события не начинаем НИЧЕГО: спим ровно до пре-позиции и
  // копим резерв.
  const misttownSoonTheme = misttownSecretDueWithinMs(MISTTOWN_PREP_GUARD_MS);
  if (misttownSoonTheme) {
    const dueAt = misttownSecretDueAt[misttownSoonTheme];
    const wakeAt = dueAt - MISTTOWN_SECRET_PRE_POSITION_MS;
    const waitMs = Math.max(30 * 1000, wakeAt - Date.now());
    nextCycleDelayOverrideMs = waitMs;
    console.log(`Мисттаунское событие (${misttownSoonTheme}) в ${new Date(dueAt).toLocaleString()}: до него ничего не начинаю, коплю резерв (сейчас ${stats.reserveMinutes ?? stats.cooldown}); просыпаюсь через ${Math.round(waitMs / 1000)} сек.`);
    return;
  }

  // Фарм стрелы (после выстрела в мисттаунском событии): не срочный, просто ждём, пока условия
  // позволят (>=10 резервных минут, >2000 HP).
  await maybeFarmArrow(page, stats);

  // Утренний скриншот: раз в день, максимально рано (первый же цикл после смены дня) —
  // выполняется раньше остальных подзадач, чтобы не зависеть от их таймингов.
  if (canRunMorningScreenshotNow()) {
    console.log('Утренний скриншот: ещё не отправлен сегодня, выполняю маршрут');
    try {
      const done = await runMorningScreenshotTask(page);
      if (done) {
        morningScreenshotDoneToday = true;
        persistDailyQuestState();
      }
    } catch (e) {
      if (isScenarioPausedError(e)) throw e;
      console.log(`Утренний скриншот: не удалось (${e.message}) -> попробую в следующем цикле`);
      try {
        await page.goto('http://lbast.ru/location.php', { waitUntil: 'domcontentloaded', timeout: 60000 });
        await pause(page, 800, 1600);
      } catch (e2) { /* ignore */ }
    }
  }

  // Water the vineyard: when "Виноград" task marker is visible OR the 8-hour interval has elapsed.
  const vinogradDue = Date.now() - lastVinogradRunAt >= VINOGRAD_INTERVAL_MS;
  if (/Виноград/i.test(read.text || '') || vinogradDue) {
    console.log(`Виноград: ${vinogradDue ? 'прошло 8 часов' : 'обнаружено задание'}, выполняю маршрут`);
    await runVinogradTask(page);
    lastVinogradRunAt = Date.now();
    persistDailyQuestState();
  }

  // Довольствие: раз в день, простой маршрут без боя.
  if (canRunAllowanceNow()) {
    console.log('Довольствие: ещё не получено сегодня, выполняю маршрут');
    await runAllowanceTask(page);
    allowanceDoneToday = true;
    persistDailyQuestState();
  }

  // Охота на лосей: раз в день. Бота на месте может не быть (кто-то уже убил сегодня) —
  // runElkHuntTask сама решает, что делать в этом случае; в обоих исходах день считается пройденным.
  if (canRunElkHuntNow()) {
    console.log('Охота на лосей: ещё не пробовал сегодня, иду проверять');
    await runElkHuntTask(page);
    elkHuntDoneToday = true;
    persistDailyQuestState();
  }

  // Охота на демона: раз в день, личный квест (не общий на сервер "бот", как лоси).
  if (canRunDemonHuntNow()) {
    console.log('Охота на демона: ещё не выполнена сегодня, иду выполнять');
    await runDemonHuntTask(page);
    demonHuntDoneToday = true;
    persistDailyQuestState();
  }

  // Квест (школа/казарма/храм): раз в день, требует >=20 резервных минут (3 боя подряд). Попытка
  // считается использованной независимо от исхода -- см. runSchoolTempleQuest и
  // canRunSchoolTempleQuestNow.
  if (canRunSchoolTempleQuestNow()) {
    const schoolReserveMinutes = typeof stats?.reserveMinutes === 'number' ? stats.reserveMinutes : stats?.cooldown;
    if (typeof schoolReserveMinutes !== 'number' || schoolReserveMinutes < 20) {
      console.log(`Квест (школа/казарма/храм): пропускаю сегодня (нужно >=20 резервных минут, есть=${schoolReserveMinutes ?? 'n/a'})`);
    } else {
      console.log('Квест (школа/казарма/храм): ещё не выполнен сегодня, иду выполнять');
      await runSchoolTempleQuest(page);
      schoolTempleDoneToday = true;
      persistDailyQuestState();
    }
  }

  // Дейлик (доп. задание дня, меняется по дням недели): раз в день, только для дней,
  // у которых уже есть маршрут в EXTRA_DAILY_TASKS. Остальные дни просто пропускаются.
  if (canRunExtraDailyNow() && EXTRA_DAILY_TASKS[new Date().getDay()]) {
    console.log('Дейлик: ещё не выполнен сегодня, выполняю маршрут');
    const extraDailyFullyDone = await runExtraDailyQuest(page);
    if (extraDailyFullyDone) {
      extraDailyDoneToday = true;
    }
    persistDailyQuestState();
  }

  // Статуя славы: раз в 12-14 часов. Если не удалось — не роняем весь цикл в общий бэкофф
  // "Retry after N min", а логируем, планируем следующую попытку и продолжаем цикл дальше.
  if (isStatueOfGloryDue()) {
    console.log('Статуя славы: подошёл интервал 12-14 часов, выполняю маршрут');
    try {
      await runStatueOfGloryTask(page);
    } catch (e) {
      if (isScenarioPausedError(e)) throw e;
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
      const reserveLow = typeof reserveMinutes === 'number' && reserveMinutes < SHTOLNI_MIN_RESERVE_MINUTES;
      const hpLow = typeof hpCurrent === 'number' && hpCurrent >= 0 && hpCurrent < SHTOLNI_MIN_HP;

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
      const reserveLow = typeof reserveMinutes === 'number' && reserveMinutes < SHTOLNI_MIN_RESERVE_MINUTES;
      const hpLow = typeof hpCurrent === 'number' && hpCurrent >= 0 && hpCurrent < SHTOLNI_MIN_HP;

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
    console.log(`Прощальный заброс на материке перед переездом на ${FARM_LABEL}`);
    await runFishingTask(page);
  }

  let didAnyFarmFight = false;
  while (shouldFightFarmByStats(stats)) {
    // Пауза между боями, а не посреди боя: начатый бой доигрывается, новый не начинается.
    throwIfPausedByManager('фарм: перед следующим боем');
    console.log('can fight -> start fight');

    try {
      await ensureFarmFightScreen(page);
      await fightLoop(page);
      didAnyFarmFight = true;
    } catch (e) {
      if (isScenarioPausedError(e)) throw e;
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
    // A depleted cooldown alone is not a reason to travel back for Blake (avoids paying the boat fee
    // twice); for goblins, maybeRestGoblinAtStoneguard sends the character to rest instead.
    const restedGoblins = await maybeRestGoblinAtStoneguard(page, stats);
    console.log(restedGoblins
      ? 'no condition matched -> resting at Стоунгард, stop cycle'
      : 'no condition matched -> stay at farm location, stop cycle');
    scheduleFarmNextCycle(stats, didAnyFarmFight);
    return;
  }

  await maybeRestGoblinAtStoneguard(page, stats);
  console.log('nothing to do this cycle');
  scheduleFarmNextCycle(stats, didAnyFarmFight);
}

// Чистый таймер, НЕ завязанный на page -- в отличие от fixedPause/pause (page.waitForTimeout),
// не бросает исключение, если браузер/страница к этому моменту уже закрылись. Все ожидания-бэкоффы
// (между попытками запуска/навигации/циклами) должны использовать именно это, а не page-версии --
// иначе браузер, закрывшийся сам по себе во время долгого ожидания (краш, ручное закрытие окна,
// авто-перерыв менеджера), роняет необработанным исключением весь процесс (см. isClosedTargetError
// ниже и историю в памяти already-done-today-message/incoming-attack-recovery).
function sleepPlain(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Пауза от менеджера (кнопка "Пауза" в Telegram). Процесс и браузер при этом живут, но сценарий
// не делает НИЧЕГО и не трогает страницу: в том же окне в это время играет сам пользователь, и
// любая наша навигация сбила бы ему экран.
const PAUSE_FLAG_PATH = path.join(__dirname, 'pause.flag');

function isPausedByManager() {
  try {
    return fs.existsSync(PAUSE_FLAG_PATH);
  } catch (e) {
    return false;
  }
}

// Пауза может прийти в ЛЮБОЙ момент, а один цикл живёт минутами -- восстановление в Последнем
// доме и вовсе часами. Проверки только в начале цикла не хватило: 24.09.2026 Паша нажал паузу, а
// сценарий продолжал жарить рыбу на кухне. Поэтому в длинных местах цикла стоят кооперативные
// проверки: бросаем помеченную ошибку, она проходит НАСКВОЗЬ через безопасные обёртки
// (runQuestStepSafe/runNonQQuestSafe её не глотают и не запускают recoverToCity) и гасится в
// главном цикле без единого клика -- страница остаётся ровно там, где её застала пауза.
function throwIfPausedByManager(where) {
  if (!isPausedByManager()) return;
  const e = new Error(`paused:${where}`);
  e.scenarioPaused = true;
  throw e;
}

function isScenarioPausedError(e) {
  return Boolean(e && e.scenarioPaused);
}

function isClosedTargetError(e) {
  return /has been closed|target closed/i.test(String(e?.message || ''));
}

async function launchBrowserAndPage() {
  const userDataDir = path.join(__dirname, 'chrome-profile');

  let context;
  while (true) {
    try {
      context = await chromium.launchPersistentContext(userDataDir, {
        headless: false,
        viewport: null,
        slowMo: 50,
      });
      break;
    } catch (e) {
      // A transient launch failure (network hiccup, leftover profile lock, OS killing the
      // browser right after start) must not crash the whole process — without this retry an
      // uncaught rejection here kills node and nothing farms until someone restarts it manually.
      console.log('Browser launch failed:', e.message);
      console.log('Retry launch in 1 min.');
      await sleepPlain(60 * 1000);
    }
  }

  let page = context.pages()[0];
  if (!page) {
    page = await context.newPage();
  }

  while (true) {
    try {
      await page.goto('http://lbast.ru/location.php', {
        waitUntil: 'domcontentloaded',
        timeout: 60000,
      });
      break;
    } catch (e) {
      console.log('Initial goto failed:', e.message);
      const waitMs = isNetworkError(e) ? 60 * 1000 : 5 * 60 * 1000;
      console.log('Retry in ' + Math.round(waitMs / 60000) + ' min.');
      await sleepPlain(waitMs);
    }
  }

  return { context, page };
}

async function returnToLocationPage(page) {
  await page.goto('http://lbast.ru/location.php', {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  await pause(page, 1000, 2000);
}

(async () => {
  let { context, page } = await launchBrowserAndPage();

  if (FARM_START_AFTER_MS && Date.now() < FARM_START_AFTER_MS) {
    console.log(`Ночное ожидание: квесты/фарм начнутся в ${new Date(FARM_START_AFTER_MS).toLocaleString()}, до этого только слежу за мисттаунским событием`);

    while (Date.now() < FARM_START_AFTER_MS) {
      try {
        if (isPausedByManager()) {
          await sleepPlain(20 * 1000);
          continue;
        }

        // Окно браузера выводим вперёд, только когда событие близко и нам вот-вот придётся
        // кликать. Раньше оно выпрыгивало поверх всего на каждом пульсе, то есть каждые 15-20
        // минут, хотя до ближайшего события могли быть сутки.
        const untilPreNow = msUntilNextMisttownPrePosition();
        if (untilPreNow !== null && untilPreNow <= NIGHT_WAIT_ACTIVE_WINDOW_MS) {
          await page.bringToFront().catch(() => {});
        }

        await runMisttownSecretEventIfDue(page);
        scheduleMisttownSecretWakeupIfSoon();

        const remainingMs = FARM_START_AFTER_MS - Date.now();
        if (remainingMs <= 0) break;

        // Спим одним куском до ближайшего будильника (пре-позиция события либо поход к зазывале
        // за новым расписанием), но не дольше, чем до старта обычного сценария. Промежуточных
        // пробуждений нет: страницу в это время трогать незачем.
        const nextAlarmMs = nightWaitSleepMs();
        const waitMs = Math.min(nextCycleDelayOverrideMs ?? nextAlarmMs ?? remainingMs, remainingMs);
        nextCycleDelayOverrideMs = null;

        const untilPre = msUntilNextMisttownPrePosition();
        const untilStale = msUntilMisttownScheduleStale();
        const hours = (ms) => (ms / 3600000).toFixed(1);
        const why = [
          untilPre === null ? 'событий в расписании нет' : `до события ${hours(untilPre)} ч`,
          untilStale === null ? null : `до обновления расписания ${hours(untilStale)} ч`,
        ].filter(Boolean).join('; ');
        console.log(`Ночное ожидание: сплю ${Math.round(waitMs / 60000)} мин, страницу не трогаю (${why}; до старта обычного сценария ${Math.round(remainingMs / 60000)} мин)`);
        await sleepPlain(waitMs);

        if (Date.now() >= FARM_START_AFTER_MS) break;

        const read = await goToLocationAndReadStats(page, 'ночное ожидание stats');
        if (read.attackHandled) {
          console.log('Ночное ожидание: отбились от атаки, продолжаю ждать.');
        }
      } catch (e) {
        if (isClosedTargetError(e)) {
          console.log('Ночное ожидание: браузер закрылся сам по себе -- перезапускаю:', e.message);
          try { await context.close(); } catch (e2) { /* ignore */ }
          ({ context, page } = await launchBrowserAndPage());
          continue;
        }
        if (isScenarioPausedError(e)) {
          console.log('Ночное ожидание: пауза -- страницу не трогаю, жду "Продолжить".');
          continue;
        }
        console.log('Ночное ожидание: ошибка цикла:', e.message);
        await sleepPlain(60 * 1000);
      }
    }

    console.log('Ночное ожидание: время пришло, перехожу к обычному сценарию.');
  }

  console.log('Browser opened. Start loop.');

  let pauseNoticed = false;

  while (true) {
    try {
      if (isPausedByManager()) {
        if (!pauseNoticed) {
          console.log('Пауза (кнопка в Telegram): встал, страницу не трогаю -- браузер в вашем распоряжении. Жду "Продолжить".');
          pauseNoticed = true;
        }
        await sleepPlain(20 * 1000);
        continue;
      }
      if (pauseNoticed) {
        console.log('Пауза снята -> продолжаю сценарий.');
        pauseNoticed = false;
      }

      console.log('==============================');
      console.log('New cycle:', new Date().toLocaleString());

      await page.bringToFront();
      await pause(page, 1000, 2000);

      await handleUnreadMailIfAny(page);

      await saveSnapshot(page, 'before_cycle');
      await doScenario(page);
      await saveSnapshot(page, 'after_cycle');

      await handleUnreadMailIfAny(page);

      const delayMs = nextCycleDelayOverrideMs ?? getRandomCycleDelayMs();
      nextCycleDelayOverrideMs = null;
      const delayMinutes = Math.round(delayMs / 60000);
      console.log('Cycle done. Sleep ' + delayMinutes + ' min.');
      await sleepPlain(delayMs);

      await returnToLocationPage(page);
    } catch (e) {
      // Браузер/страница закрылись сами по себе (краш Chrome, ручное закрытие окна пользователем,
      // авто-перерыв менеджера и т.п.) -- раньше это било необработанным исключением из fixedPause/
      // page.goto прямо в этом месте и убивало весь процесс до следующего ручного перезапуска.
      // Вместо этого просто поднимаем браузер заново и продолжаем цикл.
      if (isClosedTargetError(e)) {
        console.log('Браузер/страница закрылись сами по себе -- перезапускаю браузер:', e.message);
        try {
          await context.close();
        } catch (e2) { /* ignore */ }
        ({ context, page } = await launchBrowserAndPage());
        continue;
      }

      // Пауза посреди цикла: НИЧЕГО не делаем -- ни снимка, ни recoverToCity, ни возврата на
      // location.php. Любая из этих операций увела бы страницу из-под пользователя, ради которого
      // паузу и нажали. Просто уходим на начало цикла, где стоит ожидание "Продолжить".
      if (isScenarioPausedError(e)) {
        console.log(`Пауза: прервал цикл (${e.message}), страницу не трогаю.`);
        continue;
      }

      console.log('Cycle error:', e.message);
      try {
        await saveSnapshot(page, 'cycle_error');
      } catch (e2) { /* page может быть недоступна -- не мешаем восстановлению ниже */ }

      if (String(e?.message || '').startsWith('ui_stuck:')) {
        try {
          await recoverToCity(page, e.message);
        } catch (e2) {
          // ignore
        }
        // Retry soon after recovery.
        scheduleLongRestMinutes(2, 'ui_stuck_recovery');
      }

      const delayMs = nextCycleDelayOverrideMs ?? (isNetworkError(e) ? 60 * 1000 : getRandomCycleDelayMs());
      nextCycleDelayOverrideMs = null;
      const delayMinutes = Math.round(delayMs / 60000);
      console.log('Retry after ' + delayMinutes + ' min.');
      await sleepPlain(delayMs);

      try {
        await returnToLocationPage(page);
      } catch (e2) {
        if (isClosedTargetError(e2)) {
          console.log('Браузер/страница закрылись во время ожидания повтора -- перезапускаю браузер:', e2.message);
          try {
            await context.close();
          } catch (e3) { /* ignore */ }
          ({ context, page } = await launchBrowserAndPage());
        } else {
          console.log('Could not open location.php, retry later.');
        }
      }
    }
  }
})();
