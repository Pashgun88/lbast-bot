require('dotenv').config({ quiet: true });

process.on('uncaughtException', (err) => {
  console.error(`[FATAL] uncaughtException: ${err?.stack || err?.message || err}`);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error(`[FATAL] unhandledRejection: ${reason?.stack || reason?.message || reason}`);
});

process.on('exit', (code) => {
  const msg = `[EXIT] code=${code} at ${new Date().toISOString()}\n`;
  try {
    require('fs').appendFileSync(require('path').join(__dirname, 'exit.log'), msg);
  } catch (e) { /* ignore */ }
  process.stderr.write(msg);
});

const { spawn, execFile, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const https = require('https');
const dns = require('dns');
const net = require('net');
const tls = require('tls');

const TELEGRAM_SOCKS_PROXY = String(process.env.TELEGRAM_SOCKS_PROXY || '').trim();

function parseHostPort(value) {
  const s = String(value || '').trim();
  const m = s.match(/^([^:]+):(\d+)$/);
  if (!m) return null;
  const host = m[1];
  const port = Number(m[2]);
  if (!host || !Number.isFinite(port) || port <= 0) return null;
  return { host, port };
}

async function socks5Connect({ proxyHost, proxyPort, targetHost, targetPort, timeoutMs = 60000 }) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: proxyHost, port: proxyPort });
    let settled = false;

    const fail = (err) => {
      if (settled) return;
      settled = true;
      try { socket.destroy(); } catch (e) { /* ignore */ }
      reject(err);
    };

    socket.setTimeout(timeoutMs, () => fail(new Error('socks_timeout')));
    socket.on('error', fail);

    socket.once('connect', () => {
      // Greeting: SOCKS5, 1 method, no-auth (0x00)
      socket.write(Buffer.from([0x05, 0x01, 0x00]));
    });

    let stage = 0;
    let buf = Buffer.alloc(0);
    socket.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);

      // Stage 0: server choice (2 bytes)
      if (stage === 0) {
        if (buf.length < 2) return;
        const ver = buf[0];
        const method = buf[1];
        buf = buf.slice(2);
        if (ver !== 0x05) return fail(new Error('socks_bad_version'));
        if (method !== 0x00) return fail(new Error('socks_auth_unsupported'));

        // Connect request with domain name
        const hostBuf = Buffer.from(String(targetHost), 'utf8');
        const portBuf = Buffer.from([0x00, 0x00]);
        portBuf.writeUInt16BE(targetPort, 0);
        const req = Buffer.concat([
          Buffer.from([0x05, 0x01, 0x00, 0x03, hostBuf.length]),
          hostBuf,
          portBuf,
        ]);
        socket.write(req);
        stage = 1;
      }

      // Stage 1: connect reply (at least 5 bytes then addr varies)
      if (stage === 1) {
        if (buf.length < 5) return;
        const ver = buf[0];
        const rep = buf[1];
        const atyp = buf[3];
        if (ver !== 0x05) return fail(new Error('socks_bad_version_reply'));
        if (rep !== 0x00) return fail(new Error(`socks_connect_failed:${rep}`));

        // Eat full reply: VER REP RSV ATYP BND.ADDR BND.PORT
        let need = 0;
        if (atyp === 0x01) need = 4; // IPv4
        else if (atyp === 0x03) {
          const len = buf[4];
          need = 1 + len;
        } else if (atyp === 0x04) need = 16; // IPv6
        else return fail(new Error('socks_bad_atyp'));

        const headerLen = 4;
        const addrStart = headerLen;
        const addrLen = atyp === 0x03 ? (1 + buf[4]) : need;
        const total = headerLen + addrLen + 2;
        if (buf.length < total) return;
        buf = buf.slice(total);

        settled = true;
        socket.setTimeout(0);
        socket.removeAllListeners('error');
        resolve(socket);
      }
    });
  });
}

function isTransientNetworkError(e) {
  const msg = String(e?.message || e);
  const code = String(e?.code || '');
  return (
    /ETIMEDOUT|ECONNRESET|EHOSTUNREACH|ENETUNREACH|ECONNREFUSED|EPIPE|timeout|socket hang up|before secure TLS connection was established/i.test(
      msg
    ) || /ETIMEDOUT|ECONNRESET|EHOSTUNREACH|ENETUNREACH|ECONNREFUSED|EPIPE/i.test(code)
  );
}

async function tgRequestViaProxyOnce(method, jsonBody, proxy) {
  const plain = await socks5Connect({
    proxyHost: proxy.host,
    proxyPort: proxy.port,
    targetHost: 'api.telegram.org',
    targetPort: 443,
    timeoutMs: 60000,
  });

  const tlsSocket = tls.connect({
    socket: plain,
    servername: 'api.telegram.org',
    rejectUnauthorized: true,
  });

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        method: 'POST',
        host: 'api.telegram.org',
        path: `/bot${BOT_TOKEN}/${method}`,
        headers: {
          Host: 'api.telegram.org',
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Length': Buffer.byteLength(jsonBody, 'utf8'),
          Connection: 'close',
        },
        createConnection: () => tlsSocket,
        timeout: 60000,
      },
      (res) => {
        let raw = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (raw += c));
        res.on('end', () => {
          const trimmed = String(raw || '').trim();
          if (!trimmed) return reject(new Error('Пустой ответ от Telegram'));
          try {
            resolve(JSON.parse(trimmed));
          } catch (e) {
            reject(new Error(`Неверный JSON от Telegram: ${trimmed}`));
          }
        });
      }
    );
    req.on('timeout', () => {
      try { req.destroy(new Error('timeout')); } catch (e) { /* ignore */ }
    });
    req.on('error', reject);
    req.write(jsonBody);
    req.end();
  });
}

