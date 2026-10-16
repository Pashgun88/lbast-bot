// Опыт и прогноз следующего уровня.
// 16.10.2026, Паша: «проследи за своим прогрессом опыта, сниаю раз в день, прикинь когда примерно
// след уровень, чтобы взять новый шмот в аренду». Смысл задачи - не сам опыт, а СРОК: аренду
// снаряжения надо успеть взять к уровню, а не после него.
//
// Где читать (замер живьём 16.10.2026): pers.php, строка «Опыт: 912.427 (осталось 287.573)».
// Точка в числах - разделитель тысяч, а не дробь: 912.427 + 287.573 = 1.200.000 ровно, то есть
// следующий уровень на круглом миллионе двухсот тысячах. Поэтому точки при разборе убираем.

// Экспорт стоит ДО require: файлы lib/ вызывают друг друга по кругу, а объявления функций
// всплывают (hoisting), поэтому к моменту любого встречного require все функции уже здесь.
module.exports = {
  runExpSnapshotIfDue, readExpLog, parseExpLine, expForecast, formatForecast,
};

const fs = require('fs');
const path = require('path');
const { S, getDayKeyNow, persistDailyQuestState } = require('./state');
const { getBodyText } = require('./core');

const LOG_FILE = path.join(__dirname, '..', 'exp_log.jsonl');

// «Опыт: 912.427 (осталось 287.573)». Числа бывают и без точки, пока они меньше тысячи.
const EXP_RE = /Опыт:\s*([\d.]+)\s*\(осталось\s*([\d.]+)\)/i;

function toNumber(raw) {
  return Number(String(raw || '').replace(/\./g, '')) || 0;
}

function parseExpLine(text) {
  const m = String(text || '').match(EXP_RE);
  if (!m) return null;
  return { exp: toNumber(m[1]), left: toNumber(m[2]), raw: m[0] };
}

function readExpLog() {
  try {
    return fs.readFileSync(LOG_FILE, 'utf8').split('\n').filter(Boolean)
      .map((l) => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean);
  } catch (e) { return []; }
}

// Прогноз. Скорость считаем по первой и последней записям за последние 14 суток: один день - это
// слишком случайно (в один день квест, в другой простой), а месяц уже не отражает текущий фарм.
function expForecast(points = readExpLog()) {
  if (points.length === 0) return null;
  const last = points[points.length - 1];
  const horizon = 14 * 24 * 3600 * 1000;
  const usable = points.filter((p) => last.ts - p.ts <= horizon);
  const first = usable[0];
  if (!first || usable.length < 2 || last.ts === first.ts) {
    return { last, perDay: null, days: null, note: 'замер пока один - скорость будет известна со второго дня' };
  }
  const days = (last.ts - first.ts) / (24 * 3600 * 1000);
  const perDay = (last.exp - first.exp) / days;
  if (perDay <= 0) {
    return { last, perDay, days: null, note: 'опыт не растёт - прогноз не считается' };
  }
  const daysLeft = last.left / perDay;
  const when = new Date(last.ts + daysLeft * 24 * 3600 * 1000);
  return { last, perDay, days: daysLeft, when, measuredOver: days, points: usable.length };
}

function formatForecast(f = expForecast()) {
  if (!f) return 'Опыт: замеров ещё нет.';
  const { last } = f;
  const head = `Опыт ${last.exp.toLocaleString('ru-RU')}, до уровня осталось ${last.left.toLocaleString('ru-RU')}`;
  if (!f.days) return `${head}. ${f.note}.`;
  const d = Math.round(f.days * 10) / 10;
  return `${head}. Скорость ${Math.round(f.perDay).toLocaleString('ru-RU')} в сутки (по ${f.points} замерам за ${Math.round(f.measuredOver * 10) / 10} дн.)`
    + ` -> уровень примерно через ${d} дн., около ${f.when.toLocaleDateString('ru-RU')}.`;
}

// Замер раз в сутки. Паша: «сниаю раз в день» - чаще незачем, суточный прирост и так шумный.
async function runExpSnapshotIfDue(page) {
  const day = getDayKeyNow();
  if (S.expDayKey === day) return false;
  await page.goto('http://lbast.ru/pers.php', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  const text = (await getBodyText(page).catch(() => '')).replace(/\s+/g, ' ');
  const got = parseExpLine(text);
  if (!got) {
    // Не ставим отметку дня: страница могла не открыться, попробуем в следующем круге.
    console.log(`Опыт: строку «Опыт: N (осталось M)» на pers.php не нашёл. Начало страницы: ${text.slice(0, 200)}`);
    return false;
  }
  S.expDayKey = day;
  try { persistDailyQuestState(); } catch (e) { /* не критично */ }
  const point = { ts: Date.now(), day, exp: got.exp, left: got.left, level: S.charLevel || null };
  fs.appendFileSync(LOG_FILE, JSON.stringify(point) + '\n');
  console.log(formatForecast(expForecast()));
  return true;
}
