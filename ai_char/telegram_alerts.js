// Оповещения Паше в Telegram о нестандартных случаях (Паша, 19.09.2026: уменьшить расход токенов —
// драйвер сам сообщает о поломках, вместо того чтобы монитор будил Claude на каждое событие).
// Токен и чат берутся только из окружения (.env в корне, подключается в driver.js через dotenv).
// Бот тот же, что у manager_bot.js: отправка sendMessage не мешает его getUpdates-опросу.

const ALERT_PATTERNS = [
  /выбыл из строя|погиб/i,
  /Error:|is not defined|Cannot find module|Quest step error/,
  /Фарм-сессия упала/,
  /задание не выдали|до боя не дошёл/,
  /маршрут остановился/,
  /^Кухня: (не получилось|ошибка)/,
  /^Дейлик: .*(проиграл|маршрут не пройден)/,
  /Could not open Life Tree/,
  /CHAT_SEND_FAILED|Автоответ: (ошибка|отказ)/,
  /already in use/,
];
const IGNORE_PATTERNS = [
  /Cycle error: page\.goto: Timeout/,
  /Cycle error: page\.goto: net::ERR_ABORTED/,
  /fight_not_reached/,
];

const DEDUP_MS = 30 * 60 * 1000;
const MAX_PER_HOUR = 12;
const recent = new Map(); // нормализованный текст -> время отправки
let sentTimes = [];

function normalizeForDedup(line) {
  return String(line).replace(/\d+/g, '#').slice(0, 160);
}

async function sendTelegram(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return false;
  const now = Date.now();
  sentTimes = sentTimes.filter((t) => now - t < 60 * 60 * 1000);
  if (sentTimes.length >= MAX_PER_HOUR) return false;
  sentTimes.push(now);
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: `AI__: ${String(text).slice(0, 3500)}`, disable_web_page_preview: true }),
    });
    return res.ok;
  } catch (e) {
    return false; // сеть упала - в лог не пишем, чтобы не зациклиться на собственном оповещении
  }
}

function alertIfNeeded(line) {
  const s = String(line || '');
  if (!s || IGNORE_PATTERNS.some((r) => r.test(s))) return;
  if (!ALERT_PATTERNS.some((r) => r.test(s))) return;
  const key = normalizeForDedup(s);
  const now = Date.now();
  const last = recent.get(key);
  if (last && now - last < DEDUP_MS) return;
  recent.set(key, now);
  sendTelegram(s).catch(() => {});
}

// Перехватывает console.log драйвера: каждая строка проверяется по ALERT_PATTERNS. Плюс сторож:
// если лог молчит дольше stallMs - драйвер завис (раньше это ловил только монитор Claude).
function installAlertHook({ stallMs = 15 * 60 * 1000 } = {}) {
  let lastLogAt = Date.now();
  let stallReported = false;
  const orig = console.log.bind(console);
  console.log = (...args) => {
    lastLogAt = Date.now();
    stallReported = false;
    orig(...args);
    try {
      const text = args.map((a) => (typeof a === 'string' ? a : String(a))).join(' ');
      for (const l of text.split('\n')) alertIfNeeded(l.trim());
    } catch (e) { /* оповещение не должно ронять драйвер */ }
  };
  const timer = setInterval(() => {
    const idle = Date.now() - lastLogAt;
    if (idle > stallMs && !stallReported) {
      stallReported = true;
      sendTelegram(`лог молчит ${Math.round(idle / 60000)} мин - драйвер, похоже, завис.`).catch(() => {});
    }
  }, 60 * 1000);
  timer.unref();
  process.on('uncaughtException', (e) => {
    sendTelegram(`драйвер упал: ${e && e.message}`).finally(() => process.exit(1));
  });
}

module.exports = { installAlertHook, sendTelegram };