async function tgRequestRawJson(method, payload = {}) {
  const jsonBody = JSON.stringify(payload || {});

  const proxy = parseHostPort(TELEGRAM_SOCKS_PROXY);
  if (proxy) {
    const maxAttempts = 4;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await tgRequestViaProxyOnce(method, jsonBody, proxy);
      } catch (e) {
        if (attempt === maxAttempts || !isTransientNetworkError(e)) {
          throw e;
        }
        await sleep(Math.min(15000, 800 * attempt));
      }
    }
  }

  // Fallback: direct (no proxy) with multi-IP retries (existing logic in tgRequest).
  return null;
}

function setupWindowsConsoleUtf8() {
  if (process.platform !== 'win32') {
    return;
  }

  try {
    execSync('chcp 65001 > nul', { stdio: 'ignore', windowsHide: true, shell: true });
  } catch (e) {
    // Если команда не сработала — остаемся с текущим кодом страницы.
  }

  try {
    process.stdout.setDefaultEncoding('utf8');
    process.stderr.setDefaultEncoding('utf8');
  } catch (e) {
    // Некоторые среды не позволяют менять кодировку.
  }
}

setupWindowsConsoleUtf8();

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ALLOWED_CHAT_ID = String(process.env.TELEGRAM_CHAT_ID || '');

const LOG_ENABLED = String(process.env.BOT_LOG_ENABLED || '1') !== '0';
const LOG_DIR = String(process.env.BOT_LOG_DIR || path.join(__dirname, 'logs'));

if (!BOT_TOKEN) {
  throw new Error('Не найден TELEGRAM_BOT_TOKEN в .env');
}

if (!ALLOWED_CHAT_ID) {
  throw new Error('Не найден TELEGRAM_CHAT_ID в .env');
}

const API_BASE = `https://api.telegram.org/bot${BOT_TOKEN}`;

// Каждый сценарий: путь к скрипту + доп. переменные окружения при запуске.
// "Квесты + ..." — один и тот же главный скрипт, отличается только цель фарма после квестов
// (FARM_TARGET читается в daily_quests_piraty.js). Отдельная "Янтарная гора" — старый
// самостоятельный скрипт без квестов, оставлен как есть.
const SCRIPTS = {
  'Квесты + Блейки': { path: './daily_quests_piraty.js', env: { FARM_TARGET: 'blake' } },
  'Квесты + Гоблины': { path: './daily_quests_piraty.js', env: { FARM_TARGET: 'goblins' } },
  'Квесты + Янтарь': { path: './daily_quests_piraty.js', env: { FARM_TARGET: 'yantar' } },
  'Янтарная гора': { path: './yantar_v_gore.js', env: {} },
};

const START_DELAYS = {
  'Старт 6ч': 6,
};

const KEYBOARD = {
  keyboard: [
    ['Квесты + Блейки', 'Квесты + Гоблины'],
    ['Квесты + Янтарь', 'Янтарная гора'],
    ['Запустить сейчас', 'Статус', 'Стоп'],
    ['Пауза', 'Продолжить'],
    ['Старт 6ч'],
  ],
  resize_keyboard: true,
};

const ENABLE_PVP_ALERTS = true;

let selectedScriptName = null;
let selectedScriptPath = null;
let selectedScriptEnv = {};
let selectedStartDelayHours = null;

let isRunning = false;
let currentProcess = null;
let currentLogStream = null;
let currentLogPath = null;

// Пауза НЕ убивает процесс: менеджер выставляет флаг-файл, а сценарий, увидев его, просто ничего
// не делает и не трогает страницу. Браузер остаётся открытым -- в этом же окне можно играть
// самому, а потом вернуть управление боту. Отсчёт 17-18 часов до автоперерыва на паузе продолжает
// идти, таймер не снимаем. Флаг переживает и перезапуск процесса (например, после автоперерыва):
// поднявшийся сценарий увидит его и снова встанет.
const PAUSE_FLAG_PATH = path.join(__dirname, 'pause.flag');
let isPaused = false;
// Переменные окружения текущего запуска (например FARM_START_AFTER у отложенного старта) -- чтобы
// "Продолжить" возобновляло в том же режиме, а не срывалось сразу в фарм.
let currentRunExtraEnv = {};

let startTimerId = null;
let plannedStartAt = null;

let lastRunStartedAt = null;
let lastRunFinishedAt = null;
let lastRunResult = 'Ждем запуска';

let pollingActive = true;
let pollBusy = false;
let lastUpdateId = 0;
let pollDelayMs = 2000;

let pvpAlertSentForCurrentRun = false;

