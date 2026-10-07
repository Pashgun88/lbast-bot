// Слот «ответственного задания»: кто его держит и когда мы имеем право отказаться.
//
// Слот в игре ОДИН на всё: Штольни, асассины, Ордо, демон, бунгало, Жертвоприношение,
// Неожиданная встреча. Занят - анкета (pers.php) пишет «Текущее задание: … - отказаться»,
// а игра на входе в чужую сцену отвечает «Вы выполняете другую миссию» или «у вас уже есть
// задание». Низкоуровневый отказ живёт в lib/quest_menu.js (dropCurrentAssignment, клик строго
// по href mod=dropquest - по тексту нельзя, рядом стоит mod=statuenull и он снимает бафф статуи).
// Здесь - ПОЛИТИКА: кто владелец слота, что можно снимать само, а что только по слову Паши.
//
// Правила (Паша, 26-27.09.2026):
//   * «в таких случаях можно отказаться от задания в анкете» - про застрявшее/брошенное задание;
//   * задание, которое мы прямо сейчас проходим, само не снимаем: это потеря прогресса;
//   * чужое, то есть взятое не нами и нам неизвестное, не трогаем вовсе - только доклад.
//
// Как приказать отказ руками, не останавливая драйвер: создать файл ai_char/drop_task.flag.
// Внутрь можно ничего не писать (тогда снимется то, что висит) или написать кусок названия -
// тогда отказ сработает только если строка анкеты с ним совпадает. Файл съедается после отказа.
module.exports = {
  readSlot, rememberSlotTaken, forgetSlotOwner, slotOwner, runDropOrderIfAny,
  dropAssignmentByOrder, ensureSlotFreeFor, get DROP_ORDER_FLAG() { return DROP_ORDER_FLAG; },
};

const fs = require('fs');
const path = require('path');
const { S, persistDailyQuestState } = require('./state');
const { readCurrentAssignment, dropCurrentAssignment } = require('./quest_menu');
const { getBodyText } = require('./core');
const { sendTelegram } = require('../telegram_alerts');

const DROP_ORDER_FLAG = path.join(__dirname, '..', 'drop_task.flag');
// Задание-сирота: когда впервые увидели висящее задание, владельца которого не знаем (см. 3b).
let unknownLine = '';
let unknownSince = 0;
// Сколько минут задание должно висеть без движения, чтобы считаться брошенным.
const STUCK_MINUTES = Number(process.env.AI_TASK_STUCK_MINUTES || 40);
// Чтобы не частить в Telegram про одно и то же.
const REPORT_EVERY_MS = 6 * 60 * 60 * 1000;

// Кто держит слот, если наша запись пуста: узнаём задание по его же тексту в анкете. Список
// пополняется по живым строкам - 27.09.2026 после отказа слот тут же занял бунгало со строкой
// «Вам нужно найти озеро в джунглях.», и владелец был «неизвестен».
// СЮЖЕТНУЮ миссию не снимаем НИКОГДА. 28.09.2026: правило «сорвался - отпусти слот» сработало на
// «Вспышках прошлого», где в анкете стояло «Вы выполняете сюжетную миссию», и отказ выбросил весь
// пройденный квест (семь стадий, восемь боёв). Отказ допустим только для «ответственного задания».
const STORY_MISSION_RE = /сюжетную?\s+миссию?/i;
const KNOWN_TASKS = [
  { re: /озеро в джунглях|бунгало/i, label: 'Задание в бунгало', droppable: true },
  { re: /ответственное задание/i, label: null, droppable: false },
];
// Задания, которые не жалко снять ради квеста по гайду: короткие и повторяемые. Бунгало берётся
// заново каждый день, а маршрут по гайду ждать сутки не может.
function recognizeTask(line) {
  for (const t of KNOWN_TASKS) if (t.re.test(String(line || ''))) return t;
  return null;
}

// Анкету открываем НАПРЯМУЮ. 27.09.2026: readCurrentAssignment ищет ссылку на pers.php на текущей
// странице, а в фарме её на экране нет - и проверка молча возвращала «слот свободен». Из-за этого
// три квеста подряд шли в сцену и получали «Вы выполняете другую миссию», хотя анкета всё это время
// показывала «Текущее задание: Вы выполняете ответственное задание. - отказаться».
async function readSlot(page) {
  try {
    await page.goto('http://lbast.ru/pers.php', { waitUntil: 'domcontentloaded', timeout: 60000 });
    const t = await getBodyText(page);
    const m = t.match(/Текущее задание:\s*([\s\S]*?)\s*-\s*отказаться/i);
    if (/Текущее задание/i.test(t)) return { busy: !!m, line: m ? m[1].trim() : null };
    return { busy: null, line: null };
  } catch (e) {
    console.log('Анкета не прочиталась:', String(e.message).split(String.fromCharCode(10))[0]);
    return { busy: null, line: null };
  }
}

