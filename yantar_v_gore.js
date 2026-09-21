// Scenario: Amber Mountain

const { chromium } = require('playwright');
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

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

let lastHandledMailSignature = '';
const ENABLE_PVP_ALERTS = true;
const SELF_NICK = 'tsunami';
const SELF_NICK_RE = new RegExp(`\\b${SELF_NICK}\\b`, 'i');
const PAUSE_SPEED_FACTOR = 0.5;
let nextCycleDelayOverrideMs = null;

// UI stuck detection: bail out if we keep failing to find/click the same step for too long.
const UI_STUCK_MAX_FAILS = 15;
const UI_STUCK_MAX_MS = 60 * 1000;
let uiStuckState = { stepName: '', count: 0, firstAt: 0 };

const LOW_HP_FASTWAY_URL = 'http://lbast.ru/location.php?r=3018&mod=fastway&lway=4';

function scheduleLongRestMinutes(minutes, reason) {
  nextCycleDelayOverrideMs = minutes * 60 * 1000;
  console.log(`Long rest scheduled: ${minutes} min (${reason})`);
}

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

function isNetworkError(e) {
  const msg = String(e?.message || '');
  return /ERR_NAME_NOT_RESOLVED|ERR_INTERNET_DISCONNECTED|ERR_CONNECTION_(REFUSED|RESET|CLOSED|TIMED_OUT)|ERR_NETWORK_CHANGED|ERR_ADDRESS_UNREACHABLE|net::ERR_/.test(msg);
}

function getRandomCycleDelayMs() {
  const minutes = randomInt(10, 14);
  return minutes * 60 * 1000;
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

  const patterns = [
    /\(([-]?\d+)\s*\/\s*(\d+)\)\s*\([^)]+\)\s*\(([-]?\d+)\)/,
    /\(([-]?\d+)\s*\/\s*(\d+)\)\s*\(([-]?\d+)\)/,
    /([-]?\d+)\s*\/\s*(\d+)[\s\S]{0,50}?\(([-]?\d+)\)/,
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (match) {
      return {
        hpCurrent: Number(match[1]),
        hpMax: Number(match[2]),
        cooldown: Number(match[3]),
      };
    }
  }

  const hpOnlyMatch =
    normalized.match(/\(([-]?\d+)\s*\/\s*(\d+)\)/) ||
    normalized.match(/\b([-]?\d+)\s*\/\s*(\d+)\b/);

  if (hpOnlyMatch) {
    const hpCurrent = Number(hpOnlyMatch[1]);
    const hpMax = Number(hpOnlyMatch[2]);
    if (Number.isFinite(hpCurrent) && Number.isFinite(hpMax)) {
      return { hpCurrent, hpMax, cooldown: null };
    }
  }

  return {
    hpCurrent: null,
    hpMax: null,
    cooldown: null,
  };
}

function mergeStatsPreferExisting(base, extra) {
  if (!base) return extra || base;
  if (!extra) return base;
  return {
    hpCurrent: base.hpCurrent ?? extra.hpCurrent ?? null,
    hpMax: base.hpMax ?? extra.hpMax ?? null,
    cooldown: base.cooldown ?? extra.cooldown ?? null,
  };
}

function containsInsensitive(text, needle) {
  if (!text || !needle) {
    return false;
  }
  return String(text).toLowerCase().includes(String(needle).toLowerCase());
}

function isAmberMountain(text) {
  return containsInsensitive(text, 'Янтарная гора') ||
    containsInsensitive(text, 'Янтарная') ||
    containsInsensitive(text, 'К горе');
}

function shouldGoChaosByStats(stats) {
  return stats.hpCurrent < 0;
}

function shouldRecoverByStoneguard(stats) {
  return stats.cooldown <= 0;
}

function shouldRecoverByStoneguardLowHp(stats) {
  return stats.hpCurrent >= 0 && stats.hpCurrent < 1000 && stats.cooldown < 20;
}