// Автоперерыв рандомизирован, чтобы расписание не было машинно-ровным:
// активность 17–18ч, затем перерыв 6–6.6ч. Значения выбираются заново на каждый цикл.
const AUTO_BREAK_AFTER_MIN_H = 17;
const AUTO_BREAK_AFTER_MAX_H = 18;
const AUTO_BREAK_DURATION_MIN_H = 6;
const AUTO_BREAK_DURATION_MAX_H = 6.6;
let autoBreakTimerId = null;
let autoBreakRestartAt = null;
let isAutoBreakStop = false;

function randomHoursMs(minH, maxH) {
  const h = minH + Math.random() * (maxH - minH);
  return Math.round(h * 60 * 60 * 1000);
}

function formatHours(ms) {
  return (ms / (60 * 60 * 1000)).toFixed(1);
}

// Мисттаунское событие идёт по расписанию зазывалы и ждать не будет, а автоперерыв убивает
// сценарий на 6+ часов -- всё, что выпало в это окно, раньше просто терялось. Расписание сценарий
// хранит у себя в состоянии, оттуда его и читаем (файл может отсутствовать -- тогда перерыв
// обычный).
const MISTTOWN_EARLY_WAKE_MS = 5 * 60 * 1000;

function findMisttownEventInWindow(fromMs, toMs) {
  try {
    const state = JSON.parse(fs.readFileSync(path.join(__dirname, 'daily_quests_piraty.state.json'), 'utf8'));
    const due = state.misttownSecretDueAt || {};
    const attempted = state.misttownSecretAttemptedAt || {};

    let soonest = null;
    for (const [theme, at] of Object.entries(due)) {
      if (!Number.isFinite(at)) continue;
      if (attempted[theme] === at) continue; // уже отработано
      if (at < fromMs || at > toMs) continue;
      if (soonest === null || at < soonest.at) soonest = { theme, at };
    }
    return soonest;
  } catch (e) {
    return null;
  }
}

function scheduleAutoBreak() {
  clearAutoBreakTimer();
  const activeMs = randomHoursMs(AUTO_BREAK_AFTER_MIN_H, AUTO_BREAK_AFTER_MAX_H);

  autoBreakTimerId = setTimeout(async () => {
    autoBreakTimerId = null;
    if (!isRunning || !currentProcess) return;

    isAutoBreakStop = true;
    currentProcess.kill('SIGTERM');

    const breakMs = randomHoursMs(AUTO_BREAK_DURATION_MIN_H, AUTO_BREAK_DURATION_MAX_H);
    const restartAt = new Date(Date.now() + breakMs);
    autoBreakRestartAt = restartAt;

    await sendToAllowedChat(
      `Автоперерыв: ${selectedScriptName} работал ${formatHours(activeMs)}ч.\n` +
      `Перерыв на ${formatHours(breakMs)}ч. Перезапуск в: ${formatDate(restartAt)}`
    );

    // Если в окно перерыва попадает мисттаунское событие, поднимаем сценарий заранее, но НЕ
    // фармить: FARM_START_AFTER держит его в режиме ожидания (только событие), а квесты и фарм
    // включатся ровно в конце перерыва -- тем же процессом, без отдельного перезапуска.
    const event = findMisttownEventInWindow(Date.now(), restartAt.getTime());
    if (event) {
      const wakeAt = event.at - MISTTOWN_EARLY_WAKE_MS;
      const delayMs = Math.max(60 * 1000, wakeAt - Date.now());
      autoBreakRestartAt = new Date(Date.now() + delayMs);

      await sendToAllowedChat(
        `В перерыв попадает мисттаунское событие (${event.theme}) в ${formatDate(new Date(event.at))}.\n` +
        `Подниму браузер в ${formatDate(autoBreakRestartAt)} только ради него, без фарма.\n` +
        `Квесты и фарм начнутся как и планировалось: ${formatDate(restartAt)}`
      );

      autoBreakTimerId = setTimeout(async () => {
        autoBreakTimerId = null;
        autoBreakRestartAt = null;

        await runSelectedScript('мисттаунское событие во время перерыва', {
          FARM_START_AFTER: String(restartAt.getTime()),
        });
      }, delayMs);
      return;
    }

    autoBreakTimerId = setTimeout(async () => {
      autoBreakTimerId = null;
      autoBreakRestartAt = null;

      await runSelectedScript('авто-перезапуск после перерыва');
    }, breakMs);
  }, activeMs);
}

