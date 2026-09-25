// Повторяемые квесты, записанные маршрутом в *.steps, — для автозапуска из основного цикла.
// Портировано из ai_char/guides/quests.js (маршруты обкатаны там вживую), но без зависимости от
// ai_char/module.js: всё нужное от основного бота приходит через deps.
//
// Состояние (какая часть цепочки, когда пройден, пауза после сбоя) — в guides_state.json,
// прогресс внутри одного файла — в <file>.progress. Оба в .gitignore.
const fs = require('fs');
const path = require('path');
const { runGuide } = require('./guide_run');

const STATE_FILE = path.join(__dirname, 'guides_state.json');

const GUIDE_QUESTS = [
  {
    // Q-инфо: «раз в 15 дней, влияние на карму, до уровень*75 дин».
    // Гайд kate2008: zhg_web.php?st_id=154021 (часть 1) + st_id=156115 (часть 2).
    // Маршрут без лишних боёв в «Четырёх монетах» (через Тару), проверен вживую на AI__.
    name: 'Смерть ростовщика',
    files: ['rostovshik.steps', 'rostovshik2.steps', 'rostovshik3.steps'],
    periodDays: 15,
    // Длинная цепочка с боями: не начинаем на исходе резерва (в середине раннер сам ждёт отдых,
    // но начинать заведомо впритык смысла нет).
    minReserveMinutes: 15,
  },
  {
    // Гайд kate2008, вариант V «дополнительные дины» (zhg_web.php?st_id=150018); выбор ветки и
    // сравнение всех восьми -- в шапке самого .steps.
    // Условия из гайда: с 8 уровня, раз в 15 дней, город Хорсхуф западнее Эльтауэра,
    // предусловие -- выполненная «Смерть ростовщика» (она же выше в этом списке).
    // Маршрут вживую ещё не прогонялся: при первом расхождении раннер остановится и напишет,
    // что было на экране, а quests.js отложит квест -- долбить одно и то же он не станет.
    name: 'Неожиданная встреча',
    files: ['neozhidannaya_vstrecha.steps'],
    periodDays: 15,
    // Два боя плюс полтора десятка переходов по городу.
    minReserveMinutes: 15,
  },
];

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { return {}; }
}

function saveState(st) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(st, null, 2));
}

function clearProgress(q) {
  for (const f of q.files) {
    try { fs.unlinkSync(path.join(__dirname, f) + '.progress'); } catch { /* нет файла */ }
  }
}

// Возвращает true, если что-то делали (начали/продолжили квест).
async function runGuideQuestIfDue(page, q, deps = {}) {
  const { isInMenu, reserveMinutes } = deps;
  const st = loadState();
  const qs = st[q.name] || {};
  const now = Date.now();

  if (qs.suppressedUntil && now < qs.suppressedUntil) return false;

  // qs.part !== undefined -> цепочка уже начата, доводим до конца независимо от меню Q:
  // взятый квест из меню пропадает, а сцена остаётся.
  if (qs.part === undefined) {
    if (qs.lastDone && now - qs.lastDone < q.periodDays * 86400000) return false;
    if (typeof isInMenu === 'function' && !isInMenu(q.name)) return false;
    if (q.minReserveMinutes && (typeof reserveMinutes !== 'number' || reserveMinutes < q.minReserveMinutes)) {
      console.log(`${q.name}: пропускаю (нужно >=${q.minReserveMinutes} резервных минут, есть=${reserveMinutes ?? 'n/a'})`);
      return false;
    }

    clearProgress(q);
    qs.part = 0;
    qs.startedAt = now;
    st[q.name] = qs;
    saveState(st);
    console.log(`${q.name}: квест доступен, иду по записанному маршруту (${q.files.length} части).`);
  }

  for (let p = qs.part; p < q.files.length; p++) {
    const file = path.join(__dirname, q.files[p]);
    console.log(`${q.name}: часть ${p + 1}/${q.files.length} (${q.files[p]})`);
    const r = await runGuide(page, file, undefined, deps);

    if (r.status !== 'done') {
      // Не долбим: после поражения ждём лечения, после расхождения с маршрутом — человека.
      const pauseMin = r.status === 'lost' ? 30 : 180;
      qs.part = p;
      qs.suppressedUntil = Date.now() + pauseMin * 60000;
      st[q.name] = qs;
      saveState(st);
      console.log(`${q.name}: маршрут остановился (${r.status}) в части ${p + 1} на шаге ${r.index}; пауза ${pauseMin} мин.`);
      return true;
    }

    qs.part = p + 1;
    st[q.name] = qs;
    saveState(st);
  }

  qs.lastDone = Date.now();
  delete qs.part;
  delete qs.suppressedUntil;
  st[q.name] = qs;
  saveState(st);
  clearProgress(q);
  console.log(`${q.name}: квест пройден по маршруту, следующий раз через ${q.periodDays} дн.`);
  return true;
}

async function runGuideQuestsIfDue(page, deps = {}) {
  let did = false;
  for (const q of GUIDE_QUESTS) {
    if (await runGuideQuestIfDue(page, q, deps)) did = true;
  }
  return did;
}

// Есть ли незавершённая цепочка: основной цикл по этому признаку не уходит на ферму, пока квест
// не доигран (сцена квеста живёт на локации и её нельзя бросать надолго).
function hasGuideQuestInProgress() {
  const st = loadState();
  return GUIDE_QUESTS.some((q) => st[q.name] && st[q.name].part !== undefined);
}

module.exports = { runGuideQuestsIfDue, hasGuideQuestInProgress, GUIDE_QUESTS, STATE_FILE };
