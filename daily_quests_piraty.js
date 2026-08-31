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
let fisherFoodDayKey = '';
let fisherFoodDoneToday = false;
let caravanRobberyDayKey = '';
let caravanRobberyDoneToday = false;

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

  if (typeof s.fishingDayKey === 'string') fishingDayKey = s.fishingDayKey;
  if (Number.isFinite(s.fishingCatchesToday)) fishingCatchesToday = s.fishingCatchesToday;
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
    fishingDayKey, fishingCatchesToday,
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
  const afterRodText = await getBodyText(page);
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

(async () => {
  const userDataDir = path.join(__dirname, 'chrome-profile');

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    viewport: null,
    slowMo: 50,
  });

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
      await fixedPause(page, waitMs);
    }
  }

  console.log('Browser opened. Start loop.');

  while (true) {
    try {
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
      await fixedPause(page, delayMs);
    } catch (e) {
      console.log('Cycle error:', e.message);
      await saveSnapshot(page, 'cycle_error');

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
      await fixedPause(page, delayMs);
    }

    try {
      await page.goto('http://lbast.ru/location.php', {
        waitUntil: 'domcontentloaded',
        timeout: 60000,
      });
    } catch (e) {
      console.log('Could not open location.php, retry later.');
    }

    await pause(page, 1000, 2000);
  }
})();