function shouldRecoverByStats(stats) {
  return shouldRecoverByStoneguard(stats) || shouldRecoverByStoneguardLowHp(stats);
}

function shouldUseFishByStats(stats) {
  return stats.cooldown >= 15 && stats.hpCurrent >= 0 && stats.hpCurrent < 1000;
}

function shouldFightByStats(stats) {
  return stats.hpCurrent != null && stats.cooldown != null && stats.hpCurrent >= 1800 && stats.cooldown >= 8;
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

async function handleIncomingAttackIfAny(page, bodyText = null) {
  const text = bodyText || await getBodyText(page);
  if (isBattleScreenText(text)) return false;

  if (!/В\s*бой/i.test(text)) return false;

  const now = Date.now();
  if (now - lastAttackClickAt < 1500) return false;

  const clicked = await clickByTexts(page, ATTACK_BUTTON_TEXTS, 'Incoming attack');
  if (!clicked) return false;

  lastAttackClickAt = Date.now();
  await pause(page, 700, 1400);

  const afterText = await getBodyText(page);
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

  return true;
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

function buildSelectorsForText(text) {
  return [
    `a:has-text("${text}")`,
    `button:has-text("${text}")`,
    `input[value="${text}"]`,
  ];
}

async function existsAnyText(page, texts) {
  for (const text of texts) {
    const selectors = buildSelectorsForText(text);
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
          // Avoid Playwright waiting for navigation on every click; the game often updates via redirects.
          await locator.click({ timeout: 5000, noWaitAfter: true });
          await page.waitForLoadState('domcontentloaded', { timeout: 8000 }).catch(() => {});
          console.log(`OK: ${stepName} -> ${text}`);
          uiStuckState = { stepName: '', count: 0, firstAt: 0 };
          return true;
        } catch (e) {
          console.log(`Не смог кликнуть ${stepName} -> ${text}: ${e.message}`);
        }
      }
    }
  }

  // Debug helper for frequently changing boat button text.
  if (/лодк|башмак/i.test(stepName)) {
    const body = await getBodyText(page).catch(() => '');
    const lines = String(body || '').split('\n').map((l) => l.trim()).filter(Boolean);
    const hits = lines.filter((l) => /лодк|башмак|пристан/i.test(l)).slice(0, 8);
    if (hits.length > 0) {
      console.log(`Hint(${stepName}): ` + hits.join(' | ').slice(0, 400));
    }
  }

  console.log(`Не найдено для шага "${stepName}" ни одного варианта: ${texts.join(', ')}`);

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

const FIGHT_TRIGGER_TEXTS = ['В бой', 'в бой', 'В бой!', 'в бой!', 'Ударить', 'ударить'];