function clearAutoBreakTimer() {
  if (autoBreakTimerId) {
    clearTimeout(autoBreakTimerId);
    autoBreakTimerId = null;
  }
  autoBreakRestartAt = null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatDate(value) {
  if (!value) return 'не задано';
  const d = new Date(value);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
}

function getStatusText() {
  return [
    `Статус: ${isRunning ? 'активен' : (isPaused ? 'на паузе' : 'остановлен')}`,
    `Сценарий: ${selectedScriptName || 'не выбран'}`,
    `Задержка старта: ${selectedStartDelayHours ? `${selectedStartDelayHours} ч` : 'не задана'}`,
    `Плановый старт квестов/фарма: ${formatDate(plannedStartAt)}`,
    `Последний запуск: ${formatDate(lastRunStartedAt)}`,
    `Последнее завершение: ${formatDate(lastRunFinishedAt)}`,
    `Результат: ${lastRunResult}`,
    ...(autoBreakRestartAt ? [`Авто-перезапуск в: ${formatDate(autoBreakRestartAt)}`] : []),
  ].join('\n');
}

function tgRequest(method, payload = {}) {
  return new Promise((resolve, reject) => {
    const jsonBody = JSON.stringify(payload || {});

    const run = async () => {
      const proxied = await tgRequestRawJson(method, payload);
      if (proxied) return proxied;

      let targets = [];
      try {
        targets = await dns.promises.lookup('api.telegram.org', { all: true, verbatim: true });
      } catch (e) {
        targets = [];
      }

      if (!Array.isArray(targets) || targets.length === 0) {
        targets = [{ address: 'api.telegram.org', family: 0 }];
      }

      const tried = [];
      const maxAttempts = Math.max(4, Math.min(10, targets.length * 2));

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const t = targets[(attempt - 1) % targets.length];
        const hostLabel = t.family ? `${t.address} (IPv${t.family})` : String(t.address);
        tried.push(hostLabel);

        try {
          const parsed = await new Promise((resolve2, reject2) => {
            const req = https.request(
              {
                method: 'POST',
                hostname: t.address,
                servername: 'api.telegram.org',
                path: `/bot${BOT_TOKEN}/${method}`,
                headers: {
                  Host: 'api.telegram.org',
                  'Content-Type': 'application/json; charset=utf-8',
                  'Content-Length': Buffer.byteLength(jsonBody, 'utf8'),
                  Connection: 'close',
                },
                timeout: 60000,
              },
              (res) => {
                let raw = '';
                res.setEncoding('utf8');
                res.on('data', (chunk) => {
                  raw += chunk;
                });
                res.on('end', () => {
                  const trimmed = String(raw || '').trim();
                  if (!trimmed) {
                    reject2(new Error('Пустой ответ от Telegram'));
                    return;
                  }
                  try {
                    resolve2(JSON.parse(trimmed));
                  } catch (e) {
                    reject2(new Error(`Неверный JSON от Telegram: ${trimmed}`));
                  }
                });
              }
            );

            req.on('timeout', () => {
              try { req.destroy(new Error('timeout')); } catch (e) { /* ignore */ }
            });
            req.on('error', (err) => reject2(err));

            req.write(jsonBody);
            req.end();
          });

          if (parsed && parsed.ok === false) {
            throw new Error(`${method} failed: ${JSON.stringify(parsed)}`);
          }

          return parsed;
        } catch (e) {
          if (!isTransientNetworkError(e)) {
            throw e;
          }
          // small backoff
          await sleep(Math.min(15000, 800 * attempt));
        }
      }

      throw new Error(`Telegram request timed out (tried: ${tried.join(', ')})`);
    };

    run()
      .then((parsed) => {
        if (parsed && parsed.ok === false) {
          reject(new Error(`${method} failed: ${JSON.stringify(parsed)}`));
          return;
        }
        if (parsed && Object.prototype.hasOwnProperty.call(parsed, 'result')) {
          resolve(parsed.result);
          return;
        }
        resolve(parsed);
      })
      .catch(reject);
  });
}

async function sendMessage(chatId, text) {
  return tgRequest('sendMessage', {
    chat_id: String(chatId),
    text,
    reply_markup: KEYBOARD,
  });
}

async function sendToAllowedChat(text) {
  try {
    await sendMessage(ALLOWED_CHAT_ID, text);
  } catch (error) {
    console.error('Telegram send error:', error.message);
  }
}

function tgSendPhoto(chatId, photoPath, caption = '') {
  return new Promise((resolve, reject) => {
    const resolvedPath = path.isAbsolute(photoPath) ? photoPath : path.resolve(__dirname, photoPath);
    if (!fs.existsSync(resolvedPath)) {
      reject(new Error(`Photo not found: ${resolvedPath}`));
      return;
    }

    const boundary = `----lbastbot_${Math.random().toString(16).slice(2)}`;
    const crlf = '\r\n';
    const filename = path.basename(resolvedPath);
    const safeCaption = String(caption || '');

    const parts = [];
    parts.push(
      `--${boundary}${crlf}` +
      `Content-Disposition: form-data; name="chat_id"${crlf}${crlf}` +
      `${String(chatId)}${crlf}`
    );
    if (safeCaption) {
      parts.push(
        `--${boundary}${crlf}` +
        `Content-Disposition: form-data; name="caption"${crlf}${crlf}` +
        `${safeCaption}${crlf}`
      );
    }
    parts.push(
      `--${boundary}${crlf}` +
      `Content-Disposition: form-data; name="photo"; filename="${filename}"${crlf}` +
      `Content-Type: image/png${crlf}${crlf}`
    );

    const ending = `${crlf}--${boundary}--${crlf}`;

    const req = https.request(
      {
        method: 'POST',
        hostname: 'api.telegram.org',
        path: `/bot${BOT_TOKEN}/sendPhoto`,
        headers: {
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
        },
      },
      (res) => {
        let raw = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          raw += chunk;
        });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(raw || '{}');
            if (parsed && parsed.ok === false) {
              reject(new Error(`sendPhoto failed: ${raw}`));
              return;
            }
            resolve(parsed.result || parsed);
          } catch (e) {
            reject(new Error(`sendPhoto bad JSON: ${raw}`));
          }
        });
      }
    );

    req.on('error', (err) => reject(err));

    for (const p of parts) req.write(p);

    const stream = fs.createReadStream(resolvedPath);
    stream.on('error', (err) => {
      try { req.destroy(err); } catch (e) { /* ignore */ }
      reject(err);
    });
    stream.on('end', () => {
      req.write(ending);
      req.end();
    });
    stream.pipe(req, { end: false });
  });
}

