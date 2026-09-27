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

// Порог резерва: длинным маршрутам - настоящий (15-20 мин), коротким - минута. Почему так. 27.09.2026 я поставил длинным
// маршрутам 20-40 минут резерва - и они не пошли вовсе: в шапке игры «AI__ (460/460) [10] (2)»
// число в круглых скобках и есть резерв, и он весь день колеблется около нуля (12 -> 7 -> -2 -> 0
// -> -5), потому что обычный цикл драйвера тратит примерно столько же, сколько набегает. Ждать
// сорока минут - значит не делать квест никогда. Сам маршрут с пустым резервом не ломается:
// guide_run пережидает «Вы устали и решили отдохнуть N мин» и «отдохнуть еще N мин», но платит за
// это временем ВСЕГО драйвера - цикл однопоточный, и маршрут на сто с лишним шагов с пустым
// резервом занял бы полдня. Поэтому длинные маршруты всё-таки ждут настоящий резерв: он набегает
// за ночь (сон 23:00-05:00), и с утра его хватает - Штольни и Кузница 27.09 так и прошли, при
// резерве 12-14. Короткие (день «Жертвоприношения») идут почти всегда.
const GUIDE_QUESTS = [
  {
    name: 'Смерть ростовщика',
    // Q-инфо: «раз в 15 дней, влияние на карму, до уровень*75 дин». Ветка kate2008 II без кармы -2.
    files: ['rostovshik.steps', 'rostovshik2.steps', 'rostovshik3.steps'],
    periodDays: 15,
  },
  {
    // Перенесено из репозитория Цунами 27.09.2026 (Паша: «процунами - не в жг а в репо на гитхабе»).
    // Маршрут он прошёл вживую 25.09 и уже исправил под текущую игру; вариант V по гайду kate2008 -
    // самый прибыльный (три выплаты, 472 дин + Эликсир регенерации за прогон), ценой двух боёв и
    // нулевой кармы. В меню Q квест НЕ появляется вовсе, поэтому inQMenu: false.
    name: 'Неожиданная встреча',
    needsSlot: true,
    files: ['neozhidannaya_vstrecha.steps'],
    periodDays: 15,
    inQMenu: false,
    minReserveMinutes: 1,
    allowedInSingleMode: true,
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
  {
    // Паша, 27.09.2026: «Вспышки прошлого, Унесенные ветром - эти 2 квеста у кейт есть прохождение -
    // сделай». Гайд kate2008 zhg_web.php?st_id=122210. Раз в месяц, восемь боёв по 10-минутному
    // запрету и переезды через полкарты - отсюда 40 минут резерва и запрет в режиме одиночных боёв.
    name: 'Вспышки прошлого',
    // 27.09.2026: слот им всё-таки нужен - «Осмотреть стрелу» и сцена кузницы отвечают
    // «другое задание». Гейт нужен, чтобы не идти через полкарты зря.
    needsSlot: true,
    // Слот задания этому квесту не нужен: 27.09 маршрут спокойно дошёл до таверны, отказ
    // «Вы выполняете другую миссию» был только у «Неожиданной встречи».
    files: ['vspyshki.steps'],
    periodDays: 30,
    // Паша 27.09 велел сделать эти квесты сейчас, поэтому порог символический: с пустым
    // резервом маршрут идёт медленно (пережидает «Вы устали»), но идёт.
    minReserveMinutes: 1,
  },
  {
    // Гайд kate2008 zhg_web.php?st_id=122661. Период в гайде не указан - решает меню Q.
    // Пять из шести боёв ПАРНЫЕ (два бота сразу, запрет 15 минут), поэтому в режим одиночных
    // боёв квест не пускаем.
    name: 'Унесенные ветром',
    // 27.09.2026: слот им всё-таки нужен - «Осмотреть стрелу» и сцена кузницы отвечают
    // «другое задание». Гейт нужен, чтобы не идти через полкарты зря.
    needsSlot: true,
    // Слот задания этому квесту не нужен: 27.09 маршрут спокойно дошёл до таверны, отказ
    // «Вы выполняете другую миссию» был только у «Неожиданной встречи».
    files: ['unesennye.steps'],
    periodDays: 1,
    // Паша 27.09 велел сделать эти квесты сейчас, поэтому порог символический: с пустым
    // резервом маршрут идёт медленно (пережидает «Вы устали»), но идёт.
    minReserveMinutes: 1,
  },
  {
    // Паша, 27.09.2026: «Жертвоприношение [инфо] - у тебя же есть прохождение». Квест наш, пройден
    // 16.09.2026 (750 дин), маршрут записан в LESSONS_AI_CHAR.md и в памяти. Части = игровые ДНИ:
    // игра сама закрывает день словами «расследование лучше начать завтра», отсюда dayGatedParts.
    // День первый упирается в мини-игру «Сапёр» - маршрут там встаёт по @stop со снимком экрана.
    name: 'Жертвоприношение',
    // Берёт слот ответственного задания и держит его все три дня - из-за этого стоят
    // Штольни и «Неожиданная встреча». Отсюда takesSlot: владельца слота помним по имени.
    takesSlot: true,
    files: ['zhertva1.steps', 'zhertva2.steps', 'zhertva3.steps'],
    periodDays: 1,
    dayGatedParts: true,
    minReserveMinutes: 1,
  },
];

// Слот «ответственного задания» один на всех (Штольни, асассины, Ордо, демон, бунгало). Занят -
// в анкете строка «Текущее задание: ... - отказаться».
// «Вы выполняете другую миссию» - тот же занятый слот, увидено 27.09.2026 в таверне Хорсхуфа:
// маршрут «Неожиданной встречи» дошёл до сцены и получил этот экран, потому что слот держало
// «Жертвоприношение», взятое в тот же день. Без этой строки такой отказ считался поломкой
// маршрута и стоил трёхчасовой паузы.
const SLOT_BUSY_TEXT_RE = /Вы еще не выполнили другое задание|У вас уже есть задание|Вы выполняете другую миссию/i;
const SLOT_RETRY_MIN = 20;
const SLOT_TAKEN_RE = new RegExp(String.raw`Текущее задание:[^
]*отказаться`, "i");
const SLOT_LINE_RE = new RegExp(String.raw`Текущее задание:[^
]*`, "i");
// 26.09.2026: раньше при занятом слоте в логе было только «слот задания занят другим квестом», и
// весь вечер ушёл на то, чтобы выяснить, КТО его занял (оказалось - брошенное задание Ордо).
// Теперь строка анкеты уходит в лог вместе с отказом: причина видна сразу.
let lastSlotBusyText = '';
async function taskSlotFree(page, questName = 'квест по гайду') {
  // Вся политика отказа - в lib/task_slot.js: чьё задание висит, можно ли его снять само (своё
  // брошенное - можно, своё в работе и чужое - нет) и приказ файлом ai_char/drop_task.flag.
  const { ensureSlotFreeFor } = require('../lib/task_slot');
  return ensureSlotFreeFor(page, questName);
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
    // inQMenu: false - квест есть в каталоге «Все квесты», но в меню Q не показывается (живой случай:
    // «Неожиданная встреча»). Гейт по меню такой квест не пропустил бы никогда.
    if (q.inQMenu !== false) {
      if (!(await m.resetToQuestMenu(page))) return false;
      const qText = await m.getBodyText(page);
      if (!qText.includes(q.name)) return false;
    }
    // Длинным маршрутам нужен резерв: без него дорога встаёт на первом же переходе.
    if (q.minReserveMinutes) {
      const { getReserveMinutesSafe } = require('../lib/hp');
      const reserve = await getReserveMinutesSafe(page).catch(() => null);
      if (typeof reserve === 'number' && reserve < q.minReserveMinutes) {
        // 5 минут, не 20: резерв колеблется около нуля поминутно, ждать четверть часа незачем.
        qs.suppressedUntil = now + 5 * 60000;
        // 27.09.2026: три квеста с гейтом по резерву весь час ждали впустую - драйвер в это время
        // уходил в часовую фарм-сессию, которая резерв и съедала, так что он не поднимался никогда.
        // Метка ниже говорит простою «квест доступен и ждёт ТОЛЬКО резерв» - фарм тогда не начинаем.
        qs.reserveWaitAt = now;
        qs.reserveNeed = q.minReserveMinutes;
        qs.reserveHave = reserve;
        st[q.name] = qs;
        saveState(st);
        console.log(`${q.name}: резерва ${reserve} мин, нужно ${q.minReserveMinutes} -> проверю через 5 мин.`);
        return false;
      }
      delete qs.reserveWaitAt;
      delete qs.reserveNeed;
      delete qs.reserveHave;
    }
    // Слот проверяем ДО эля: иначе эль выпивается, а задание не берётся.
    if (q.needsSlot && !(await taskSlotFree(page, q.name))) {
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
    if (q.takesSlot || q.needsSlot) require('../lib/task_slot').rememberSlotTaken(q.name);
    console.log(`${q.name}: квест доступен, начинаю по записанному маршруту.`);
  }

  const localDayKey = (t) => new Date(t).toLocaleDateString('sv-SE');
  for (let p = qs.part; p < q.files.length; p++) {
    // dayGatedParts: части = игровые ДНИ, между ними игра сама говорит «расследование лучше начать
    // завтра» («Жертвоприношение»). Вторую часть в тот же календарный день начинать бессмысленно -
    // маршрут упрётся в отсутствующую реплику и спалит счётчик срывов.
    if (q.dayGatedParts && p > 0 && qs.partDoneDay === localDayKey(Date.now())) {
      console.log(`${q.name}: часть ${p + 1} - это следующий игровой день, сегодня часть ${p} уже пройдена. Жду завтра.`);
      return false;
    }
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
    if (q.dayGatedParts) qs.partDoneDay = localDayKey(Date.now());
    st[q.name] = qs;
    saveState(st);
  }

  qs.lastDone = Date.now();
  delete qs.part;
  delete qs.suppressedUntil;
  delete qs.failCount;
  delete qs.failIndex;
  delete qs.failPart;
  delete qs.partDoneDay;
  st[q.name] = qs;
  saveState(st);
  clearProgress(q);
  if (q.takesSlot || q.needsSlot) require('../lib/task_slot').forgetSlotOwner();
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
