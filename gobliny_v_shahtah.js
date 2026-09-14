// Scenario: Goblins

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

process.on('unhandledRejection', (err) => {
  const message = err && err.message ? err.message : String(err);
  console.log('Unhandled rejection:', message);
});

process.on('uncaughtException', (err) => {
  const message = err && err.message ? err.message : String(err);
  console.log('Uncaught exception:', message);
});

let lastHandledMailSignature = '';
const ENABLE_PVP_ALERTS = true;
const SELF_NICK = 'tsunami';
const SELF_NICK_RE = new RegExp(`\\b${SELF_NICK}\\b`, 'i');
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
  const delay = randomInt(min, max);
  await page.waitForTimeout(delay);
}

async function fixedPause(page, ms) {
  await page.waitForTimeout(ms);
}

async function safeGoto(page, url, { attempts = 4, timeoutMs = 60000, stepName = 'goto', silent = false } = {}) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
      return true;
    } catch (e) {
      if (!silent) {
        console.log(`${stepName}: navigation failed (${attempt}/${attempts}): ${e.message}`);
      }

      // Try to cancel any stuck navigation and reset to a blank page.
      try {
        await page.goto('about:blank', { waitUntil: 'commit', timeout: 15000 });
      } catch (e2) {
        // ignore
      }

      if (attempt < attempts) {
        await fixedPause(page, 3000 + attempt * 2000);
      }
    }
  }

  return false;
}

function getRandomCycleDelayMs() {
  const minutes = randomInt(14, 21);
  return minutes * 60 * 1000;
}

async function saveSnapshot(page, prefix = 'snapshot') {
  return;
}

async function getBodyText(page) {
  return await page.locator('body').innerText().catch(() => '');
}

const STAT_HP_CONTEXT_RE = /(?:hp|health|life|здоров|жизн)/i;
const STAT_COOLDOWN_PATTERNS = [
  /(?:cooldown|cd)\D*?([-]?\d+)/i,
  /(?:осталось|отдых|покой|восстанов|перезарядк|rest)\D*?([-]?\d+)/i,
  /([-]?\d+)\s*сек(?:унд(?:ы|у)?)?/i,
  /([-]?\d+)\s*мин(?:ут(?:ы|у)?)?/i,
];

function findHpMatchWithContext(normalized) {
  const hpRegex = /([-]?\d+)\s*\/\s*(\d+)/g;
  let match;

  while ((match = hpRegex.exec(normalized)) !== null) {
    const contextStart = Math.max(0, match.index - 120);
    const contextEnd = Math.min(normalized.length, match.index + match[0].length + 120);
    const context = normalized.slice(contextStart, contextEnd);

    if (STAT_HP_CONTEXT_RE.test(context)) {
      hpRegex.lastIndex = 0;
      return match;
    }
  }

  hpRegex.lastIndex = 0;
  return normalized.match(/([-]?\d+)\s*\/\s*(\d+)/);
}