async function sendPhotoToAllowedChat(photoPath, caption = '') {
  try {
    await tgSendPhoto(ALLOWED_CHAT_ID, photoPath, caption);
  } catch (error) {
    console.error('Telegram photo send error:', error.message);
    // Fallback to plain text, so we at least notify.
    const hint = photoPath ? `\n(скрин: ${photoPath})` : '';
    await sendToAllowedChat(`${caption || 'ALERT: Attack detected.'}${hint}`);
  }
}

function clearStartTimer() {
  if (startTimerId) {
    clearTimeout(startTimerId);
    startTimerId = null;
  }
  plannedStartAt = null;
}

function safeFilenamePart(value) {
  const raw = String(value || '').trim();
  if (!raw) return 'run';
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

function openRunLogStream(scriptName, startedAt) {
  if (!LOG_ENABLED) {
    currentLogStream = null;
    currentLogPath = null;
    return;
  }

  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    const ts = formatTimestampForFilename(startedAt);
    const base = safeFilenamePart(scriptName);
    currentLogPath = path.join(LOG_DIR, `${ts}__${base}.log`);
    currentLogStream = fs.createWriteStream(currentLogPath, { flags: 'a', encoding: 'utf8' });
    currentLogStream.write(`=== START ${new Date(startedAt).toISOString()} | ${scriptName} ===\n`);
  } catch (e) {
    currentLogStream = null;
    currentLogPath = null;
    console.error(`Could not open log file: ${e.message}`);
  }
}

function closeRunLogStream(exitInfo) {
  if (!currentLogStream) {
    currentLogPath = null;
    return;
  }

  try {
    const suffix = exitInfo ? ` | ${exitInfo}` : '';
    currentLogStream.write(`=== END ${new Date().toISOString()}${suffix} ===\n`);
    currentLogStream.end();
  } catch (e) {
    // ignore
  } finally {
    currentLogStream = null;
    currentLogPath = null;
  }
}

function writeRunLogLine(kind, line) {
  if (!currentLogStream) return;
  try {
    const ts = new Date().toISOString();
    currentLogStream.write(`[${ts}] [${kind}] ${line}\n`);
  } catch (e) {
    // ignore
  }
}

async function maybeSendExplicitPvpAlert(lineText) {
  if (!ENABLE_PVP_ALERTS || pvpAlertSentForCurrentRun) return;

  const text = String(lineText || '').trim();
  const match = text.match(/^PVP_ALERT:([A-Za-z0-9+/=]+)$/);
  if (!match) return;

  try {
    const decoded = Buffer.from(match[1], 'base64').toString('utf8');
    const payload = JSON.parse(decoded);

    const enemyNick = String(payload.enemyNick || 'unknown');
    const source = String(payload.source || 'unknown');
    const fragment = String(payload.fragment || '').slice(0, 1200);

    pvpAlertSentForCurrentRun = true;

    await sendToAllowedChat(
      `ALERT: PvP обнаружен.\n` +
      `Сценарий: ${selectedScriptName || 'не выбран'}\n` +
      `Враг: ${enemyNick}\n` +
      `Источник: ${source}\n\n` +
      `Фрагмент:\n${fragment}`
    );
  } catch (error) {
    console.error('maybeSendExplicitPvpAlert parse error:', error.message);
  }
}

async function maybeSendMailMessage(lineText) {
  const text = String(lineText || '').trim();
  const match = text.match(/^MAIL_MESSAGE:([A-Za-z0-9+/=]+)$/);
  if (!match) return;

  try {
    const decoded = Buffer.from(match[1], 'base64').toString('utf8');
    const payload = JSON.parse(decoded);

    const sender = String(payload.sender || 'Unknown').trim();
    const body = String(payload.body || '').trim();

    const header = `Почта\nОт: ${sender}\nТекст:\n`;
    const maxBodyLength = Math.max(0, 3800 - header.length);
    const message = header + body.slice(0, maxBodyLength);

    await sendToAllowedChat(message);
  } catch (error) {
    console.error('maybeSendMailMessage parse error:', error.message);
  }
}