async function performStep(page, config) {
  const {
    stepName,
    currentTexts,
    nextTexts = [],
    waitAfterClickMs = null,
    retries = 3,
    retryPauseMs = null,
  } = config;

  const snapshot = (text) => String(text || '')
    .replace(/\u00A0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500);

  for (let attempt = 1; attempt <= retries; attempt++) {
    console.log(`Шаг "${stepName}", попытка ${attempt}/${retries}`);

    if (nextTexts.length > 0 && await existsAnyText(page, nextTexts)) {
      console.log(`Следующий шаг для "${stepName}" уже виден, пропускаю текущий шаг`);
      return true;
    }

    const urlBeforeClick = page.url();
    const textBeforeClick = nextTexts.length === 0 ? snapshot(await getBodyText(page)) : null;
    const clicked = await clickByTexts(page, currentTexts, stepName);

    if (clicked) {
      if (waitAfterClickMs) {
        console.log(`Жду ${Math.round(waitAfterClickMs / 1000)} секунд после "${stepName}"`);
        await fixedPause(page, waitAfterClickMs);
      } else {
        await pause(page, 800, 1800);
      }

      const urlAfterClick = page.url();
      if (urlAfterClick && urlAfterClick !== urlBeforeClick) {
        console.log(`OK: после "${stepName}" изменился URL`);
        return true;
      }

      if (textBeforeClick !== null) {
        const textAfterClick = snapshot(await getBodyText(page));
        if (textAfterClick !== textBeforeClick) {
          console.log(`OK: после "${stepName}" изменился текст страницы`);
          return true;
        }
      }

      const nextExists = nextTexts.length > 0 ? await existsAnyText(page, nextTexts) : false;
      const currentStillExists = await existsAnyText(page, currentTexts);

      if (nextExists) {
        console.log(`OK: после "${stepName}" появился следующий шаг`);
        return true;
      }

      if (!currentStillExists) {
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

    const pauseMin = Number.isFinite(retryPauseMs?.min) ? retryPauseMs.min : 1200;
    const pauseMax = Number.isFinite(retryPauseMs?.max) ? retryPauseMs.max : 2200;
    await pause(page, pauseMin, pauseMax);
  }

  if (nextTexts.length > 0 && await existsAnyText(page, nextTexts)) {
    console.log(`Перед ошибкой обнаружен следующий шаг для "${stepName}". Считаю шаг успешным.`);
    return true;
  }

  throw new Error(`Не найден или не выполнен шаг "${stepName}"`);
}

async function goRouteToAmberMountain(page, { skipAmulet = false } = {}) {
  const AMULET = 'Амулет';
  const DEVTAUN = 'Девтаун';
  const EAST_CRAFT_DISTRICT = 'На восток, в ремесленный район';
  const EAST = 'Идти на восток';
  const EAST_ALT = 'Восток';
  const EAST_PORT_DISTRICT = 'Идти на восток - портовый район';
  const PRISTAN = 'Пристань';
  // The exact boat text changes often (case, prefix arrows, price formatting).
  // Use several substrings so `a:has-text()` can match reliably.
  const BOAT = 'Взять лодку до острова Старого башмака за 10 дин';
  const BOAT_ALT_1 = 'Взять лодку до острова Старого башмака';
  const BOAT_ALT_2 = 'Взять лодку до острова старого башмака';
  const BOAT_ALT_3 = 'лодку до острова старого башмака';
  const BOAT_ALT_4 = 'Старого башмака';
  const BOAT_ALT_5 = 'старого башмака';
  const NORTH = 'Идти на север';
  const NORTH_ALT = 'Север';
  const TO_MOUNTAIN = 'Идти к горе';
  const TO_MOUNTAIN_ALT = 'К горе';
  const SHAFT = 'Спуститься в шахту';
  const CONTINUE = 'Идти дальше';
  const LEFT = 'Идти налево';
  const LEFT_ALT = 'Налево';
  const NEXT = 'Далее';

  const textVariants = (...values) => values.flatMap((value) => [value, value?.toLowerCase?.() || value]);

  const devtaunButtons = textVariants(DEVTAUN);
  const eastCraftButtons = textVariants(EAST_CRAFT_DISTRICT);
  const eastButtons = textVariants(EAST, EAST_ALT);
  const eastPortButtons = textVariants(EAST_PORT_DISTRICT);
  const pristanButtons = textVariants(PRISTAN);
  const boatButtons = textVariants(BOAT, BOAT_ALT_1, BOAT_ALT_2, BOAT_ALT_3, BOAT_ALT_4, BOAT_ALT_5);
  const northButtons = textVariants(NORTH, NORTH_ALT);
  const mountainButtons = textVariants(TO_MOUNTAIN, TO_MOUNTAIN_ALT);
  const shaftButtons = textVariants(SHAFT);
  const continueButtons = textVariants(CONTINUE);
  const leftButtons = textVariants(LEFT, LEFT_ALT);
  const nextButtons = textVariants(NEXT);

  if (!skipAmulet) {
    const amuletOk = await clickByTexts(page, [AMULET, AMULET.toLowerCase()], AMULET);
    if (amuletOk) await pause(page, 800, 1800);
  } else {
    console.log('Skipping amulet -> starting Amber Mountain route.');
  }

  await performStep(page, {
    stepName: DEVTAUN,
    currentTexts: devtaunButtons,
    nextTexts: [...eastCraftButtons, ...eastButtons],
  });

  // Exact route as provided by user:
  // Амулет -> Девтаун -> На восток, в ремесленный район -> Идти на восток - портовый район -> Пристань
  await performStep(page, {
    stepName: EAST_CRAFT_DISTRICT,
    currentTexts: eastCraftButtons,
    nextTexts: eastPortButtons,
  });

  await performStep(page, {
    stepName: EAST_PORT_DISTRICT,
    currentTexts: eastPortButtons,
    nextTexts: pristanButtons,
    waitAfterClickMs: 3000,
  });

  await performStep(page, {
    stepName: PRISTAN,
    currentTexts: pristanButtons,
    nextTexts: boatButtons,
    waitAfterClickMs: 5000,
  });

  // From pier onwards: exact route as provided by user.
  // Пристань = Взять лодку... = Далее = Идти на восток = Идти на север (x3) = Идти к горе (x2) =
  // Спуститься в шахту = Идти дальше = Идти налево = Идти дальше = В бой!

  await performStep(page, {
    stepName: BOAT,
    currentTexts: boatButtons,
    nextTexts: nextButtons,
    waitAfterClickMs: 3000,
  });

  await performStep(page, {
    stepName: NEXT,
    currentTexts: nextButtons,
    nextTexts: eastButtons,
    waitAfterClickMs: 3000,
  });

  await performStep(page, {
    stepName: EAST,
    currentTexts: eastButtons,
    nextTexts: northButtons,
  });

  // IMPORTANT: directional links often remain visible even after clicking them.
  // Using nextTexts here makes performStep think "the next step is already visible" and it skips clicks.
  // For North/Mountain steps we MUST click the link the required number of times.
  for (let i = 0; i < 3; i++) {
    await performStep(page, {
      stepName: `Север ${i + 1}`,
      currentTexts: northButtons,
      nextTexts: [],
    });
  }

  // Some pages label this as "Идти к горе", "К горе", or just contain the word "горе".
  const mountainButtonsExpanded = [
    ...mountainButtons,
    'Горе',
    'горе',
  ];

  for (let i = 0; i < 2; i++) {
    await performStep(page, {
      stepName: `К горе ${i + 1}`,
      currentTexts: mountainButtonsExpanded,
      nextTexts: [],
    });
  }

  const textAfterMountain = await getBodyText(page);
  if (await existsAnyText(page, FIGHT_TRIGGER_TEXTS)) {
    return;
  }

  await performStep(page, {
    stepName: SHAFT,
    currentTexts: shaftButtons,
    nextTexts: continueButtons,
  });

  await performStep(page, {
    stepName: CONTINUE,
    currentTexts: continueButtons,
    nextTexts: leftButtons,
  });

  await performStep(page, {
    stepName: LEFT,
    currentTexts: leftButtons,
    nextTexts: continueButtons,
  });

  await performStep(page, {
    stepName: CONTINUE,
    currentTexts: continueButtons,
    nextTexts: ['В бой!', 'в бой!', 'В бой', 'в бой'],
  });
}

async function openAmberFight(page) {
  const V_BOY = 'В бой';
  const UDAR = 'Ударить';
  const DONE = 'Бой завершен!';
  const MOUNTAIN = 'Идти к горе';
  const SHAFT = 'Спуститься в шахту';
  const SHAFT_ALT_1 = 'Войти в шахту';
  const SHAFT_ALT_2 = 'В шахту';
  const CONTINUE = 'Идти дальше';
  const LEFT = 'Идти налево';
  const LEFT_ALT = 'Налево';

  const variants = (value) => [value, value.toLowerCase()];
  const fightTexts = [
    V_BOY,
    V_BOY.toLowerCase(),
    'В бой!',
    'в бой!',
  ];

  // The game sometimes keeps showing "Идти к горе" after the first click.
  // We need to click it TWO times (as per user route), and we must not rely on nextTexts
  // because the link can stay visible.
  for (let i = 0; i < 2; i++) {
    if (await existsAnyText(page, variants(MOUNTAIN))) {
      await performStep(page, {
        stepName: `Идти к горе ${i + 1}`,
        currentTexts: variants(MOUNTAIN),
        nextTexts: [],
        retries: 3,
      });
    } else {
      break;
    }
  }

  const shaftTexts = [
    ...variants(SHAFT),
    ...variants(SHAFT_ALT_1),
    ...variants(SHAFT_ALT_2),
  ];

  // Now proceed inside the mine (best effort; steps are usually present in sequence).
  if (await existsAnyText(page, shaftTexts)) {
    await performStep(page, {
      stepName: SHAFT,
      currentTexts: shaftTexts,
      nextTexts: [...variants(CONTINUE), ...fightTexts],
    });
  }

  if (await existsAnyText(page, variants(CONTINUE))) {
    await performStep(page, {
      stepName: CONTINUE,
      currentTexts: variants(CONTINUE),
      nextTexts: [...variants(LEFT), ...variants(LEFT_ALT), ...fightTexts],
    });
  }

  if (await existsAnyText(page, [...variants(LEFT), ...variants(LEFT_ALT)])) {
    await performStep(page, {
      stepName: LEFT,
      currentTexts: [...variants(LEFT), ...variants(LEFT_ALT)],
      nextTexts: [...variants(CONTINUE), ...fightTexts],
    });
  }

  if (await existsAnyText(page, variants(CONTINUE))) {
    await performStep(page, {
      stepName: CONTINUE,
      currentTexts: variants(CONTINUE),
      nextTexts: [...fightTexts],
    });
  }

  await performStep(page, {
    stepName: 'В бой',
    currentTexts: fightTexts,
    nextTexts: [UDAR, UDAR.toLowerCase(), DONE],
  });

  await pause(page, 1000, 2000);
}
async function ensureFightScreen(page) {
  const V_BOY_RE = /\u0412\u0020\u0431\u043e\u0439/i;
  const UDAR_RE = /\u0423\u0434\u0430\u0440\u0438\u0442\u044c/i;
  const DONE_RE = /\u0411\u043e\u0439\u0020\u0437\u0430\u0432\u0435\u0440\u0448\u0435\u043d!/i;

  const text = await getBodyText(page);

  if (UDAR_RE.test(text) || DONE_RE.test(text)) return;

  if (isAmberMountain(text)) {
    await openAmberFight(page);
    return;
  }

  console.log('Amber route not detected -> routing manually.');
  await goRouteToAmberMountain(page);
  await openAmberFight(page);
}

const FIGHT_DONE_TEXTS = ['Бой завершен!', 'Вернуться', 'вернуться', 'Продолжить квест', 'продолжить квест'];

async function fightLoop(page) {
  const UDAR = '\u0423\u0434\u0430\u0440\u0438\u0442\u044c';

for (let i = 0; i < 300; i++) {
    const text = await getBodyText(page);
    if (await existsAnyText(page, FIGHT_DONE_TEXTS)) {
      console.log('Fight done marker detected, exiting loop');
      return true;
    }

    const ok = await clickByTexts(page, [UDAR, UDAR.toLowerCase()], UDAR);
    if (!ok) {
      await pause(page, 700, 1800);
      continue;
    }

    await pause(page, 1000, 2000);
  }

  throw new Error('fight_timeout');
}

async function finishAmberQuest(page) {
  const DONE_BUTTONS = ['Бой завершен!', 'Бой завершен'];
  const RETURN_TEXTS = ['Вернуться', 'вернуться'];
  const CONTINUE_TEXTS = ['Продолжить квест', 'продолжить квест'];
  const LEAVE_TEXTS = ['Уйти', 'уйти', 'Выйти', 'выйти'];

  const doneClicked = await clickByTexts(page, DONE_BUTTONS, 'Бой завершен!');
  if (doneClicked) {
    await pause(page, 1000, 2000);
  }

  const returnClicked = await clickByTexts(page, RETURN_TEXTS, 'Вернуться');
  if (returnClicked) {
    await pause(page, 1000, 2000);
  }

  const continueClicked = await clickByTexts(page, CONTINUE_TEXTS, 'Продолжить квест');
  if (continueClicked) {
    await pause(page, 1000, 2000);
  }

  const leaveClicked = await clickByTexts(page, LEAVE_TEXTS, 'Уйти');
  if (leaveClicked) {
    await pause(page, 1000, 2000);
  }
}

const LAST_PORTAL_FASTWAY_URL = 'http://lbast.ru/location.php?r=1712&mod=fastway&lway=1';
const STONEGUARD_FASTWAY_URL = 'http://lbast.ru/location.php?r=6174&mod=fastway&lway=2';

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

async function goToLowHpRestViaFastway(page, label = 'low_hp_rest') {
  return navigateFastway(page, LOW_HP_FASTWAY_URL, label);
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

  const amuletOk = await clickByTexts(page, [AMULET, AMULET.toLowerCase()], AMULET);
  if (amuletOk) await pause(page, 800, 2000);

  const chaosOk = await clickByTexts(page, [CHAOS, CHAOS.toLowerCase()], CHAOS);
  if (chaosOk) await pause(page, 800, 2000);
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
    return {
      text,
      stats: null,
      attackHandled: true,
    };
  }

  let read = await getStatsFromPage(page, label, text);

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

      read = { text, stats: mergedStats };
    } catch (e) {
      console.log('pers.php fallback failed: ' + e.message);
    }
  }

  return {
    ...read,
    attackHandled: false,
  };
}

