// Сценарий: Блейк

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

async function goToLowHpRestByUrl(page) {
  try {
    await page.goto(LOW_HP_FASTWAY_URL, {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });
    console.log('OK: Low HP rest fastway');
    await pause(page, 1000, 2000);
    return true;
  } catch (e) {
    console.log('Could not open low HP rest fastway: ' + e.message);
    return false;
  }
}

function getRandomCycleDelayMs() {
  const minutes = randomInt(7, 16);
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

function shouldGoChaosByStats(stats) {
  return stats.hpCurrent < 0;
}

function shouldRecoverByStoneguard(stats) {
  return stats.cooldown <= 0;
}

function shouldRecoverByStoneguardLowHp(stats) {
  return stats.hpCurrent >= 0 && stats.hpCurrent < 1000 && stats.cooldown < 10;
}

function shouldUseFishByStats(stats) {
  return stats.cooldown >= 15 && stats.hpCurrent >= 0 && stats.hpCurrent < 1000;
}

function shouldFightByStats(stats) {
  return stats.hpCurrent >= 1800 && stats.cooldown > 0;
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

  // Sometimes the first click opens the alert page, and you must click "В бой!" once more to enter.
  if (/В\s*бой/i.test(afterText)) {
    const clickedAgain = await clickByTexts(page, ATTACK_BUTTON_TEXTS, 'Incoming attack (confirm)');
    if (clickedAgain) {
      await pause(page, 700, 1400);
    }
  }

  return true;
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

async function goRouteToBlake(page) {
  console.log('Иду по маршруту к Блейку');

  await performStep(page, {
    stepName: 'Амулет',
    currentTexts: ['Амулет', 'амулет'],
    nextTexts: ['Девтаун', 'девтаун'],
  });

  await performStep(page, {
    stepName: 'Девтаун',
    currentTexts: ['Девтаун', 'девтаун'],
    nextTexts: ['На восток, в ремесленный район', 'на восток, в ремесленный район'],
  });

  await performStep(page, {
    stepName: 'На восток, в ремесленный район',
    currentTexts: ['На восток, в ремесленный район', 'на восток, в ремесленный район'],
    nextTexts: ['Идти на восток', 'идти на восток'],
  });

  await performStep(page, {
    stepName: 'Идти на восток',
    currentTexts: ['Идти на восток', 'идти на восток'],
    nextTexts: ['портовый район', 'Портовый район', 'Пристань', 'пристань'],
  });

  const textAfterEast = await getBodyText(page);

  if (/Пристань/i.test(textAfterEast)) {
    console.log('После "Идти на восток" уже видна Пристань, шаг "портовый район" пропускаю');
  } else {
    await performStep(page, {
      stepName: 'портовый район',
      currentTexts: ['портовый район', 'Портовый район'],
      nextTexts: ['Пристань', 'пристань'],
    });
  }

  await performStep(page, {
    stepName: 'Пристань',
    currentTexts: ['Пристань', 'пристань'],
    nextTexts: ['Взять лодку до острова Блейка за 10 дин', 'взять лодку до острова Блейка за 10 дин'],
  });

  await performStep(page, {
    stepName: 'Взять лодку до острова Блейка за 10 дин',
    currentTexts: ['Взять лодку до острова Блейка за 10 дин', 'взять лодку до острова Блейка за 10 дин'],
    nextTexts: ['Далее', 'далее', 'Идти на север', 'идти на север'],
    waitAfterClickMs: 7000,
  });

  const textAfterBoat = await getBodyText(page);

  if (/Идти на север/i.test(textAfterBoat)) {
    console.log('После лодки уже доступен шаг "Идти на север", шаг "Далее" пропускаю');
  } else {
    await performStep(page, {
      stepName: 'Далее',
      currentTexts: ['Далее', 'далее'],
      nextTexts: ['Идти на север', 'идти на север'],
    });
  }

  await performStep(page, {
    stepName: 'Идти на север',
    currentTexts: ['Идти на север', 'идти на север'],
    nextTexts: ['Зайти в хижину', 'зайти в хижину'],
  });

  await performStep(page, {
    stepName: 'Зайти в хижину',
    currentTexts: ['Зайти в хижину', 'зайти в хижину'],
    nextTexts: ['Ударить', 'ударить', 'В бой', 'в бой', 'Бой завершен!'],
  });
}

async function openBlakeFight(page) {
  console.log('Открываю бой на Блейке');

  const text = await getBodyText(page);
  const pvp = detectPvpFromText(text);

  if (pvp && pvp.enemyNick && String(pvp.enemyNick).toLowerCase() !== 'unknown') {
    emitPvpAlert({
      source: 'openBlakeFight',
      enemyNick: pvp.enemyNick,
      enemyLevel: pvp.enemyLevel,
      fragment: pvp.fragment,
    });
    console.log(`PVP обнаружен до входа в бой: ${pvp.enemyNick}`);
  }

  if (/Ударить/i.test(text) || /Бой завершен!/i.test(text)) {
    console.log('Экран боя уже открыт');
    return;
  }

  if (/Зайти в хижину/i.test(text)) {
    await performStep(page, {
      stepName: 'Зайти в хижину',
      currentTexts: ['Зайти в хижину', 'зайти в хижину'],
      nextTexts: ['В бой', 'в бой', 'Ударить', 'ударить', 'Бой завершен!'],
    });
    await pause(page, 800, 1600);
  }

  const refreshedText = await getBodyText(page);

  if (/В бой/i.test(refreshedText)) {
    await performStep(page, {
      stepName: 'В бой',
      currentTexts: ['В бой', 'в бой'],
      nextTexts: ['Ударить', 'ударить', 'Бой завершен!'],
    });
    await pause(page, 1000, 2000);
  }
}

async function readStatsNearBlakeFight(page, label) {
  let read = await getStatsFromPage(page, label);

  if (read.stats.hpCurrent !== null && read.stats.cooldown !== null) {
    return read;
  }

  const text = read.text;
  const hasLocalFightScreen =
    /\u0412\s+\u0431\u043e\u0439/i.test(text) ||
    /\u0423\u0434\u0430\u0440\u0438\u0442\u044c/i.test(text) ||
    /\u0411\u043e\u0439\s+\u0437\u0430\u0432\u0435\u0440\u0448\u0435\u043d!/i.test(text) ||
    /\u0417\u0430\u0439\u0442\u0438\s+\u0432\s+\u0445\u0438\u0436\u0438\u043d\u0443/i.test(text);
  if (hasLocalFightScreen) {
    console.log(`${label}: trying local Blake fight refresh`);
    await openBlakeFight(page);
    await pause(page, 800, 1600);
    read = await getStatsFromPage(page, `${label} (local retry)`);
    if (read.stats.hpCurrent !== null && read.stats.cooldown !== null) {
      return read;
    }
  }

  console.log(`${label}: local parse failed, staying on Blake`);
  return read;
}

async function ensureFightScreen(page) {
  const text = await getBodyText(page);
  if (/\u0423\u0434\u0430\u0440\u0438\u0442\u044c/i.test(text) || /\u0411\u043e\u0439\s+\u0437\u0430\u0432\u0435\u0440\u0448\u0435\u043d!/i.test(text)) {
    console.log('Fight screen already open');
    return;
  }
  if (/\u0412\s+\u0431\u043e\u0439/i.test(text) || /\u0417\u0430\u0439\u0442\u0438\s+\u0432\s+\u0445\u0438\u0436\u0438\u043d\u0443/i.test(text)) {
    console.log('Already on Blake, opening local fight');
    await openBlakeFight(page);
    return;
  }
  await goRouteToBlake(page);
  await openBlakeFight(page);
}
async function fightLoop(page) {
  console.log('Начинаю бой');

  for (let i = 0; i < 300; i++) {
    const text = await getBodyText(page);
    const pvp = detectPvpFromText(text);

    if (pvp && pvp.enemyNick && String(pvp.enemyNick).toLowerCase() !== 'unknown') {
      emitPvpAlert({
        source: 'fightLoop',
        enemyNick: pvp.enemyNick,
        enemyLevel: pvp.enemyLevel,
        fragment: pvp.fragment,
      });
      console.log(`PVP обнаружен в бою: ${pvp.enemyNick}`);
    }

    if (/Бой завершен!/i.test(text)) {
      console.log('Нашел "Бой завершен!"');
      const ok = await clickByTexts(page, ['Бой завершен!'], 'Бой завершен!');
      if (!ok) {
        throw new Error('Надпись "Бой завершен!" есть, но кликнуть не удалось');
      }
      await pause(page, 800, 2000);
      return true;
    }

    const ok = await clickByTexts(page, ['Ударить', 'ударить'], 'Ударить');

    if (!ok) {
      console.log('Кнопка "Ударить" пока не найдена, жду и пробую снова');
      await pause(page, 700, 1800);
      continue;
    }

    await pause(page, 500, 2000);
  }

  throw new Error('Бой не завершился за допустимое число шагов');
}

async function useStoneguardRecovery(page) {
  console.log('Кулдаун 0 или меньше - иду в Стоунгард');

  const amuletOk = await clickByTexts(page, ['Амулет', 'амулет'], 'Амулет');
  if (amuletOk) {
    await pause(page, 800, 2000);
  } else {
    console.log('Не найден Амулет');
  }

  const stoneguardOk = await clickByTexts(page, ['Стоунгард', 'стоунгард'], 'Стоунгард');
  if (stoneguardOk) {
    await pause(page, 800, 2000);
  } else {
    console.log('Не найден Стоунгард');
  }
}

async function useFishRecovery(page) {
  console.log('HP меньше 1000 и кулдаун 15+ - ем Жареную рыбу');

  const invOk = await clickByTexts(page, ['Инв', 'инв'], 'Инв');
  if (invOk) {
    await pause(page, 800, 1800);
  } else {
    console.log('Не найден Инв');
    return false;
  }

  const favOk = await clickByTexts(page, ['Избранное', 'избранное'], 'Избранное');
  if (favOk) {
    await pause(page, 800, 1800);
  } else {
    console.log('Не найдено Избранное');
    return false;
  }

  const fishOk = await clickByTexts(page, ['Жареная рыба', 'жареная рыба'], 'Жареная рыба');
  if (fishOk) {
    await pause(page, 800, 1800);
  } else {
    console.log('Не найдена Жареная рыба');
    return false;
  }

  const backOk = await clickByTexts(page, ['В игру', 'в игру'], 'В игру');
  if (backOk) {
    await pause(page, 800, 1800);
  } else {
    console.log('Не найдена кнопка "В игру"');
    return false;
  }

  return true;
}

async function goToChaosByAmulet(page) {
  console.log('HP в минусе - иду по пути Амулет -> Кулак хаоса');

  const amuletOk = await clickByTexts(page, ['Амулет', 'амулет'], 'Амулет');
  if (amuletOk) {
    await pause(page, 800, 2000);
  } else {
    console.log('Не найден Амулет');
  }

  const chaosOk = await clickByTexts(page, ['Кулак хаоса', 'кулак хаоса'], 'Кулак хаоса');
  if (chaosOk) {
    await pause(page, 800, 2000);
  } else {
    console.log('Не найден Кулак хаоса');
  }
}

async function getStatsFromPage(page, label, providedText = null) {
  const text = providedText || await getBodyText(page);
  const stats = parseStats(text);
  console.log(`${label}:`, stats);
  return { text, stats };
}

async function readStatsWithFallback(page, label) {
  return await readStatsNearBlakeFight(page, label);
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

async function reevaluateAfterFish(page) {
  const read = await goToLocationAndReadStats(page, 'Статы после рыбы');
  if (read.attackHandled) {
    return 'attack';
  }
  const stats = read.stats;

  if (stats.hpCurrent === null || stats.cooldown === null) {
    console.log('После рыбы не удалось распарсить статы');
    return null;
  }

  if (shouldGoChaosByStats(stats)) {
    console.log('После рыбы HP ушел в минус -> переход в Кулак хаоса');
    await goToChaosByAmulet(page);
    return 'done';
  }

  if (shouldFightByStats(stats)) {
    console.log('После рыбы можно идти в бой');
    return 'fight';
  }

  console.log('После рыбы ни одно условие не сработало, завершаю цикл');
  return 'done';
}

async function doScenario(page) {
  let read = await goToLocationAndReadStats(page, 'Статы до действия');
  if (read.attackHandled) {
    return;
  }
  let stats = read.stats;

  await handleUnreadMailIfAny(page);

  read = await goToLocationAndReadStats(page, 'Статы после проверки писем');
  if (read.attackHandled) {
    return;
  }
  stats = read.stats;

  if (stats.hpCurrent === null || stats.cooldown === null) {
    throw new Error('Не удалось распарсить HP и кулдаун. Нужен реальный текст страницы.');
  }

  if (stats.hpCurrent !== null && stats.hpCurrent < -10000) {
    console.log(`HP < -10000 (${stats.hpCurrent}) -> перехожу на отдых и отключаюсь на 90 минут`);
    await goToLowHpRestByUrl(page);
    scheduleLongRestMinutes(90, 'low_hp');
    return;
  }

  if (shouldGoChaosByStats(stats)) {
    console.log('HP в минусе -> переход в Кулак хаоса');
    await goToChaosByAmulet(page);
    return;
  }

  while (shouldFightByStats(stats)) {
    console.log('Можно идти в бой -> запускаю бой');

    await ensureFightScreen(page);
    await fightLoop(page);

    read = await readStatsWithFallback(page, 'Статы после боя');
    stats = read.stats;

    if (stats.hpCurrent === null || stats.cooldown === null) {
      console.log('После боя не удалось распарсить статы, завершаю цикл');
      return;
    }

    if (shouldGoChaosByStats(stats)) {
      console.log('После боя HP ушел в минус -> переход в Кулак хаоса');
      await goToChaosByAmulet(page);
      return;
    }

    if (shouldFightByStats(stats)) {
      console.log('После боя можно сразу в следующий бой');
      await pause(page, 1000, 2000);
      continue;
    }

    console.log('HP/кулдаун не подходят для следующего боя. Жду следующий цикл.');
    return;
  }

  console.log('Ни одно условие не сработало');
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

  await page.goto('http://lbast.ru/location.php', {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });

  console.log('Браузер открыт. Начинаю цикл.');

  while (true) {
    try {
      console.log('==============================');
      console.log('Новый цикл:', new Date().toLocaleString());

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
      console.log(`Цикл завершен. Жду ${delayMinutes} минут.`);
      await fixedPause(page, delayMs);
    } catch (e) {
      console.log('Ошибка цикла:', e.message);
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
      console.log(`Все равно жду ${delayMinutes} минут и потом пробую снова.`);
      await fixedPause(page, delayMs);
    }

    try {
      await page.goto('http://lbast.ru/location.php', {
        waitUntil: 'domcontentloaded',
        timeout: 60000,
      });
    } catch (e) {
      console.log('Не удалось открыть location.php заново.');
    }

    await pause(page, 1000, 2000);
  }
})();