async function maybeSendAttackAlert(lineText) {
  const text = String(lineText || '').trim();
  const match = text.match(/^ATTACK_ALERT:([A-Za-z0-9+/=]+)$/);
  if (!match) return;

  try {
    const decoded = Buffer.from(match[1], 'base64').toString('utf8');
    const payload = JSON.parse(decoded);

    const attackerNick = String(payload.attackerNick || 'unknown');
    const occurredAt = String(payload.occurredAt || '');
    const reason = String(payload.reason || '');
    const fragment = String(payload.fragment || '').slice(0, 800);
    const screenshotPath = String(payload.screenshotPath || '').trim();

    const header =
      `ALERT: Нападение.\n` +
      `Сценарий: ${selectedScriptName || 'не выбран'}\n` +
      `Атакует: ${attackerNick}\n` +
      (occurredAt ? `Время: ${occurredAt}\n` : '') +
      (reason ? `Причина: ${reason}\n` : '');

    // Telegram caption limit is 1024 chars; keep margin.
    const caption = (header + `\nФрагмент:\n${fragment}`).slice(0, 950);

    if (screenshotPath) {
      await sendPhotoToAllowedChat(screenshotPath, caption);
    } else {
      await sendToAllowedChat(caption);
    }
  } catch (error) {
    console.error('maybeSendAttackAlert parse error:', error.message);
  }
}

async function maybeSendMorningScreenshot(lineText) {
  const text = String(lineText || '').trim();
  const match = text.match(/^MORNING_SCREENSHOT:([A-Za-z0-9+/=]+)$/);
  if (!match) return;

  try {
    const decoded = Buffer.from(match[1], 'base64').toString('utf8');
    const payload = JSON.parse(decoded);

    const occurredAt = String(payload.occurredAt || '');
    const screenshotPath = String(payload.screenshotPath || '').trim();

    const caption =
      'Доброе утро! Уличный зазывала (Стоунгард -> Центральная площадь).' +
      (occurredAt ? `\nВремя: ${occurredAt}` : '');

    if (screenshotPath) {
      await sendPhotoToAllowedChat(screenshotPath, caption);
    } else {
      await sendToAllowedChat(caption);
    }
  } catch (error) {
    console.error('maybeSendMorningScreenshot parse error:', error.message);
  }
}

async function runSelectedScript(reason = 'вручную', extraEnv = {}) {
  if (!selectedScriptPath || !selectedScriptName) {
    await sendToAllowedChat('Сценарий не выбран. Выберите сценарий перед запуском.');
    return;
  }

  if (isRunning) {
    await sendToAllowedChat('Сценарий уже запущен. Дождитесь завершения или остановите его.');
    return;
  }

  isRunning = true;
  // Флаг паузы переживает перезапуск процесса: если он всё ещё стоит (сценарий подняли после
  // автоперерыва, пока пауза не снята), запустившийся сценарий сразу встанет -- статус это
  // показывает честно, а не "активен".
  isPaused = isPauseFlagSet();
  pvpAlertSentForCurrentRun = false;
  isAutoBreakStop = false;
  currentRunExtraEnv = { ...extraEnv };
  clearStartTimer();
  scheduleAutoBreak();

  lastRunStartedAt = new Date();
  lastRunResult = `Запуск: ${selectedScriptName}, причина: ${reason}`;

  openRunLogStream(selectedScriptName, lastRunStartedAt);
  if (currentLogPath) {
    writeRunLogLine('manager', `Reason: ${reason}`);
    writeRunLogLine('manager', `Script: ${selectedScriptPath}`);
  }

  await sendToAllowedChat(
    `Запуск сценария: ${selectedScriptName}\n` +
    `Причина: ${reason}\n` +
    `Начало: ${formatDate(lastRunStartedAt)}\n` +
    `Работает до остановки (автоперерыв 6ч каждые 18ч).`
  );

  const fullScriptPath = path.resolve(__dirname, selectedScriptPath);
  currentProcess = spawn('node', [fullScriptPath], {
    cwd: __dirname,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
    env: { ...process.env, ...selectedScriptEnv, ...extraEnv },
  });

  let stdoutLineRemainder = '';
  let stderrLineRemainder = '';
  let stdoutBuffer = '';
  let stderrBuffer = '';

  currentProcess.stdout.on('data', async (data) => {
    const text = data.toString();
    stdoutBuffer += text;
    stdoutLineRemainder += text;

    const lines = stdoutLineRemainder.split(/\r?\n/);
    stdoutLineRemainder = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;
      console.log(line);
      writeRunLogLine('stdout', line);
      await maybeSendExplicitPvpAlert(line).catch(() => {});
      await maybeSendMailMessage(line).catch(() => {});
      await maybeSendAttackAlert(line).catch(() => {});
      await maybeSendMorningScreenshot(line).catch(() => {});
    }
  });

  currentProcess.stderr.on('data', async (data) => {
    const text = data.toString();
    stderrBuffer += text;
    stderrLineRemainder += text;

    const lines = stderrLineRemainder.split(/\r?\n/);
    stderrLineRemainder = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;
      console.error(line);
      writeRunLogLine('stderr', line);
      await maybeSendExplicitPvpAlert(line).catch(() => {});
      await maybeSendMailMessage(line).catch(() => {});
      await maybeSendAttackAlert(line).catch(() => {});
      await maybeSendMorningScreenshot(line).catch(() => {});
    }
  });

  currentProcess.on('close', async (code, signal) => {
    isRunning = false;
    lastRunFinishedAt = new Date();

    const wasAutoBreak = isAutoBreakStop;
    isAutoBreakStop = false;

    // If stopped for the 18h auto-break, don't send error/stop message — break handler already notified.
    if (wasAutoBreak) {
      lastRunResult = `Авто-перерыв: ${selectedScriptName}`;
      closeRunLogStream(`code=${code}, signal=${signal || ''}, autobreak`);
      currentProcess = null;
      return;
    }

    clearAutoBreakTimer();

    const stoppedBySignal = signal === 'SIGTERM' || signal === 'SIGINT';

    if (code === 0) {
      lastRunResult = `Успешно завершен: ${selectedScriptName}`;
      await sendToAllowedChat(`Сценарий завершился: ${selectedScriptName}\nВремя: ${formatDate(lastRunFinishedAt)}`);
    } else if (stoppedBySignal) {
      lastRunResult = `Прерван: ${selectedScriptName}`;
      await sendToAllowedChat(`Сценарий прерван: ${selectedScriptName}\nСигнал: ${signal}\nВремя: ${formatDate(lastRunFinishedAt)}`);
    } else {
      lastRunResult = `Ошибка ${selectedScriptName}, код ${code}`;
      const fragment = (stderrBuffer || stdoutBuffer || 'Нет вывода').slice(0, 3500);
      await sendToAllowedChat(
        `Сценарий завершился с ошибкой: ${selectedScriptName}\n` +
        `Код: ${code}\n` +
        `Время: ${formatDate(lastRunFinishedAt)}\n\n` +
        `Фрагмент:\n${fragment}`
      );
    }

    closeRunLogStream(`code=${code}, signal=${signal || ''}`);
    currentProcess = null;
  });

  currentProcess.on('error', async (error) => {
    isRunning = false;
    lastRunFinishedAt = new Date();
    lastRunResult = `Ошибка запуска: ${error.message}`;
    currentProcess = null;
    closeRunLogStream(`spawn_error=${error.message}`);

    await sendToAllowedChat(`Не удалось запустить сценарий ${selectedScriptName}\nОшибка: ${error.message}`);
  });
}

