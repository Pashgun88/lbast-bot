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
    lostEndsDay: true,
    quietDone: true,
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
    if (qs.lastDone && now - qs.lastDone < q.periodDays * 86400000) return false;
    if (!(await m.resetToQuestMenu(page))) return false;
    const qText = await m.getBodyText(page);
    if (!qText.includes(q.name)) return false;
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
  console.log(`${q.name}: квест пройден по маршруту, следующий раз через ${q.periodDays} дн.`);
  return true;
}

async function runGuideQuestsIfDue(page) {
  let did = false;
  for (const q of GUIDE_QUESTS) {
    if (await runGuideQuestIfDue(page, q)) did = true;
  }
  return did;
}

module.exports = { runGuideQuestsIfDue, GUIDE_QUESTS, STATE_FILE };
