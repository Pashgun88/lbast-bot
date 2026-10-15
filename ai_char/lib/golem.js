// Эликсир каменного голема - по просьбе Паши или Ханка, на названного игрока.
// 15.10.2026, Паша: «есть такая вещь - элексир каменного голема. В инвентаре, нажимаешь
// использовать - вводишь ник игрока. Это только по моей просьбе, тут либо в игре. Или по просьбе
// Ханк. Запрет на использование то ли 4 то ли 8 часов... если не пишут во сколько сделать - делай
// сразу. Буду писать например - голем в 16:52:44, нужно точно в это время, если времени нет -
// сразу. Слово голем должно быть как тригер, ты долден быть в игре в это время не занят.»
//
// Отсюда вся конструкция:
// - просьба кладётся в очередь (golem_queue.json): либо мной отсюда, либо разбором чата;
// - очередь проверяется в начале КАЖДОГО цикла драйвера, а не раз в N часов;
// - просьба без времени исполняется сразу, с временем - ровно в эту секунду (ждём её на месте);
// - пока до просьбы меньше GOLEM_CLEAR_AHEAD_MS, драйвер не начинает фарм: «не занят» в
//   названную секунду важнее одного круга фарма.
// Сам эликсир НЕ применялся ни разу: Паша сказал «сейчас не делай», а ссылка mod=prim у некоторых
// предметов срабатывает сразу по GET (на кухне так жарится рыба). Поэтому первое живое применение
// пишет в лог весь ответ страницы - по нему и проверим разбор формы.

// Экспорт стоит ДО require: файлы lib/ вызывают друг друга по кругу, а объявления функций
// всплывают (hoisting), поэтому к моменту любого встречного require все функции уже здесь.
// В объекте ТОЛЬКО функции: const не всплывает, и ссылка на константу здесь падает с
// «Cannot access ... before initialization». На этом же я уже сорвал старт драйвера в lib/brewing.js -
// константы экспортируются ПОСЛЕ объявления, в конце файла.
module.exports = {
  runGolemRequestsIfDue, enqueueGolemRequest, readGolemQueue, golemDueWithinMs,
  parseGolemRequest, classifyGolemMessage, cancelGolemRequests,
};

const fs = require('fs');
const path = require('path');
const { S } = require('./state');
const { getBodyText, pause } = require('./core');

const QUEUE_FILE = path.join(__dirname, '..', 'golem_queue.json');
const ELIXIR_NAME = 'Эликсир каменного голема';
// Триггер - ФРАЗА, а не слово. Паша 15.10.2026 сначала сказал «слово голем должно быть как
// тригер», я ответил, что простое упоминание от просьбы не отличу, и он поправил: «давай лкчше
// сделаем нужен голем». Одно слово «голем» теперь ничего не запускает - только разговор.
const GOLEM_TRIGGER_RE = /(нужен\s+голем|голем\s+нужен)/i;
// Слово само по себе - чтобы заметить упоминание и написать в лог, как я его понял.
const GOLEM_WORD_RE = /голем/i;
// Чьи просьбы исполняем. Паша: «это только по моей просьбе... или по просьбе Ханк». Ник Hank
// подтверждён (сделка по асам 21.09). Ник Паши в игре беру из переменной окружения - угадывать
// нельзя: по чужой просьбе эликсир тратить нельзя вовсе.
// Паша, 15.10.2026: «мой цунами» - его персонаж Tsunami (так ник пишется в логе передач).
const GOLEM_ALLOWED = String(process.env.AI_GOLEM_REQUESTERS || 'Hank,Tsunami,Цунами')
  .split(',').map((x) => x.trim()).filter(Boolean);
const GOLEM_ALLOWED_RE = new RegExp(`^(${GOLEM_ALLOWED.map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})$`, 'i');
// За сколько до назначенной секунды драйвер перестаёт начинать фарм.
const GOLEM_CLEAR_AHEAD_MS = 5 * 60 * 1000;
// Назначенное время прошло больше чем на это - уже не наше дело, просто докладываем.
const GOLEM_LATE_TOLERANCE_MS = 2 * 60 * 1000;

function readGolemQueue() {
  try {
    const q = JSON.parse(fs.readFileSync(QUEUE_FILE, 'utf8'));
    return Array.isArray(q) ? q : [];
  } catch (e) { return []; }
}
function writeGolemQueue(q) {
  fs.writeFileSync(QUEUE_FILE, JSON.stringify(q, null, 1));
}