// Раньше отложенный старт буквально ждал N часов и только потом поднимал браузер/скрипт --
// из-за этого всё, что должно случиться ДО этого момента (например, мисттаунское событие
// "призрак ворот" ночью в 01:29, а обычный отложенный старт в 6ч с 21:00 приходится на 3:00),
// просто пропускалось. Теперь процесс запускается СРАЗУ, но получает env FARM_START_AFTER --
// метку времени, до которой сам скрипт (см. daily_quests_piraty.js) не трогает квесты/фарм и
// только ждёт да ловит мисттаунские события, а по достижении этой метки сам переключается в
// обычный режим без перезапуска. Так "ночной режим" всегда активен как часть любого отложенного
// старта, без отдельной кнопки.
function scheduleDelayedStart() {
  clearStartTimer();
  if (!selectedStartDelayHours || !selectedScriptPath) {
    return false;
  }

  plannedStartAt = new Date(Date.now() + selectedStartDelayHours * 60 * 60 * 1000);

  runSelectedScript('отложенный старт', { FARM_START_AFTER: String(plannedStartAt.getTime()) });

  return true;
}

function isPauseFlagSet() {
  try { return fs.existsSync(PAUSE_FLAG_PATH); } catch (e) { return false; }
}

async function pauseScenario() {
  if (isPauseFlagSet()) {
    isPaused = true;
    await sendToAllowedChat('Сценарий уже на паузе.');
    return;
  }

  try {
    fs.writeFileSync(PAUSE_FLAG_PATH, new Date().toISOString());
  } catch (e) {
    await sendToAllowedChat(`Не удалось поставить паузу: ${e.message}`);
    return;
  }

  isPaused = true;
  await sendToAllowedChat(
    isRunning
      ? 'Пауза. Сценарий доигрывает текущий шаг и встаёт, браузер остаётся открытым -- можно играть самому в том же окне.\n' +
        'Отсчёт до автоперерыва продолжает идти. Вернуть управление боту -- "Продолжить".'
      : 'Пауза поставлена. Сценарий сейчас не запущен, но если он поднимется (например, после автоперерыва), то сразу встанет на паузу.'
  );
}

async function resumeScenario() {
  const hadFlag = isPauseFlagSet();
  if (hadFlag) {
    try {
      fs.unlinkSync(PAUSE_FLAG_PATH);
    } catch (e) {
      await sendToAllowedChat(`Не удалось снять паузу: ${e.message}`);
      return;
    }
  }
  isPaused = false;

  // Процесс жив -- он сам увидит снятый флаг на ближайшей проверке, перезапускать ничего не нужно.
  if (isRunning) {
    await sendToAllowedChat('Продолжаю: сценарий снова работает, браузер тот же.');
    return;
  }

  if (!selectedScriptPath || !selectedScriptName) {
    await sendToAllowedChat('Сценарий не выбран. Выберите сценарий перед запуском.');
    return;
  }

  // Процесса нет (его успел убить автоперерыв или "Стоп") -- поднимаем в том же режиме: если пауза
  // застала ожидание отложенного старта и время фарма ещё не пришло, снова отдаём FARM_START_AFTER.
  const extraEnv = { ...currentRunExtraEnv };
  if (extraEnv.FARM_START_AFTER && Number(extraEnv.FARM_START_AFTER) <= Date.now()) {
    delete extraEnv.FARM_START_AFTER;
  }

  await runSelectedScript(hadFlag ? 'продолжение после паузы' : 'вручную', extraEnv);
}

