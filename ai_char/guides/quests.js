// Повторяемые квесты, пройденные вручную по гайду и записанные в *.steps, — для цикла драйвера.
// Паша, 18.09.2026: «это кстати не одноразовый квест, потом заскриптуй прохождение».
// Каждый квест — цепочка файлов шагов; runGuide (guide_run.js) идёт по ним на странице драйвера
// и сам лечится на месте перед боями. Состояние (какая часть, когда сделан, пауза после сбоя)
// лежит в guides_state.json, прогресс внутри файла — в <file>.progress (оба в .gitignore).
const fs = require('fs');
const path = require('path');
const m = require('../module');
const { runGuide } = require('./guide_run');

const STATE_FILE = path.join(__dirname, 'guides_state.json');

const GUIDE_QUESTS = [
  {
    name: 'Смерть ростовщика',
    // Q-инфо: «раз в 15 дней, влияние на карму, до уровень*75 дин». Ветка kate2008 II без кармы -2.
    files: ['rostovshik.steps', 'rostovshik2.steps', 'rostovshik3.steps'],
    periodDays: 15,
  },
  {
    // Паша, 19.09.2026: «каждый день, проигрыш не страшен». Бой 2 впритык (39 HP с элем), поэтому
    // поражение = квест на сегодня закрыт, а не пауза и продолжение с того же шага (сцена сгорает).
    name: 'Штольни',
    files: ['shtolni.steps'],
    periodDays: 1,
    resetAtMidnight: true,
    lostEndsDay: true,
    quietDone: true,
    // Паша, 21.09.2026: «включи штольни, но с условием что должен быть эль» - пьём Праздничный эль
    // перед началом; без эля (и без висящего баффа) не начинаем. Разовое исключение - файл
    // ../shtolni_no_ale.flag с сегодняшней датой ГГГГ-ММ-ДД («надо попробовать, это последнее
    // задание в дейлике», 21.09.2026). Режим одиночных боёв Штольни не блокирует - решает эль.
    needsAle: true,
    allowedInSingleMode: true,
  },
];

// Эль перед Штольнями. true - можно начинать.
async function aleReadyForShtolni(page) {
  const { tryDrinkBuffAle, isAnyBuffAleActive } = require('../lib/recovery');
  if (await tryDrinkBuffAle(page, 'Праздничный эль').catch(() => false)) {
    console.log('Штольни: выпил Праздничный эль перед маршрутом.');
    return true;
  }
  if (await isAnyBuffAleActive(page).catch(() => false)) return true;
  let flag = '';
  try { flag = fs.readFileSync(path.join(__dirname, '..', 'shtolni_no_ale.flag'), 'utf8'); } catch { /* нет файла */ }
  const today = new Date().toLocaleDateString('sv-SE'); // ГГГГ-ММ-ДД по местному времени
  if (flag.includes(today)) {
    console.log('Штольни: эля нет, но на сегодня Паша разрешил попробовать без него (shtolni_no_ale.flag).');
    return true;
  }
  return false;
}

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { return {}; }
}
function saveState(st) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(st, null, 2));
}
function clearProgress(q) {
  for (const f of q.files) {
    try { fs.unlinkSync(path.join(__dirname, f) + '.progress'); } catch { /* none */ }
  }
}

// Returns true when it did something (ran or resumed a quest), false when nothing was due.
async function runGuideQuestIfDue(page, q) {
  const st = loadState();
  const qs = st[q.name] || {};
  const now = Date.now();
  if (qs.suppressedUntil && now < qs.suppressedUntil) return false;

  if (qs.part === undefined) {
    // resetAtMidnight: квест обновляется с полуночи (Паша про Штольни, 19.09.2026), а не через сутки.
    const localDay = (t) => new Date(t).toLocaleDateString('ru-RU');
    if (q.resetAtMidnight) {
      if (qs.lastDone && localDay(qs.lastDone) === localDay(now)) return false;
    } else if (qs.lastDone && now - qs.lastDone < q.periodDays * 86400000) return false;
    if (!(await m.resetToQuestMenu(page))) return false;
    const qText = await m.getBodyText(page);
    if (!qText.includes(q.name)) return false;
    if (q.needsAle && !(await aleReadyForShtolni(page))) {
      qs.suppressedUntil = now + 30 * 60000;
      st[q.name] = qs;
      saveState(st);
      console.log(`${q.name}: нет Праздничного эля -> не начинаю (эль покупает драйвер в лавке Стоунгарда), проверю через 30 мин.`);
      return false;
    }
    clearProgress(q);
    qs.part = 0;
    qs.startedAt = now;
    st[q.name] = qs;
    saveState(st);
    console.log(`${q.name}: квест доступен, начинаю по записанному маршруту.`);
  }

  for (let p = qs.part; p < q.files.length; p++) {
    const file = path.join(__dirname, q.files[p]);
    console.log(`${q.name}: часть ${p + 1}/${q.files.length} (${q.files[p]})`);
    const r = await runGuide(page, file, undefined, { quietDone: q.quietDone });
    if (r.status === 'lost' && q.lostEndsDay) {
      qs.lastDone = Date.now();
      delete qs.part;
      delete qs.suppressedUntil;
      st[q.name] = qs;
      saveState(st);
      clearProgress(q);
      console.log(`${q.name}: бой проигран на шаге ${r.index} - на сегодня всё, завтра заново.`);
      return true;
    }
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
  console.log(`${q.name}: квест пройден по маршруту, следующий раз ${q.resetAtMidnight ? 'после полуночи' : `через ${q.periodDays} дн.`}.`);
  return true;
}

async function runGuideQuestsIfDue(page, { singleMode = false } = {}) {
  let did = false;
  for (const q of GUIDE_QUESTS) {
    if (singleMode && !q.allowedInSingleMode) continue; // цепочки боёв в режиме одиночных ботов не идут
    if (await runGuideQuestIfDue(page, q)) did = true;
  }
  return did;
}

module.exports = { runGuideQuestsIfDue, GUIDE_QUESTS, STATE_FILE };
