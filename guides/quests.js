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
    // Пройден вживую 25.09.2026: 472 дин + Эликсир регенерации, подробности в шапке .steps.
    name: 'Неожиданная встреча',
    files: ['neozhidannaya_vstrecha.steps'],
    periodDays: 15,
    // В меню Q не показывается вообще -- см. комментарий у гейта inQMenu ниже.
    inQMenu: false,
    // Два боя плюс полтора десятка переходов по городу; за прогон резерв ушёл с ~23 до 7.
    minReserveMinutes: 20,
  },
  {
    // Гайд kate2008 (zhg_web.php?st_id=202272), ветка 1. Пройден вживую 25.09.2026 с первого
    // раза, без единой правки маршрута: 776 дин + праздничный эль, два боя, HP 3120 -> 2435.
    // Эль нужен для Штолен, поэтому ветка 1, а не бескровная третья (она портит карму).
    // Дорога -- @qinfo (телепорт «К месту выполнения»), как диктовал Паша 14.09.2026.
    name: 'Кораблекрушение',
    files: ['korablekrushenie.steps'],
    // В каталоге сразу после сдачи встало «через 9 дн.» -- период ровно 10 суток.
    periodDays: 10,
    // Правило Паши, 25.09.2026: «10 резервов и 1300 хп».
    minReserveMinutes: 10,
    minHp: 1300,
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
  const { isInMenu, reserveMinutes, hpCurrent } = deps;
  const st = loadState();
  const qs = st[q.name] || {};
  const now = Date.now();

  if (qs.suppressedUntil && now < qs.suppressedUntil) return false;

  // qs.part !== undefined -> цепочка уже начата, доводим до конца независимо от меню Q:
  // взятый квест из меню пропадает, а сцена остаётся.
  if (qs.part === undefined) {
    if (qs.lastDone && now - qs.lastDone < q.periodDays * 86400000) return false;
    // inQMenu:false -- квест доступен, но в «Доступные задания» (меню Q) не показывается: он
    // берётся прямо на месте, а меню про него ничего не знает. Таким гейт по меню закрыл бы путь
    // навсегда (25.09.2026, «Неожиданная встреча»: в каталоге без кулдауна, в меню Q её нет).
    // Для них единственный гейт -- собственный период квеста плюс бэкофф после сбоя.
    if (q.inQMenu !== false && typeof isInMenu === 'function' && !isInMenu(q.name)) return false;
    if (q.minReserveMinutes && (typeof reserveMinutes !== 'number' || reserveMinutes < q.minReserveMinutes)) {
      console.log(`${q.name}: пропускаю (нужно >=${q.minReserveMinutes} резервных минут, есть=${reserveMinutes ?? 'n/a'})`);
      return false;
    }
    // Порог в АБСОЛЮТНЫХ HP, а не в доле от максимума: правило задаётся числом (Паша, 25.09.2026
    // про Кораблекрушение -- "10 резервов и 1300 хп"), и доля поехала бы при росте максимума.
    if (q.minHp && (typeof hpCurrent !== 'number' || hpCurrent < q.minHp)) {
      console.log(`${q.name}: пропускаю (нужно >=${q.minHp} HP, есть=${hpCurrent ?? 'n/a'})`);
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