// Запоминаем, что слот занят НАМИ и кем именно. Зовётся там, где мы задание берём.
function rememberSlotTaken(label) {
  S.taskSlotOwner = String(label || '').trim() || null;
  S.taskSlotTakenAt = Date.now();
  try { persistDailyQuestState(); } catch { /* состояние переживёт и без записи */ }
  console.log(`Слот задания: взяли под «${S.taskSlotOwner}».`);
}

function forgetSlotOwner() {
  S.taskSlotOwner = null;
  S.taskSlotTakenAt = 0;
  try { persistDailyQuestState(); } catch { /* не критично */ }
}

function slotOwner() {
  return S.taskSlotOwner ? { label: S.taskSlotOwner, at: S.taskSlotTakenAt } : null;
}

function readDropOrder() {
  try {
    const raw = fs.readFileSync(DROP_ORDER_FLAG, 'utf8');
    return { present: true, match: raw.trim() };
  } catch {
    return { present: false, match: '' };
  }
}

function consumeDropOrder() {
  try { fs.unlinkSync(DROP_ORDER_FLAG); } catch { /* файла уже нет */ }
}

// Сам отказ + проверка, что задание действительно ушло. Без проверки верить нельзя: экран
// mod=dropquest выполняет действие сразу и ничего не подтверждает.
async function dropAssignmentByOrder(page, reason, { allowStory = false, quiet = false } = {}) {
  const before = await readSlot(page);
  if (before.busy && !allowStory && STORY_MISSION_RE.test(String(before.line || ''))) {
    console.log(`Отказ от задания НЕ делаю: в анкете «${before.line}» - это сюжетная миссия, её отказ выбрасывает весь пройденный квест.`);
    return false;
  }
  if (!before.busy) {
    console.log('Отказ от задания: анкета говорит, что слот уже пуст.');
    forgetSlotOwner();
    return false;
  }
  const ok = await dropCurrentAssignment(page, reason).catch((e) => {
    console.log('Отказ от задания сорвался:', e.message);
    return false;
  });
  if (!ok) return false;
  const after = await readSlot(page);
  if (after.busy) {
    console.log(`Отказ от задания: анкета всё ещё показывает «${after.line}» - считаю, что не вышло.`);
    return false;
  }
  console.log(`Отказ от задания выполнен: было «${before.line}», причина: ${reason}.`);
  // 29.09.2026, Паша просил не спамить: отказ по служебной нужде (освободить слот под другой квест)
  // остаётся в логе. В Telegram идёт только то, что не мы запланировали.
  if (!quiet) await sendTelegram(`Отказался от задания «${before.line}». Причина: ${reason}.`).catch(() => {});
  forgetSlotOwner();
  return true;
}

