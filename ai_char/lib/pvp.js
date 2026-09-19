// PvP: детект нападений, скриншоты, оповещения, бой с нападающим.
// Выделено из ai_char/module.js (там только сборка экспорта). Изменяемое состояние - S из ./state.

// Экспорт стоит ДО require: файлы lib/ вызывают друг друга по кругу, а объявления функций
// всплывают (hoisting), поэтому к моменту любого встречного require все функции уже здесь.
module.exports = {
  detectPvpFromText, notifyIfPvpDetected, detectIncomingAttack, getFightOpponentName,
  emitAttackAlert, isBattleScreenText, safeFilenamePart, formatTimestampForFilename,
  takeAttackScreenshot, emitAttackAlertWithScreenshot, randInt, clickRandomActionByRegex,
  runIncomingAttackPvpLoop, handleIncomingAttackIfAny,
};

const path = require('path');
const fs = require('fs');
const {
  S, ENABLE_PVP_ALERTS, FARM_LABEL, LAST_HOUSE_HP_THRESHOLD, SELF_NICK, SELF_NICK_RE,
} = require('./state');
const { fixedPause, getBodyText, pause } = require('./core');
const { fightLoop } = require('./fight');
const { questFightHpGate } = require('./hp');
const { emitPvpAlert } = require('./mail');
const { goToChaosByAmulet, runLastHouseRecovery, scheduleLongRestMinutes } = require('./recovery');
const { shouldGoChaosByStats, shouldGoLastHouseByStats } = require('./stats_decisions');
const { clickByTexts } = require('./ui');

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

const ATTACK_SCREENSHOT_DIR = path.join(__dirname, '..', 'logs');

// S.lastAttackClickAt: объявлено в lib/state.js (всё изменяемое состояние - там).

// S.attackAlertCooldownUntil: объявлено в lib/state.js (всё изменяемое состояние - там).

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
  if (now < S.attackAlertCooldownUntil) return;

  const screenshotPath = await takeAttackScreenshot(page, attackerNick);

  emitAttackAlert({
    attackerNick,
    screenshotPath,
    occurredAt: new Date().toISOString(),
    fragment: String(text || '').slice(0, 1200),
    firstLogPage: String(text || '').slice(0, 2000),
    ...meta,
  });

  S.attackAlertCooldownUntil = now + 60 * 1000;
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
  if (now - S.lastAttackClickAt < 1500) return false;

  const clicked = await clickByTexts(page, ATTACK_BUTTON_TEXTS, 'Incoming attack');
  if (!clicked) return false;

  S.lastAttackClickAt = Date.now();
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
