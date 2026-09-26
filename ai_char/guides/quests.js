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
    // 22.09.2026: утром дважды упёрлись в «Вы еще не выполнили другое задание» (слот держали асассины,
    // Ордо, демон) - маршрут вставал на шаге 6 с паузой 3 ч, эль в 05:21 выпит впустую.
    needsSlot: true,
  },
  {
    // Паша, 21.09.2026: «делай эти квесты... сначала кузницу и галерею». Старое исполнение в
    // lib/quests_basic.js выключено (RUMA_FORGE_ENABLED=false) - шло без лечения и падало.
    name: 'Кузница Рума',
    files: ['ruma.steps'],
    periodDays: 1.5, // «раз в 36 часов» (инфо квеста); меню Q всё равно решает, доступен ли
    quietDone: true,
    allowedInSingleMode: true,
  },
  {
    // Паша, 21.09.2026: «делай эти квесты... кузницу и галерею». Квест повторяемый: снова висел в Q
    // через неделю после сдачи. Меню Q решает, пора ли; старое исполнение в lib/quests_story.js
    // (runGalleryQuestIfAvailable) выключено - сцена поиска лазулитов с тех пор изменилась.
    name: 'Галерея искусств',
    files: ['gallery.steps'],
    periodDays: 1,
    quietDone: true,
    allowedInSingleMode: true,
  },
];

// Слот «ответственного задания» один на всех (Штольни, асассины, Ордо, демон, бунгало). Занят -
// в анкете строка «Текущее задание: ... - отказаться».
const SLOT_BUSY_TEXT_RE = /Вы еще не выполнили другое задание|У вас уже есть задание/i;
const SLOT_RETRY_MIN = 20;
const SLOT_TAKEN_RE = new RegExp(String.raw`Текущее задание:[^
]*отказаться`, "i");
const SLOT_LINE_RE = new RegExp(String.raw`Текущее задание:[^
]*`, "i");
// 26.09.2026: раньше при занятом слоте в логе было только «слот задания занят другим квестом», и
// весь вечер ушёл на то, чтобы выяснить, КТО его занял (оказалось - брошенное задание Ордо).
// Теперь строка анкеты уходит в лог вместе с отказом: причина видна сразу.
let lastSlotBusyText = '';
async function taskSlotFree(page) {
  await page.goto('http://lbast.ru/pers.php', { waitUntil: 'domcontentloaded', timeout: 60000 });
  const t = await m.getBodyText(page);
  const busy = SLOT_TAKEN_RE.test(t);
  if (busy) {
    const line = (t.match(SLOT_LINE_RE) || [''])[0].replace(/\s+/g, ' ').trim();
    if (line !== lastSlotBusyText) {
      lastSlotBusyText = line;
      console.log(`Слот задания занят, анкета говорит: «${line}»`);
    }
  } else {
    lastSlotBusyText = '';
  }
  return !busy;
}

// Эль перед Штольнями. true - можно начинать. 25.09.2026, Паша: «а зачем скрипт выпил эль?» -
// раньше эль ВЫПИВАЛСЯ прямо здесь, в проверке условия: до маршрута, до его же лечения на 5 минут и
// до всякой уверенности, что заход вообще состоится. Оба утренних захода упали на первом шаге, и оба
// эля сгорели впустую. Теперь здесь только проверяем, что эль есть (или баф уже висит), а пьём его
// в самом маршруте перед первым боем - директива @ale в shtolni.steps.
async function aleReadyForShtolni(page) {
  const { isAnyBuffAleActive, hasBuffAleInBag } = require('../lib/recovery');
  if (await isAnyBuffAleActive(page).catch(() => false)) return true;
  if (await hasBuffAleInBag(page, 'Праздничный эль').catch(() => false)) {
    console.log('Штольни: Праздничный эль в сумке есть - выпью перед первым боем.');
    return true;
  }
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
    // Слот проверяем ДО эля: иначе эль выпивается, а задание не берётся.
    if (q.needsSlot && !(await taskSlotFree(page))) {
      qs.suppressedUntil = now + SLOT_RETRY_MIN * 60000;
      st[q.name] = qs;
      saveState(st);
      console.log(`${q.name}: слот задания занят другим квестом -> проверю через ${SLOT_RETRY_MIN} мин.`);
      return false;
    }
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
    if (r.status === 'mismatch' && SLOT_BUSY_TEXT_RE.test(await m.getBodyText(page).catch(() => ''))) {
      // Слот заняли между проверкой и стартом: начать заново позже, а не ждать человека 3 часа.
      delete qs.part;
      qs.suppressedUntil = Date.now() + SLOT_RETRY_MIN * 60000;
      st[q.name] = qs;
      saveState(st);
      clearProgress(q);
      console.log(`${q.name}: игра ответила «другое задание» - слот занят, повтор через ${SLOT_RETRY_MIN} мин.`);
      return true;
    }
    if (r.status !== 'done') {
      // Не долбим: после поражения ждём лечения, после расхождения с маршрутом — человека.
      const pauseMin = r.status === 'lost' ? 30 : 180;
      // 25.09.2026, Паша: «не должно быть причины по которой они не сделались за полдня». Кузница
      // Рума весь день падала на одном и том же шаге: сохранённый прогресс возобновлял маршрут с
      // шага 1 («К месту выполнения»), а этот шаг есть только на экране инфо-квеста - персонаж же
      // стоял где угодно. Пауза 3 часа, и то же самое заново. Теперь считаем срывы на ОДНОМ шаге:
      // второй подряд - стираем прогресс и следующий заход начинаем с начала маршрута (@qinfo),
      // а не с середины.
      const sameStep = qs.failIndex === r.index && qs.failPart === p;
      qs.failCount = sameStep ? (qs.failCount || 1) + 1 : 1;
      qs.failIndex = r.index;
      qs.failPart = p;
      if (r.status === 'mismatch' && qs.failCount >= 2) {
        clearProgress(q);
        delete qs.part;
        qs.failCount = 0;
        qs.suppressedUntil = Date.now() + pauseMin * 60000;
        st[q.name] = qs;
        saveState(st);
        console.log(`${q.name}: срыв на шаге ${r.index} второй раз подряд - стираю прогресс, следующий заход начну с начала маршрута (пауза ${pauseMin} мин).`);
        return true;
      }
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
  delete qs.failCount;
  delete qs.failIndex;
  delete qs.failPart;
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
