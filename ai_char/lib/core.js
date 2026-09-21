// Базовые помощники: паузы, getBodyText, parseStats, планирование следующего цикла, debug-снимки.
// Выделено из ai_char/module.js (там только сборка экспорта). Изменяемое состояние - S из ./state.

// Экспорт стоит ДО require: файлы lib/ вызывают друг друга по кругу, а объявления функций
// всплывают (hoisting), поэтому к моменту любого встречного require все функции уже здесь.
module.exports = {
  snapshotText, appendDebugSnapshot, randomInt, pause, fixedPause, getRandomCycleDelayMs,
  isNetworkError, setNextCycleDelayOverrideMinutes, canRunAnyNonQQuestNow,
  checkExclusiveQuestTimeouts, isExclusiveQQuestInProgress, scheduleQuestFollowup,
  scheduleFarmNextCycle, saveSnapshot, getBodyText, parseStats, mergeStatsPreferExisting,
};

const path = require('path');
const fs = require('fs');
const {
  S, DEBUG_SNAPSHOTS_PATH, EXCLUSIVE_QUEST_MAX_ACTIVE_MS, EXCLUSIVE_QUEST_TIMEOUT_BACKOFF_MS,
  PAUSE_SPEED_FACTOR,
} = require('./state');
const { canRunFishEyeFightNow, canRunFishEyeRewardNow } = require('./daily_quests');
const { scheduleLongRestMinutes } = require('./recovery');

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
  S.nextCycleDelayOverrideMs = minutes * 60 * 1000;
  return S.nextCycleDelayOverrideMs;
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

  if (S.tavernTakenToday && !S.tavernDoneToday && S.tavernFocusStartedAt && now - S.tavernFocusStartedAt > EXCLUSIVE_QUEST_MAX_ACTIVE_MS) {
    S.tavernTakenToday = false;
    S.tavernSuppressedUntil = now + EXCLUSIVE_QUEST_TIMEOUT_BACKOFF_MS;
    S.tavernFocusStartedAt = 0;
    S.tavernFailStreak = 0;
    console.log('Tavern quest: focus timeout (30 min) -> release and continue other actions');
  }

  if (S.shtolniTakenToday && !S.shtolniDoneToday && S.shtolniFocusStartedAt && now - S.shtolniFocusStartedAt > EXCLUSIVE_QUEST_MAX_ACTIVE_MS) {
    S.shtolniTakenToday = false;
    S.shtolniSuppressedUntil = now + EXCLUSIVE_QUEST_TIMEOUT_BACKOFF_MS;
    S.shtolniFocusStartedAt = 0;
    S.shtolniFailStreak = 0;
    S.shtolniNoProgressStreak = 0;
    S.shtolniLastStage = '';
    console.log('Shtolni quest: focus timeout (30 min) -> release and continue other actions');
  }

  if (S.fishRestaurantFocusStartedAt && now - S.fishRestaurantFocusStartedAt > EXCLUSIVE_QUEST_MAX_ACTIVE_MS) {
    S.fishRestaurantFocusStartedAt = 0;
    S.fishRestaurantSuppressedUntil = now + EXCLUSIVE_QUEST_TIMEOUT_BACKOFF_MS;
    console.log('Fish Restaurant: focus timeout (30 min) -> release and continue other actions');
  }
}

function isExclusiveQQuestInProgress() {
  checkExclusiveQuestTimeouts();
  const now = Date.now();
  const tavernActive = S.tavernTakenToday && !S.tavernDoneToday && now >= S.tavernSuppressedUntil;
  const shtolniActive = S.shtolniTakenToday && !S.shtolniDoneToday && now >= S.shtolniSuppressedUntil;
  const fishRestaurantActive = Boolean(S.fishRestaurantFocusStartedAt)
    && !S.fishRestaurantDoneToday
    && now >= S.fishRestaurantSuppressedUntil;
  return tavernActive || shtolniActive || fishRestaurantActive;
}

function scheduleQuestFollowup(reason) {
  // When we successfully do at least one quest, poll sooner than the default 14-21 min
  // to keep progressing other quests/cooldowns without wasting reserves.
  if (S.nextCycleDelayOverrideMs !== null) {
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