// Паша, 15.10.2026: «ты отличишь тригер от простого упоминания?» Нет, простое вхождение слова -
// не просьба: «голем уже в кд», «спасибо за голема», «а голем есть?» - это разговор, а эликсир
// один. Поэтому разбор в три исхода, и при любом сомнении выбирается НЕ действие: пропустить
// просьбу я могу переспросить, потраченный эликсир не вернуть.
//
// 'cancel'  - отменить то, что стоит в очереди («отмени голем», «голем не надо»);
// 'request' - просьба применить;
// 'mention' - слово прозвучало, но делать ничего не надо. Пишем в лог, чтобы Паша видел, как я
//             понял его фразу, и мог поправить.
// «не нужен» тоже отказ, и именно его легко забыть: фраза-триггер «нужен голем» в нём почти
// целиком. Поймано тестом test_golem_trigger.js.
const GOLEM_CANCEL_RE = /(отмен|отбой|не надо|не нуж|не кидай|не делай|стоп)/i;

function classifyGolemMessage(text) {
  const t = String(text || '');
  if (!GOLEM_WORD_RE.test(t)) return { kind: 'none' };
  // Отмена проверяется ПЕРВОЙ: «голем не нужен» содержит и фразу-триггер, и отказ, и это отказ.
  if (GOLEM_CANCEL_RE.test(t)) return { kind: 'cancel' };
  if (!GOLEM_TRIGGER_RE.test(t)) return { kind: 'mention', why: 'нет фразы «нужен голем»' };
  // Вопрос - не приказ: «нужен голем?» это вопрос ко мне, а не просьба.
  if (t.includes('?')) return { kind: 'mention', why: 'это вопрос' };
  return { kind: 'request' };
}

// Снять из очереди всё, что ещё не исполнено. Возвращает число снятых просьб.
function cancelGolemRequests() {
  const q = readGolemQueue();
  if (q.length === 0) return 0;
  writeGolemQueue([]);
  return q.length;
}

// «голем в 16:52:44 на Hank», «голем Hank», «голем» - ник и время необязательны.
// Возвращает {target, atMs} или null, если слова-триггера нет.
function parseGolemRequest(text, requester) {
  const t = String(text || '');
  if (!GOLEM_TRIGGER_RE.test(t)) return null;
  // Время: ЧЧ:ММ:СС или ЧЧ:ММ. Относим к сегодняшнему дню; если оно уже прошло - считаем, что
  // просьба на сейчас (Паша: «если времени нет - сразу»).
  let atMs = 0;
  const tm = t.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (tm) {
    const d = new Date();
    d.setHours(Number(tm[1]), Number(tm[2]), Number(tm[3] || 0), 0);
    atMs = d.getTime();
  }
  // Ник: слово после «на» либо единственное латинское слово в строке. Если ника нет - цель сам
  // просящий: он просит голема для себя.
  let target = '';
  // \b перед «на» НЕ РАБОТАЕТ: \w в JavaScript знает только латиницу, у кириллицы границы слова
  // нет, и «голем на Tsunami» разбиралось как просьба без ника. Край строки или не-букву проверяю
  // явно - тот же урок, что с «эль» и гербом в lib/fish_sale.js.
  const onNick = t.match(/(?:^|[^A-Za-zА-Яа-яЁё])на\s+([A-Za-z0-9_-]{2,20})/);
  if (onNick) [, target] = onNick;
  if (!target) {
    // Кандидат в ник обязан содержать букву: иначе «09» и «05» из времени 09:05 считались
    // словами, строка выглядела как «три слова», и ник не находился вовсе.
    const words = (t.match(/[A-Za-z0-9_-]{2,20}/g) || []).filter((w) => /[A-Za-z]/.test(w));
    if (words.length === 1) [target] = words;
  }
  if (!target) target = String(requester || '');
  return { target, atMs };
}

function enqueueGolemRequest({ target, atMs = 0, requester = '', source = '' }) {
  const q = readGolemQueue();
  q.push({ target: String(target || ''), atMs: Number(atMs) || 0, requester, source, addedAt: Date.now() });
  writeGolemQueue(q);
  const when = atMs ? new Date(atMs).toLocaleTimeString('ru-RU') : 'сразу';
  console.log(`Голем: просьба принята - на «${target}», время ${when} (от ${requester || 'Паши'}, ${source || 'напрямую'}).`);
  return q.length;
}

// Есть ли просьба, до которой осталось меньше ms? Нужно драйверу, чтобы не начинать фарм перед
// назначенной секундой.
function golemDueWithinMs(ms) {
  const now = Date.now();
  return readGolemQueue().some((r) => {
    const at = r.atMs || now;
    return at - now <= ms && at - now > -GOLEM_LATE_TOLERANCE_MS;
  });
}