function extractCooldownValue(segment) {
  if (!segment) {
    return null;
  }

  const snippet = segment.slice(0, 400);

  for (const pattern of STAT_COOLDOWN_PATTERNS) {
    const match = pattern.exec(snippet);
    if (match) {
      const value = Number(match[1]);
      if (!Number.isNaN(value)) {
        return value;
      }
    }
  }

  const parenMatch = snippet.match(/\(([-]?\d+)\)/);
  if (parenMatch) {
    const value = Number(parenMatch[1]);
    if (!Number.isNaN(value)) {
      return value;
    }
  }

  return null;
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

  const hpMatch = findHpMatchWithContext(normalized);
  if (!hpMatch) {
    return {
      hpCurrent: null,
      hpMax: null,
      cooldown: null,
    };
  }

  const hpCurrent = Number(hpMatch[1]);
  const hpMax = Number(hpMatch[2]);

  if (Number.isNaN(hpCurrent) || Number.isNaN(hpMax)) {
    return {
      hpCurrent: null,
      hpMax: null,
      cooldown: null,
    };
  }

  const afterHpIndex = (hpMatch.index || 0) + (hpMatch[0]?.length || 0);
  let cooldown = extractCooldownValue(normalized.slice(afterHpIndex));
  if (cooldown === null) {
    cooldown = extractCooldownValue(normalized);
  }

  return {
    hpCurrent,
    hpMax,
    cooldown,
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

function isGoblinMines(text) {
  return containsInsensitive(text, 'Осмотреть шахты') ||
    containsInsensitive(text, 'шахты') ||
    containsInsensitive(text, 'Горы Дарии');
}

function shouldGoChaosByStats(stats) {
  return stats.hpCurrent < 0;
}

function shouldRecoverByStoneguard(stats) {
  return stats.cooldown <= 0;
}

function shouldRecoverByStoneguardLowHp(stats) {
  return stats.hpCurrent >= 0 && stats.hpCurrent < 1000 && stats.cooldown < 10;
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
    `text=${text}`,
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
          await locator.click({ timeout: 5000 });
          console.log(`OK: ${stepName} -> ${text}`);
          uiStuckState = { stepName: '', count: 0, firstAt: 0 };
          return true;
        } catch (e) {
          console.log(`Не смог кликнуть ${stepName} -> ${text}: ${e.message}`);
        }
      }
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

async function performStep(page, config) {
  const {
    stepName,
    currentTexts,
    nextTexts = [],
    waitAfterClickMs = null,
    retries = 3,
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

    await pause(page, 1200, 2200);
  }

  if (nextTexts.length > 0 && await existsAnyText(page, nextTexts)) {
    console.log(`Перед ошибкой обнаружен следующий шаг для "${stepName}". Считаю шаг успешным.`);
    return true;
  }

  throw new Error(`Не найден или не выполнен шаг "${stepName}"`);
}

async function tryPerformStepOptional(page, { stepName, currentTexts, nextTexts, waitAfterClickMs } = {}) {
  if (nextTexts?.length > 0 && await existsAnyText(page, nextTexts)) {
    return true;
  }

  const exists = await existsAnyText(page, currentTexts || []);
  if (!exists) {
    return false;
  }

  await performStep(page, {
    stepName,
    currentTexts,
    nextTexts,
    waitAfterClickMs,
    retries: 3,
  });

  return true;
}

async function goRouteToGoblins(page) {
  const HORSE = '\u041a\u043e\u043d\u044c';
  const DARIA_MOUNTAINS = '\u0413\u043e\u0440\u044b \u0414\u0430\u0440\u0438\u0438';
  const IN_PATH = '\u0412 \u043f\u0443\u0442\u0438';
  const IN_PATH_MORE = '\u0412 \u043f\u0443\u0442\u0438 \u0435\u0449\u0435';
  const IN_PATH_MORE2 = '\u0412 \u043f\u0443\u0442\u0438 \u0435\u0449\u0451';
  const NORTH = '\u0418\u0434\u0442\u0438 \u043d\u0430 \u0441\u0435\u0432\u0435\u0440';
  const MINES = '\u041e\u0441\u043c\u043e\u0442\u0440\u0435\u0442\u044c \u0448\u0430\u0445\u0442\u044b';
  const UDAR = '\u0423\u0434\u0430\u0440\u0438\u0442\u044c';
  const DONE = '\u0411\u043e\u0439 \u0437\u0430\u0432\u0435\u0440\u0448\u0435\u043d!';

  await performStep(page, {
    stepName: HORSE,
    currentTexts: [HORSE, HORSE.toLowerCase()],
    nextTexts: [DARIA_MOUNTAINS, DARIA_MOUNTAINS.toLowerCase()],
  });

  await performStep(page, {
    stepName: DARIA_MOUNTAINS,
    currentTexts: [DARIA_MOUNTAINS, DARIA_MOUNTAINS.toLowerCase()],
    waitAfterClickMs: 7000,
    nextTexts: [
      IN_PATH,
      IN_PATH.toLowerCase(),
      IN_PATH_MORE,
      IN_PATH_MORE.toLowerCase(),
      IN_PATH_MORE2,
      IN_PATH_MORE2.toLowerCase(),
      NORTH,
      NORTH.toLowerCase(),
      MINES,
      MINES.toLowerCase(),
      UDAR,
      UDAR.toLowerCase(),
      DONE,
    ],
  });

  // Sometimes travel shows a separate "В пути( еще)" link.
  await tryPerformStepOptional(page, {
    stepName: IN_PATH,
    currentTexts: [
      IN_PATH_MORE,
      IN_PATH_MORE.toLowerCase(),
      IN_PATH_MORE2,
      IN_PATH_MORE2.toLowerCase(),
      IN_PATH,
      IN_PATH.toLowerCase(),
    ],
    nextTexts: [NORTH, NORTH.toLowerCase(), MINES, MINES.toLowerCase(), UDAR, UDAR.toLowerCase(), DONE],
  });

  await tryPerformStepOptional(page, {
    stepName: NORTH,
    currentTexts: [NORTH, NORTH.toLowerCase()],
    nextTexts: [MINES, MINES.toLowerCase(), UDAR, UDAR.toLowerCase(), DONE],
  });
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
  if ((/\u0412 \u0431\u043e\u0439!/i.test(textAfterMines) || /\u0412 \u0431\u043e\u0439\\b/i.test(textAfterMines)) && !/\u0423\u0434\u0430\u0440\u0438\u0442\u044c/i.test(textAfterMines)) {
    await performStep(page, {
      stepName: V_BOY,
      currentTexts: [V_BOY, V_BOY.toLowerCase(), '\u0412 \u0431\u043e\u0439', '\u0432 \u0431\u043e\u0439', '\u0412\u0441\u0442\u0443\u043f\u0438\u0442\u044c \u0432 \u0431\u043e\u0439', '\u0432\u0441\u0442\u0443\u043f\u0438\u0442\u044c \u0432 \u0431\u043e\u0439', '\u041f\u0440\u0438\u043d\u044f\u0442\u044c \u0431\u043e\u0439', '\u043f\u0440\u0438\u043d\u044f\u0442\u044c \u0431\u043e\u0439'],
      nextTexts: [UDAR, UDAR.toLowerCase(), DONE],
      retries: 4,
    });
  }

  await pause(page, 1000, 2000);
}

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

async function ensureFightScreen(page) {
  const text = await getBodyText(page);

  if (/\u0423\u0434\u0430\u0440\u0438\u0442\u044c/i.test(text) || /\u0411\u043e\u0439 \u0437\u0430\u0432\u0435\u0440\u0448\u0435\u043d!/i.test(text)) {
    return;
  }

  if (isGoblinMines(text)) {
    await openGoblinFight(page);
    return;
  }

  const portalOk = await goToLastPortalByAmulet(page);
  if (portalOk) {
    const afterPortalText = await getBodyText(page);
    if (isGoblinMines(afterPortalText)) {
      await openGoblinFight(page);
      return;
    }
    console.log('Goblin last portal did not reach mines -> routing manually.');
  }

  await page.goto('http://lbast.ru/location.php', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await pause(page, 1000, 2000);
  await goRouteToGoblins(page);
  await openGoblinFight(page);
}

async function fightLoop(page) {
  const UDAR = '\u0423\u0434\u0430\u0440\u0438\u0442\u044c';
  const DONE = '\u0411\u043e\u0439 \u0437\u0430\u0432\u0435\u0440\u0448\u0435\u043d!';
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

  for (let i = 0; i < 300; i++) {
    const text = await getBodyText(page);

    if (new RegExp(DONE, 'i').test(text)) {
      const ok = await clickByTexts(page, [DONE], DONE);
      if (!ok) throw new Error('fight_done_click_failed');
      await pause(page, 800, 2000);
      return true;
    }

    const ok = await clickByTexts(page, [UDAR, UDAR.toLowerCase()], UDAR);
    if (!ok) {
      const enterFightOk = await clickByTexts(page, START_FIGHT_TEXTS, '\u0412 \u0431\u043e\u0439');
      if (enterFightOk) {
        await pause(page, 700, 1800);
        continue;
      }

      await pause(page, 700, 1800);
      continue;
    }

    await pause(page, 500, 1000);
  }

  throw new Error('fight_timeout');
}

async function useRecovery(page) {
  const success = await goToStoneguardViaFastway(page, 'Стоунгард (восстановление)');
  if (!success) {
    console.log('Не удалось попасть в Стоунгард через Fastway, вернусь на главную страницу.');
  }
}

async function goToLastPortalByAmulet(page) {
  const AMULET = 'Амулет';
  const LAST_PORTAL = 'Последний портал';

  const amuletOk = await clickByTexts(page, [AMULET, AMULET.toLowerCase()], AMULET);
  if (!amuletOk) {
    return false;
  }
  await pause(page, 800, 2000);

  const portalOk = await clickByTexts(page, [LAST_PORTAL, LAST_PORTAL.toLowerCase()], LAST_PORTAL);
  if (!portalOk) {
    await clickByTexts(page, ['Вернуться', 'вернуться'], 'Вернуться');
    return false;
  }

  await pause(page, 800, 2000);
  return true;
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

  if (stats.hpCurrent !== null && stats.hpCurrent < -10000) {
    console.log(`HP < -10000 (${stats.hpCurrent}) -> go to rest location and sleep 90 min`);
    await goToLowHpRestViaFastway(page, 'low_hp_rest');
    scheduleLongRestMinutes(90, 'low_hp');
    return;
  }

  if (shouldGoChaosByStats(stats)) {
    console.log('HP below zero -> go to chaos fist');
    await goToChaosByAmulet(page);
    return;
  }

  if (shouldRecoverByStats(stats)) {
    console.log('recovery condition met -> go to stoneguard');
    await useRecovery(page);
    return;
  }

  while (shouldFightByStats(stats)) {
    console.log('can fight -> start fight');

    await ensureFightScreen(page);
    await fightLoop(page);

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

    if (shouldGoChaosByStats(stats)) {
      console.log('post-fight HP below zero -> go to chaos fist');
      await goToChaosByAmulet(page);
      return;
    }

    if (shouldRecoverByStats(stats)) {
      console.log('post-fight recovery condition met');
      await useRecovery(page);
      return;
    }

    if (shouldFightByStats(stats)) {
      console.log('next fight is available');
      await pause(page, 1000, 2000);
      continue;
    }

    await goToStoneguardViaFastway(page, 'Стоунгард после боя');
    console.log('no condition matched, stop cycle');
    return;
  }

  console.log('nothing to do this cycle');
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

  const opened = await safeGoto(page, 'http://lbast.ru/location.php', { attempts: 6, timeoutMs: 60000, stepName: 'startup goto' });
  if (!opened) {
    console.log('startup goto failed; will retry inside the loop.');
  }

  console.log('Browser opened. Start loop.');

  while (true) {
    try {
      console.log('==============================');
      console.log('New cycle:', new Date().toLocaleString());

      await page.bringToFront();
      await pause(page, 1000, 2000);

      await safeGoto(page, 'http://lbast.ru/location.php', { attempts: 3, timeoutMs: 60000, stepName: 'cycle goto', silent: true });

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
          await goToStoneguardViaFastway(page, 'ui_stuck_recovery');
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
      await safeGoto(page, 'http://lbast.ru/location.php', { attempts: 2, timeoutMs: 60000, stepName: 'post-cycle goto', silent: true });
    } catch (e) {
      console.log('Could not open location.php, retry later.');
    }

    await pause(page, 1000, 2000);
  }
})();