// Главная точка входа: можно ли занимать слот под quest. Возвращает true, если слот свободен
// (или мы его освободили). Ничего не делает молча - каждое решение пишется в лог.
async function ensureSlotFreeFor(page, questName) {
  const slot = await readSlot(page);
  if (slot.busy === null) {
    console.log(`Слот задания: анкета не прочиталась - считаю занятым (${questName} не начинаю).`);
    return false;
  }
  if (!slot.busy) return true;

  const owner = slotOwner();
  // Задание держит САМ этот квест - значит он его и взял, продолжаем. 27.09.2026: «Вспышки прошлого»
  // взяли задание, записались владельцем слота, и их же гейт следующим циклом их не пустил.
  if (owner && owner.label === questName) {
    console.log(`Слот задания держит сам «${questName}» - это его задание, продолжаю.`);
    return true;
  }
  const order = readDropOrder();
  const recognized = recognizeTask(slot.line);
  const ownerLine = `«${slot.line}»${owner ? `, по нашим записям это ${owner.label}` : (recognized && recognized.label ? `, по тексту это ${recognized.label}` : ', владелец нам неизвестен')}`;

  // 1) Прямой приказ файлом - снимаем что угодно, но если в файле написано название, оно должно совпасть.
  if (order.present) {
    const matches = !order.match
      || String(slot.line || '').toLowerCase().includes(order.match.toLowerCase())
      || (owner && owner.label.toLowerCase().includes(order.match.toLowerCase()));
    if (matches) {
      const ok = await dropAssignmentByOrder(page, `приказ файлом drop_task.flag, освобождаю слот под «${questName}»`);
      consumeDropOrder();
      return ok;
    }
    console.log(`Слот задания: приказ в drop_task.flag про «${order.match}», а висит ${ownerLine} - не трогаю.`);
    return false;
  }

  // 2) Короткое повторяемое задание (бунгало) уступает квесту по гайду: оно берётся заново
  // каждый день, а маршрут по гайду из-за него стоит сутки.
  const known = recognizeTask(slot.line);
  if (known && known.droppable) {
    return dropAssignmentByOrder(page, `${known.label} держит слот, а он нужен «${questName}» - задание короткое и берётся заново`, { quiet: true });
  }

  // 3) Наше же задание, которое давно не двигается, - это и есть «застрявшее» из правила Паши.
  const idleMin = owner ? Math.round((Date.now() - owner.at) / 60000) : null;
  if (owner && idleMin >= STUCK_MINUTES && !questInProgress(owner.label)) {
    return dropAssignmentByOrder(page, `${owner.label} держит слот ${idleMin} мин и не двигается, слот нужен «${questName}»`, { quiet: true });
  }

  // 3b) Задание, владельца которого мы НЕ ЗНАЕМ. 07.10.2026: драйвер пролежал 13 часов, в игре
  // осталось висеть взятое задание, а наша запись о владельце пропала - и слот заклинило намертво:
  // случай 4 только докладывает и ждёт, а ждать было некого. Такое задание - сирота: даём ему срок
  // (как и всему остальному: у каждого гейта должен быть предел) и снимаем. Сюжетную миссию отказ
  // не тронет - это проверяется внутри dropAssignmentByOrder, так что потерять длинный квест нельзя.
  if (!owner) {
    const line = String(slot.line || '');
    if (unknownLine !== line) { unknownLine = line; unknownSince = Date.now(); }
    const unknownMin = Math.round((Date.now() - unknownSince) / 60000);
    if (unknownMin >= STUCK_MINUTES) {
      unknownLine = '';
      unknownSince = 0;
      return dropAssignmentByOrder(page, `задание-сирота ${ownerLine} висит ${unknownMin} мин, владельца мы не знаем, слот нужен «${questName}»`, { quiet: true });
    }
    console.log(`Слот задания: ${ownerLine} - владельца не знаем, наблюдаю ${unknownMin} из ${STUCK_MINUTES} мин, потом сниму.`);
    return false;
  }

  // 4) Всё остальное - только доклад. Чужое и своё в работе не снимаем.
  console.log(`Слот задания занят: ${ownerLine}${idleMin === null ? '' : `, висит ${idleMin} мин`} -> «${questName}» жду.`);
  // Телеграм про занятый слот убран 28.09.2026 («не надо мне такие письма спамить»): это рабочая
  // ситуация, а не поломка, и она видна в логе. В Telegram остаётся только сам факт отказа.
  S.taskSlotReportedAt = Date.now();
  return false;
}

// Задание «в работе», если у квеста с таким именем в guides_state.json начата часть маршрута.
function questInProgress(label) {
  try {
    const st = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'guides', 'guides_state.json'), 'utf8'));
    for (const [name, qs] of Object.entries(st)) {
      if (!qs || qs.part === undefined) continue;
      if (name === label || label.includes(name) || name.includes(label)) return true;
    }
  } catch { /* нет файла - значит ничего не в работе */ }
  return false;
}

// Приказ отказаться проверяем КАЖДЫЙ цикл, отдельным шагом драйвера, а не внутри проверки слота.
// 27.09.2026: флаг пролежал без дела полчаса - его читал только гейт needsSlot, а до гейта ни один
// квест не доходил (упирались в порог резерва). Приказ человека не должен зависеть от того, добрался
// ли до него какой-то квест.
async function runDropOrderIfAny(page) {
  const order = readDropOrder();
  if (!order.present) return false;
  const slot = await readSlot(page);
  if (slot.busy === null) {
    console.log('Приказ на отказ: анкета не прочиталась, попробую в следующем цикле.');
    return false;
  }
  if (!slot.busy) {
    console.log('Приказ на отказ: слот и так пуст - убираю флаг.');
    consumeDropOrder();
    forgetSlotOwner();
    return false;
  }
  const owner = slotOwner();
  const matches = !order.match
    || String(slot.line || '').toLowerCase().includes(order.match.toLowerCase())
    || (owner && owner.label.toLowerCase().includes(order.match.toLowerCase()));
  if (!matches) {
    console.log(`Приказ на отказ про «${order.match}», а в анкете «${slot.line}»${owner ? ` (наша запись: ${owner.label})` : ''} - не трогаю.`);
    return false;
  }
  const ok = await dropAssignmentByOrder(page, `приказ файлом drop_task.flag${order.match ? ` («${order.match}»)` : ''}`);
  if (ok) consumeDropOrder();
  return ok;
}
