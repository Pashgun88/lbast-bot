// Повторяемые квесты, записанные маршрутом в *.steps, — для автозапуска из основного цикла.
// Портировано из ai_char/guides/quests.js (маршруты обкатаны там вживую), но без зависимости от
// ai_char/module.js: всё нужное от основного бота приходит через deps.
//
// Состояние (какая часть цепочки, когда пройден) — в guides_state.json,
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
  {
    // Гайд kate2008 (zhg_web.php?st_id=162439) -- «Рыбацкая деревня (карма +3 и -3)». Берём только
    // плюсовую карму; вариант -3 из того же гайда не используем (Паша, 27.09.2026).
    // Правило Паши: «3 боя одиночных, значит 1600 хп и 15 резервов».
    name: 'Рыбацкая деревня',
    files: ['rybatskaya_derevnya.steps'],
    // Гейт -- САМО НАЛИЧИЕ в меню квестов (Паша, 28.09.2026: «квест ещё не откатился, его нужно
    // делать когда появится в меню квестов»), поэтому inQMenu не выключаем, а periodDays=0 снимает
    // проверку по своему счётчику: меню игры знает про кулдаун точнее нас. В гайде «раз в 7 дней».
    // Раньше здесь стоял inQMenu:false, и бот 27--28.09.2026 каждый проход ездил конём в деревню,
    // где на экране просто нет ссылки «Осмотреться»: квест был на кулдауне, а по экрану кулдаун от
    // неверного маршрута не отличить.
    periodDays: 0,
    minReserveMinutes: 15,
    minHp: 1600,
  },
  {
    // Гайд kate2008 (zhg_web.php?st_id=200954) плюс разбор по дням из ветки АИ-персонажа
    // (LESSONS_AI_CHAR.md, 15.09.2026): там реплики всех трёх дней выписаны дословно, день 2
    // пройден вживую, день 3 -- нет.
    name: 'Жертвоприношение',
    files: ['zhertvoprinoshenie1.steps', 'zhertvoprinoshenie2.steps', 'zhertvoprinoshenie3.steps'],
    // Каждый день -- отдельные календарные сутки, за один сеанс цепочку не пройти.
    partsOnSeparateDays: true,
    // Периода нет: делаем, как только квест появился в меню Q (Паша, 28.09.2026). Гейт -- само
    // наличие в меню, поэтому inQMenu не выключаем, а periodDays=0 снимает проверку по времени.
    periodDays: 0,
    // Пороги только на третий день -- там единственный бой (Паша, 28.09.2026: «порог только на
    // день 3 - 10 минут и 1200 хп»). Первые два дня -- разговоры и ходьба, их не гейтим.
    partGates: { 3: { minReserveMinutes: 10, minHp: 1200 } },
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
// Пока висит чужая миссия, все сцены-миссии отвечают «Вы выполняете другую миссию». Ходить к ним
// каждые 3-5 минут бессмысленно (06.10.2026: 16 заходов за вечер) -- ждём час.
const OTHER_MISSION_BACKOFF_MS = 60 * 60 * 1000;
let otherMissionUntil = 0;

async function runGuideQuestIfDue(page, q, deps = {}) {
  const { isInMenu, reserveMinutes, hpCurrent } = deps;
  const st = loadState();
  const qs = st[q.name] || {};
  const now = Date.now();
  if (now < otherMissionUntil) return false;

  // Часть пройдена в эти же сутки -- следующая будет только завтра, ходить незачем.
  if (q.partsOnSeparateDays && qs.part !== undefined && qs.partDoneAt) {
    const sameDay = new Date(qs.partDoneAt).toDateString() === new Date(now).toDateString();
    if (sameDay) return false;
  }

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
    // Порог отдельной части: у многодневных цепочек бой бывает только в одном дне, и держать
    // из-за него гейт на всей цепочке значит зря не начинать первые дни.
    const gate = (q.partGates || {})[p + 1];
    if (gate) {
      if (gate.minReserveMinutes && (typeof reserveMinutes !== 'number' || reserveMinutes < gate.minReserveMinutes)) {
        console.log(`${q.name}: часть ${p + 1} ждёт резерв >=${gate.minReserveMinutes} (есть=${reserveMinutes ?? 'n/a'})`);
        qs.part = p;
        st[q.name] = qs;
        saveState(st);
        return false;
      }
      if (gate.minHp && (typeof hpCurrent !== 'number' || hpCurrent < gate.minHp)) {
        console.log(`${q.name}: часть ${p + 1} ждёт HP >=${gate.minHp} (есть=${hpCurrent ?? 'n/a'})`);
        qs.part = p;
        st[q.name] = qs;
        saveState(st);
        return false;
      }
    }

    const file = path.join(__dirname, q.files[p]);
    console.log(`${q.name}: часть ${p + 1}/${q.files.length} (${q.files[p]})`);
    const r = await runGuide(page, file, undefined, deps);

    if (r.status === 'other_mission') {
      // Сначала пробуем освободить слот: если сами мы ничего не ведём, висящее задание чужое или
      // брошенное, и его можно снять в анкете (Паша, 06.10.2026). Тогда в следующем проходе
      // сцена откроется -- откладывать на час не нужно.
      if (typeof deps.releaseOtherMission === 'function' && await deps.releaseOtherMission(q.name)) {
        if (p === 0) {
          delete qs.part;
          clearProgress(q);
        } else {
          qs.part = p;
        }
        st[q.name] = qs;
        saveState(st);
        console.log(`${q.name}: слот освобождён, зайду снова в следующем проходе.`);
        return true;
      }
      otherMissionUntil = Date.now() + OTHER_MISSION_BACKOFF_MS;
      // Первая часть так и не открылась -- цепочка не начата, как и при остановке на дороге.
      if (p === 0) {
        delete qs.part;
        clearProgress(q);
      } else {
        qs.part = p;
      }
      st[q.name] = qs;
      saveState(st);
      console.log(`${q.name}: висит другая миссия -- сцена не открывается; сценарии-миссии отложены на час. Проверь «Дневник»: какая миссия взята и не доиграна.`);
      return false;
    }

    if (r.status !== 'done') {
      // Маршрут не вышел за дорогу: сцены квеста мы так и не увидели, значит квест не взят и
      // цепочка НЕ начата. Признак начала снимаем, иначе qs.part обходит все гейты, включая гейт по
      // меню квестов: 28.09.2026 «Рыбацкая деревня» записала part=0 ещё старым кодом и потом весь
      // вечер каталась конём в деревню, где на кулдауне просто нет ссылки «Осмотреться».
      if (p === 0 && r.pastRoad === false) {
        delete qs.part;
        st[q.name] = qs;
        saveState(st);
        clearProgress(q);
        console.log(`${q.name}: сцена не открылась (остановка на шаге ${r.index} сразу за дорогой) -> цепочка не начата, гейты снова в силе.`);
        return true;
      }
      // Паузы после сбоя нет (Паша, 28.09.2026: «эти паузы вообще не нужны, убери везде»). Сцена
      // квеста живёт на сервере и помнит текущий экран, поэтому следующий проход продолжит маршрут
      // с того же места, а не начнёт заново -- ждать часами было незачем. Чаще одного раза за
      // проход цикла повтор всё равно не случится, а место в цепочке хранит qs.part.
      qs.part = p;
      st[q.name] = qs;
      saveState(st);
      console.log(`${q.name}: маршрут остановился (${r.status}) в части ${p + 1} на шаге ${r.index}; повторю в следующем проходе.`);
      return true;
    }

    qs.part = p + 1;
    qs.partDoneAt = Date.now();
    st[q.name] = qs;
    saveState(st);

    // Цепочка на календарных сутках: следующая часть станет доступна только завтра, поэтому
    // останавливаемся здесь. Без этого раннер тут же пошёл бы в часть p+2, не нашёл её экранов и
    // ушёл в трёхчасовой бэкофф -- то есть наказал бы нас за нормальный ход квеста.
    if (q.partsOnSeparateDays && qs.part < q.files.length) {
      console.log(`${q.name}: часть ${p + 1} пройдена, следующая -- на следующие сутки.`);
      return true;
    }
  }

  qs.lastDone = Date.now();
  delete qs.part;
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
function hasGuideQuestInProgress(exceptName = null) {
  const st = loadState();
  return GUIDE_QUESTS.some((q) => q.name !== exceptName && st[q.name] && st[q.name].part !== undefined);
}

module.exports = { runGuideQuestsIfDue, hasGuideQuestInProgress, GUIDE_QUESTS, STATE_FILE };
