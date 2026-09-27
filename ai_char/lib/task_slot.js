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
  readSlot, rememberSlotTaken, forgetSlotOwner, slotOwner,
  dropAssignmentByOrder, ensureSlotFreeFor, get DROP_ORDER_FLAG() { return DROP_ORDER_FLAG; },
};

const fs = require('fs');
const path = require('path');
const { S, persistDailyQuestState } = require('./state');
const { readCurrentAssignment, dropCurrentAssignment } = require('./quest_menu');
const { sendTelegram } = require('../telegram_alerts');

const DROP_ORDER_FLAG = path.join(__dirname, '..', 'drop_task.flag');
// Сколько минут задание должно висеть без движения, чтобы считаться брошенным.
const STUCK_MINUTES = Number(process.env.AI_TASK_STUCK_MINUTES || 40);
// Чтобы не частить в Telegram про одно и то же.
const REPORT_EVERY_MS = 6 * 60 * 60 * 1000;

async function readSlot(page) {
  const info = await readCurrentAssignment(page).catch(() => null);
  if (!info) return { busy: null, line: null };
  return { busy: !!info.assignment, line: info.assignment || null };
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
async function dropAssignmentByOrder(page, reason) {
  const before = await readSlot(page);
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
  await sendTelegram(`Отказался от задания «${before.line}». Причина: ${reason}.`).catch(() => {});
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
  const order = readDropOrder();
  const ownerLine = `«${slot.line}»${owner ? `, по нашим записям это ${owner.label}` : ', владелец нам неизвестен'}`;

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

  // 2) Наше же задание, которое давно не двигается, - это и есть «застрявшее» из правила Паши.
  const idleMin = owner ? Math.round((Date.now() - owner.at) / 60000) : null;
  if (owner && idleMin >= STUCK_MINUTES && !questInProgress(owner.label)) {
    return dropAssignmentByOrder(page, `${owner.label} держит слот ${idleMin} мин и не двигается, слот нужен «${questName}»`);
  }

  // 3) Всё остальное - только доклад. Чужое и своё в работе не снимаем.
  console.log(`Слот задания занят: ${ownerLine}${idleMin === null ? '' : `, висит ${idleMin} мин`} -> «${questName}» жду.`);
  if (Date.now() - (S.taskSlotReportedAt || 0) > REPORT_EVERY_MS) {
    S.taskSlotReportedAt = Date.now();
    await sendTelegram(`Слот задания занят: ${slot.line}. Из-за этого стоит «${questName}». Отказаться - создать файл ai_char/drop_task.flag.`).catch(() => {});
  }
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