// Найти в сумке эликсир и его живую ссылку «Использовать». href содержит одноразовый r=<число>,
// который меняется при каждой загрузке страницы (замер 15.10.2026: r=5425, потом r=7987), -
// поэтому ссылка читается перед самым применением, а не запоминается.
async function findElixirUseHref(page) {
  for (let p = 1; p <= 8; p += 1) {
    const url = p === 1 ? 'http://lbast.ru/inv.php' : `http://lbast.ru/inv.php?cpage=${p}`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    const text = (await getBodyText(page).catch(() => '')).replace(/\s+/g, ' ');
    if (!/ из \d+ по /.test(text)) break; // шапка «1-15 из 57 по 15» - признак страницы инвентаря
    if (!text.includes(ELIXIR_NAME)) continue;
    const href = await page.evaluate((name) => {
      const as = Array.from(document.querySelectorAll('a'));
      const i = as.findIndex((a) => (a.innerText || '').trim() === name);
      if (i < 0) return null;
      // «Использовать» идёт сразу за ссылкой-названием предмета (снято живьём 15.10.2026).
      for (let k = i + 1; k < Math.min(i + 4, as.length); k += 1) {
        if (/Использовать/i.test(as[k].innerText || '')) return as[k].getAttribute('href');
      }
      return null;
    }, ELIXIR_NAME);
    if (href) return href;
  }
  return null;
}

async function applyGolemElixir(page, target) {
  const href = await findElixirUseHref(page);
  if (!href) {
    console.log(`ГОЛЕМ НЕ СДЕЛАН: «${ELIXIR_NAME}» в сумке не найден (цель «${target}»).`);
    return false;
  }
  await page.goto(new URL(href, 'http://lbast.ru/').href, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await pause(page, 400, 800);
  let text = (await getBodyText(page).catch(() => '')).replace(/\s+/g, ' ');
  // Форма снята живьём 15.10.2026: «Используем эликсир каменного голема. На других воинах могут
  // использовать только члены гильдии травников. Логин: [lgn] (Далее)», метод POST. Открытие
  // ссылки эликсир НЕ расходует - это именно страница формы.
  // Поле ищем по имени: на странице есть и поиск по карте (name=look), и его нельзя путать.
  const field = await page.$('input[name=lgn]');
  if (!field) {
    console.log(`ГОЛЕМ: поля «Логин» (input[name=lgn]) на странице применения нет. Ответ страницы: ${text.slice(0, 400)}`);
    return false;
  }
  await field.fill(String(target));
  const btn = await page.$('input[type=submit]');
  if (btn) await btn.click({ timeout: 10000 }).catch(() => {});
  else await field.press('Enter').catch(() => {});
  await pause(page, 900, 1500);
  text = (await getBodyText(page).catch(() => '')).replace(/\s+/g, ' ');
  // Возможен второй экран с подтверждением - живьём не видел (эликсир один, тратить на пробу
  // нельзя). Если он есть, жмём подтверждение; если нет, просто идём дальше.
  if (/Вы точно|Подтверд/i.test(text)) {
    const yes = await page.$('input[type=submit]');
    if (yes) await yes.click({ timeout: 10000 }).catch(() => {});
    await pause(page, 800, 1400);
  }
  text = (await getBodyText(page).catch(() => '')).replace(/\s+/g, ' ');
  // Запрет на повторное применение Паша помнит как «то ли 4 то ли 8 часов» - точного числа нет,
  // поэтому срок не угадываем: отметку времени ставим, а решает игра, и её ответ идёт в лог.
  S.golemUsedAt = Date.now();
  S.golemLastTarget = String(target);
  console.log(`ГОЛЕМ на «${target}»: ответ игры - ${text.slice(0, 400)}`);
  return true;
}

async function runGolemRequestsIfDue(page) {
  const q = readGolemQueue();
  if (q.length === 0) return false;
  const now = Date.now();
  const due = q.find((r) => (r.atMs || now) - now <= GOLEM_CLEAR_AHEAD_MS);
  if (!due) return false;
  const at = due.atMs || now;
  if (at - now < -GOLEM_LATE_TOLERANCE_MS) {
    console.log(`ГОЛЕМ ПРОСРОЧЕН: просьба на ${new Date(at).toLocaleTimeString('ru-RU')} (цель «${due.target}»), сейчас ${new Date().toLocaleTimeString('ru-RU')} - не применяю, жду слова Паши.`);
    writeGolemQueue(q.filter((r) => r !== due));
    return false;
  }
  // Ждём названную секунду на месте: цикл драйвера длинный, другого способа попасть в точное
  // время нет. Ожидание ограничено GOLEM_CLEAR_AHEAD_MS, то есть пятью минутами.
  while (Date.now() < at - 300) {
    await page.waitForTimeout(Math.min(2000, at - Date.now()));
  }
  writeGolemQueue(q.filter((r) => r !== due));
  return applyGolemElixir(page, due.target);
}

// Константы - после объявления (см. комментарий к module.exports выше).
module.exports.GOLEM_TRIGGER_RE = GOLEM_TRIGGER_RE;
module.exports.GOLEM_ALLOWED_RE = GOLEM_ALLOWED_RE;
module.exports.GOLEM_CLEAR_AHEAD_MS = GOLEM_CLEAR_AHEAD_MS;
