// Напоминалки про аукционы из городской ратуши.
//
// Паша, 21.10.2026: «нужна разведка в городской ратуше - там пишут когда какой аукцион будет,
// каждый обновляется раз в неделю, шли по утрам напоминалки если какой то аукцион в текущий день.
// 2 раз утром в 8-9, второй за 3 часа и последний за 10 минут».
//
// Три напоминания на каждый аукцион дня: утреннее (окно 8-9 по игровому времени суток), за 3 часа
// и за 10 минут. Каждое - по одному разу в день на аукцион, отметки лежат в состоянии, поэтому
// перезапуск драйвера их не сбрасывает.
//
// ЧТО ПОКА НЕ ВЫЯСНЕНО (поэтому чтение доски стоит за флагом AI_AUCTION_WATCH=1):
// страница ратуши (goroda.php?mod=ratusha) 21.10.2026 ответила «Вы уже посещали ратушу сегодня» -
// в тот день там уже сдавались камни работой гражданина (lib/citizen_work.js, 210 дин в сутки).
// Если заход на страницу тратит суточное посещение, разведка отнимала бы у нас этот доход. Пока
// Паша не скажет, как оно устроено, читать доску сама я не даю.

module.exports = { runAuctionRemindersIfDue, parseAuctionBoard, dueReminder };

const { S, persistDailyQuestState } = require('./state');
const { getBodyText } = require('./core');

const BOARD_URL = 'http://lbast.ru/goroda.php?mod=ratusha';
const ENABLED = process.env.AI_AUCTION_WATCH === '1';
const MORNING_FROM = 8;   // утреннее напоминание - в окне 8:00-9:59
const MORNING_TO = 10;
const HOURS_3 = 3 * 60 * 60 * 1000;
const MIN_10 = 10 * 60 * 1000;

const dayKey = (d = new Date()) => d.toLocaleDateString('ru-RU');
const WEEKDAYS = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];

// Строки доски: всё, где есть слово «аукцион» и время. Форму записи в игре я ещё не видел, поэтому
// разбираем обе обычные: «дд-мм-гггг чч:мм» и «<день недели> в чч:мм». Что не разобралось - уходит
// в лог целиком, чтобы дописать шаблон по живому тексту, а не по догадке.
function parseAuctionBoard(text) {
  const out = [];
  const unknown = [];
  for (const raw of String(text || '').split('\n')) {
    const line = raw.replace(/\s+/g, ' ').trim();
    if (!/аукцион/i.test(line)) continue;
    const time = line.match(/(\d{1,2}):(\d{2})/);
    if (!time) { unknown.push(line); continue; }
    const date = line.match(/(\d{1,2})[-.](\d{1,2})[-.](\d{4})/);
    // Основа слова, а не всё слово: в тексте стоит «в среду», «в пятницу» - падежи.
  const wd = WEEKDAYS.findIndex((w) => new RegExp(w.slice(0, 4), 'i').test(line));
    out.push({
      line,
      hh: Number(time[1]),
      mm: Number(time[2]),
      date: date ? `${date[1].padStart(2, '0')}.${date[2].padStart(2, '0')}.${date[3]}` : null,
      weekday: wd >= 0 ? wd : null,
    });
  }
  return { auctions: out, unknown };
}

// Сегодняшний ли это аукцион: либо дата совпала, либо день недели, либо (если в строке нет ни того,
// ни другого) считаем, что доска говорит про ближайший день - такую строку в сегодняшние НЕ берём,
// чтобы не будить Пашу зря.
function isToday(a, now = new Date()) {
  if (a.date) return a.date === dayKey(now);
  if (a.weekday !== null) return a.weekday === now.getDay();
  return false;
}

function whenToday(a, now = new Date()) {
  const d = new Date(now);
  d.setHours(a.hh, a.mm, 0, 0);
  return d.getTime();
}

// Какое напоминание пора послать (или null). Вынесено отдельной функцией, чтобы проверять тестом
// без игры: сроки - это то, где легче всего ошибиться на час.
function dueReminder(a, sentKinds, now = new Date()) {
  const left = whenToday(a, now) - now.getTime();
  if (left <= -MIN_10) return null; // аукцион уже прошёл
  if (left <= MIN_10 && !sentKinds.includes('10м')) return { kind: '10м', text: `через 10 минут` };
  if (left <= HOURS_3 && !sentKinds.includes('3ч')) return { kind: '3ч', text: `через 3 часа` };
  const h = now.getHours();
  if (h >= MORNING_FROM && h < MORNING_TO && !sentKinds.includes('утро')) return { kind: 'утро', text: 'сегодня' };
  return null;
}

async function runAuctionRemindersIfDue(page) {
  if (!ENABLED) return false;
  const today = dayKey();
  if (S.auctionBoardDay !== today) {
    await page.goto(BOARD_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    const text = await getBodyText(page).catch(() => '');
    const { auctions, unknown } = parseAuctionBoard(text);
    S.auctionBoardDay = today;
    S.auctionBoard = auctions;
    S.auctionSent = {};
    persistDailyQuestState();
    if (unknown.length) console.log(`Аукционы: строки без времени, разобрать не смог: ${unknown.join(' // ')}`);
    console.log(`Аукционы: доска прочитана, записей с временем ${auctions.length}${auctions.length ? ': ' + auctions.map((a) => a.line).join(' // ') : ''}.`);
  }

  const board = Array.isArray(S.auctionBoard) ? S.auctionBoard : [];
  let sentAny = false;
  for (const a of board) {
    if (!isToday(a)) continue;
    const key = `${a.hh}:${String(a.mm).padStart(2, '0')}`;
    const sent = (S.auctionSent && S.auctionSent[key]) || [];
    const due = dueReminder(a, sent);
    if (!due) continue;
    S.auctionSent = S.auctionSent || {};
    S.auctionSent[key] = [...sent, due.kind];
    persistDailyQuestState();
    // Строка уходит в Telegram: шаблон /^АУКЦИОН/ в telegram_alerts.js.
    console.log(`АУКЦИОН ${due.text} (${key}): ${a.line}`);
    sentAny = true;
  }
  return sentAny;
}