async function doScenario(page) {
  let read = await goToLocationAndReadStats(page, 'stats before action');
  if (read.attackHandled) {
    return;
  }
  let stats = read.stats;

  await handleUnreadMailIfAny(page);

  read = await goToLocationAndReadStats(page, 'stats after mail check');
  if (read.attackHandled) {
    return;
  }
  stats = read.stats;

  if (stats.hpCurrent === null || stats.cooldown === null) {
    throw new Error('failed to parse HP/cooldown');
  }

  // Only emergency action: if HP is massively negative, go to Chaos and wait a long time.
  // Do not use Stoneguard/fastway recovery in this scenario (can pull us out of the fight location).
  if (stats.hpCurrent !== null && stats.hpCurrent <= -10000) {
    console.log(`HP <= -10000 (${stats.hpCurrent}) -> go to chaos fist and sleep 90 min`);
    await goToChaosByAmulet(page);
    scheduleLongRestMinutes(90, 'hp_big_negative');
    return;
  }

  // Do not go to Chaos for small negatives; do not go to Stoneguard at all.

  while (shouldFightByStats(stats)) {
    console.log('can fight -> start fight');

    await ensureFightScreen(page);
    await fightLoop(page);
    await finishAmberQuest(page);
    return;

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

    if (stats.hpCurrent !== null && stats.hpCurrent <= -10000) {
      console.log(`post-fight HP <= -10000 (${stats.hpCurrent}) -> go to chaos fist and sleep 90 min`);
      await goToChaosByAmulet(page);
      scheduleLongRestMinutes(90, 'hp_big_negative_post_fight');
      return;
    }

    if (shouldFightByStats(stats)) {
      console.log('next fight is available');
      await pause(page, 1000, 2000);
      continue;
    }

    console.log('no condition matched, stop cycle');
    return;
  }

  console.log('nothing to do this cycle');
}

(async () => {
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
      await new Promise((resolve) => setTimeout(resolve, 60 * 1000));
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
          await page.goto('http://lbast.ru/location.php', { waitUntil: 'domcontentloaded', timeout: 60000 });
          uiStuckState = { stepName: '', count: 0, firstAt: 0 };
        } catch (e2) {
          // ignore
        }
        scheduleLongRestMinutes(2, 'ui_stuck_recovery');
      }

      const delayMs = nextCycleDelayOverrideMs ?? getRandomCycleDelayMs();
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
