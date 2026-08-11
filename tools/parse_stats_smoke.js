/* Smoke checks for stat parsing edge cases.
 *
 * Run: node tools/parse_stats_smoke.js
 *
 * This is intentionally standalone (no requires of bot scripts) to avoid
 * accidentally launching Playwright flows during CI/local checks.
 */

function parseStatsLikeDailyQuests(text) {
  const normalized = String(text || '')
    .replace(/\u00A0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const qMatch = normalized.match(/\bQ\s*(\d+)\b/i);
  const dMatch = normalized.match(/\bD\s*(\d+)\b/i);
  const questsAvailable = qMatch ? Number(qMatch[1]) : null;
  const dailyAvailable = dMatch ? Number(dMatch[1]) : null;

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
    const plausible = candidates
      .filter((c) => c.hpMax > 0 && c.hpCurrent >= 0 && c.hpCurrent <= c.hpMax)
      .sort((a, b) => b.hpCurrent - a.hpCurrent);

    const chosen = plausible[0] || candidates[0];
    return {
      hpCurrent: chosen.hpCurrent,
      hpMax: chosen.hpMax,
      cooldown: chosen.cooldown,
      reserveMinutes: chosen.cooldown,
      questsAvailable,
      dailyAvailable,
    };
  }

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
    const plausible = hpCandidates
      .filter((c) => c.hpCurrent >= 0 && c.hpCurrent <= c.hpMax)
      .sort((a, b) => b.hpCurrent - a.hpCurrent);
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
  if (!base) return extra || base;
  if (!extra) {
    const fallbackReserve = typeof base.cooldown === 'number' ? base.cooldown : base.reserveMinutes;
    return {
      ...base,
      reserveMinutes: typeof base.reserveMinutes === 'number' ? base.reserveMinutes : fallbackReserve ?? null,
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

function assert(cond, msg) {
  if (!cond) {
    throw new Error(msg);
  }
}

function run() {
  const locationWithoutCooldown =
    '06:26:41, Вс. Обновить - Письма - Инв - Поиск Tsunami (2870/2870) Q9 D7 Виноград: 5 ч. Форпост "Кулак Хаоса"';
  const persWithCooldown =
    '01:22:27, Чт. Tsunami (-216/2880) (-6) В игру Обновить - Дневник - Доступные квесты';
  const persWithCooldownPositive =
    '15:30:50, Сб. Tsunami (2720/2720) (29) D0 Стоунгард';

  const a = parseStatsLikeDailyQuests(locationWithoutCooldown);
  assert(a.hpCurrent === 2870 && a.hpMax === 2870, 'location: expected HP parsed');
  assert(a.cooldown === null, 'location: expected cooldown missing');
  assert(a.questsAvailable === 9 && a.dailyAvailable === 7, 'location: expected Q/D parsed');

  const b = parseStatsLikeDailyQuests(persWithCooldown);
  assert(b.hpCurrent === -216 && b.hpMax === 2880, 'pers: expected negative HP parsed');
  assert(b.cooldown === -6, 'pers: expected cooldown parsed');

  const c = parseStatsLikeDailyQuests(persWithCooldownPositive);
  assert(c.hpCurrent === 2720 && c.hpMax === 2720, 'pers2: expected HP parsed');
  assert(c.cooldown === 29, 'pers2: expected cooldown parsed');

  const merged = mergeStatsPreferExisting(a, b);
  assert(merged.hpCurrent === 2870 && merged.hpMax === 2870, 'merge: keep location HP');
  assert(merged.cooldown === -6, 'merge: fill cooldown from pers');
  assert(merged.reserveMinutes === -6, 'merge: reserveMinutes fallback to cooldown');
  assert(merged.questsAvailable === 9 && merged.dailyAvailable === 7, 'merge: keep Q/D');

  console.log('OK: parseStats smoke checks passed');
}

run();