async function stopEverything() {
  clearStartTimer();
  clearAutoBreakTimer();

  selectedStartDelayHours = null;
  // Полная остановка -- это не пауза: снимаем и флаг, чтобы следующий запуск не встал сразу же.
  isPaused = false;
  currentRunExtraEnv = {};
  try { fs.unlinkSync(PAUSE_FLAG_PATH); } catch (e) { /* флага и не было */ }

  if (currentProcess && isRunning) {
    currentProcess.kill('SIGTERM');
    await sendToAllowedChat('Скрипт остановлен вручную.');
  } else {
    await sendToAllowedChat('Нет активного запуска. Параметры сброшены.');
  }
}

async function handleText(chatId, text) {
  const trimmed = String(text || '').trim();

  if (trimmed === '/start') {
    await sendMessage(chatId, 'Управление автокачкой\n\n' + getStatusText());
    return;
  }

  if (Object.prototype.hasOwnProperty.call(SCRIPTS, trimmed)) {
    selectedScriptName = trimmed;
    selectedScriptPath = SCRIPTS[trimmed].path;
    selectedScriptEnv = SCRIPTS[trimmed].env || {};
    await sendMessage(chatId, `Выбран сценарий: ${selectedScriptName}`);
    return;
  }

  if (Object.prototype.hasOwnProperty.call(START_DELAYS, trimmed)) {
    selectedStartDelayHours = START_DELAYS[trimmed];
    await sendMessage(chatId, `Задержка старта: ${selectedStartDelayHours} ч.`);
    await tryScheduleIfReady(chatId);
    return;
  }

  if (trimmed === 'Запустить сейчас') {
    await runSelectedScript('вручную');
    return;
  }

  if (trimmed === 'Пауза') {
    await pauseScenario();
    return;
  }

  if (trimmed === 'Продолжить') {
    await resumeScenario();
    return;
  }

  if (trimmed === 'Статус') {
    await sendMessage(chatId, getStatusText());
    return;
  }

  if (trimmed === 'Стоп') {
    await stopEverything();
    return;
  }

  await sendMessage(chatId, 'Команда не распознана, используйте клавиатуру.');
}

function hasScheduleParams() {
  return Boolean(selectedScriptPath && selectedStartDelayHours);
}

async function tryScheduleIfReady(chatId) {
  if (!hasScheduleParams()) {
    return;
  }

  if (isRunning) {
    await sendMessage(chatId, 'Скрипт уже работает. Остановите его перед перенастройкой.');
    return;
  }

  if (scheduleDelayedStart()) {
    await sendMessage(
      chatId,
      `Браузер запускаю сейчас (чтобы не пропустить мисттаунское событие), а квесты/фарм начнутся в ${formatDate(plannedStartAt)}.`
    );
  }
}

async function processUpdate(update) {
  const message = update.message;
  if (!message) return;

  const chatId = String(message.chat?.id || '');
  const text = message.text || '';

  if (chatId !== ALLOWED_CHAT_ID) {
    try {
      await sendMessage(chatId, 'Доступ запрещен.');
    } catch (error) {
      // Игнорируем ошибку отправки.
    }
    return;
  }

  await handleText(chatId, text);
}

async function pollOnce() {
  if (pollBusy) return;
  pollBusy = true;

  try {
    const updates = await tgRequest('getUpdates', {
      offset: lastUpdateId + 1,
      timeout: 25,
      allowed_updates: ['message'],
    });

    for (const update of updates) {
      lastUpdateId = update.update_id;
      await processUpdate(update);
    }

    // Long-polling already waits; keep a small delay to avoid tight loops on empty updates.
    pollDelayMs = 200;
  } catch (error) {
    console.error('polling_error:', error.message);
    const msg = String(error.message || '');
    // 409 Conflict happens when Telegram still has our previous long-poll request in flight
    // (e.g. after a brief network drop) — it self-clears once that request times out server-side.
    // Retrying every 2s just spams identical 409s until then, so back off longer for it.
    if (/истекло/i.test(msg)) {
      pollDelayMs = 10000;
    } else if (/"error_code":409/.test(msg)) {
      pollDelayMs = 15000;
    } else {
      pollDelayMs = 2000;
    }
  } finally {
    pollBusy = false;
  }
}

async function pollLoop() {
  while (pollingActive) {
    await pollOnce();
    await sleep(pollDelayMs);
  }
}

async function main() {
  console.log('manager_bot.js started');

  try {
    await tgRequest('deleteWebhook', { drop_pending_updates: true });
    console.log('Вебхук удален или отсутствует');
  } catch (error) {
    console.error('deleteWebhook warning:', error.message);
  }

  pollLoop().catch((error) => {
    console.error('fatal_polling_error:', error.message);
  });
}

process.on('SIGINT', () => {
  pollingActive = false;
  clearStartTimer();
  clearAutoBreakTimer();

  if (currentProcess && isRunning) {
    currentProcess.kill('SIGTERM');
  }

  process.exit(0);
});

main().catch((error) => {
  console.error('fatal_start_error:', error.message);
});
