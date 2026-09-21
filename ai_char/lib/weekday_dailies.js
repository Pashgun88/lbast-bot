// Дейлики по дням недели: четверг в Мисттоуне, охоты Ср/Пт, выход из зависших сцен.
// Выделено из ai_char/module.js (там только сборка экспорта). Изменяемое состояние - S из ./state.

// Экспорт стоит ДО require: файлы lib/ вызывают друг друга по кругу, а объявления функций
// всплывают (hoisting), поэтому к моменту любого встречного require все функции уже здесь.
module.exports = {
  goToMisstoneMainStreet, progressGravediggerHouse, progressButcherHouse, progressDeadEndHouse,
  progressGravediggerBoss, progressDeadEndBoss, readDailyTasksProgress, resolvePendingFightIfAny,
  escapeStuckSceneIfAny, weekdayHuntState, weekdayHuntHpOk, weekdayHuntRideByHorse,
  weekdayHuntRoute, runWeekdayHuntTarget, runWeekdayHuntsIfDue, runThursdayDailiesIfAvailable,
};

const {
  DEMON_LAKE_FASTWAY_URL, getDayKeyNow, getWeekday, parseCooldownError, persistedState,
  saveStateToDisk, THURSDAY_WEEKDAY,
} = require('./state');
const { getBodyText, parseStats, pause } = require('./core');
const { runNonQQuestSafe } = require('./daily_quests');
const { fightLoop } = require('./fight');
const { questFightHpGate, tryPerformStepOptional } = require('./hp');
const { isBattleScreenText } = require('./pvp');
const { clickByTexts, existsAnyText, performStep } = require('./ui');

// ===================================================================================
// "Рыбий глаз" (Fish Eye) для AI__ — идентично Tsunami: тот же неQ-механизм
// (canRunFishEyeFightNow/canRunFishEyeRewardNow + runFishEyeFight/tryClaimFishEyeReward),
// который у Tsunami вызывается из doScenario. driver.js AI__ вызывает runDailyQuests
// напрямую, минуя doScenario, поэтому Fish Eye никогда не запускался — обёртка ниже
// вызывает тот же код явно, каждый цикл, независимо от Q.
// ===================================================================================
// ===================================================================================
// ДЕЙЛИКИ ПО ДНЮ НЕДЕЛИ - четверг (гайд Паши, 17.09.2026).
// Общий пролог у всех трёх: Конь -> Мисстоун -> Идти в город -> Идти на главную улицу.
//
// ВАЖНО: реализованы ТОЛЬКО безбоевые варианты. Паша: "Пока только без боя". В гайде у
// могильщика и у дома в тупике есть ещё боссы (Призрак тёщи могильщика -> Ржавая сковорода,
// Призрачная ведьма -> Коготь ведьмы) - они СОЗНАТЕЛЬНО не трогаются, пока маршрут не
// проверен живьём. Когда дойдёт до них - бой обязан идти через questFightHpGate.
//
// НЕ ПРОВЕРЕНО ВЖИВУЮ: маршруты записаны со слов, первый запуск смотреть по логам.
// ===================================================================================
async function goToMisstoneMainStreet(page) {
  // В списке коня город называется "МисТТоун" (два "т"), а в гайде было записано "Мисстоун".
  // Живой провал 17.09.2026: все три четверговых маршрута упали на этом шаге по три попытки
  // каждый ("Не найдено для шага Мисстоун"), хотя в списке рядом видно "» Мисттоун »".
  // Тот же класс ошибки, что с Эль "Вырви глаз" - принимаем оба написания.
  const MISSTONE = ['Мисттоун', 'мисттоун', 'Мисстоун', 'мисстоун'];

  await performStep(page, {
    stepName: 'Конь',
    currentTexts: ['Конь', 'конь'],
    nextTexts: MISSTONE,
    retries: 3,
  });
  await performStep(page, {
    stepName: 'Мисттоун',
    currentTexts: MISSTONE,
    waitAfterClickMs: 7000,
    retries: 3,
  });
  // Поездка длится дольше одного клика: живьём 17.09.2026 понадобилось ПЯТЬ нажатий
  // "В пути еще". Одного if-а не хватало, и следующий шаг не находился.
  for (let i = 0; i < 15; i++) {
    const t = await getBodyText(page);
    if (/Идти в город|Идти на запад/i.test(t)) break;
    if (/В пути/i.test(t)) {
      await clickByTexts(page, ['В пути еще', 'В пути ещё', 'В пути', 'в пути'], `В пути (${i + 1})`).catch(() => {});
    }
    await pause(page, 1600, 2200);
  }

  await performStep(page, { stepName: 'Идти в город', currentTexts: ['Идти в город'], retries: 3 });

  // ВАЖНО: ссылки "Идти на главную улицу" в игре НЕ СУЩЕСТВУЕТ - в гайде это было описание,
  // а не кнопка. Разведано живьём 17.09.2026: вход в город ведёт на окраину (только
  // запад/восток), и ОДИН шаг на запад - это "Мисттоун. Центральная улица", где и стоят оба
  // дома (мясника и могильщика). Восток уводит из города на "Дорогу" к замку Альянса.
  await performStep(page, { stepName: 'Идти на запад (к домам)', currentTexts: ['Идти на запад'], retries: 3 });
}

// Дом могильщика, безбоевая ветка: ... -> Идти в дом могильщика -> Идти в правую дверь ->
// квест "Разбить гробы".
async function progressGravediggerHouse(page) {
  await goToMisstoneMainStreet(page);
  await performStep(page, { stepName: 'Идти в дом могильщика', currentTexts: ['Идти в дом могильщика'], retries: 3 });
  await performStep(page, { stepName: 'Идти в правую дверь', currentTexts: ['Идти в правую дверь'], retries: 3 });
  const ok = await clickByTexts(page, ['Разбить гробы', 'разбить гробы'], 'Разбить гробы');
  if (!ok) {
    console.log('Четверг/могильщик: "Разбить гробы" не найдено - возможно, уже сделано сегодня.');
    return false;
  }
  await pause(page, 800, 1500);
  await clickByTexts(page, ['В игру', 'в игру'], 'В игру (могильщик)').catch(() => {});
  return true;
}

// Дом мясника: ... -> Идти в дом мясника -> Войти в желтую дверь -> Мясник.
async function progressButcherHouse(page) {
  await goToMisstoneMainStreet(page);
  await performStep(page, { stepName: 'Идти в дом мясника', currentTexts: ['Идти в дом мясника'], retries: 3 });
  await performStep(page, {
    stepName: 'Войти в желтую дверь',
    currentTexts: ['Войти в желтую дверь', 'Войти в жёлтую дверь'],
    retries: 3,
  });
  // Разведано живьём 17.09.2026: за жёлтой дверью "Желтая комната" с полуистлевшим трупом в
  // мясницком фартуке, и выбора там всего два - "Выскочить из комнаты" и "Атаковать".
  // Ссылки "Мясник" НЕТ: "Мясник" из гайда - это и есть босс, то есть дейлик боевой.
  // Паша: "Пока только без боя" -> не атакуем. Уходим через "Выскочить из комнаты", чтобы не
  // оставлять за собой экран с активной кнопкой боя (иначе его подберёт другой обработчик -
  // ровно так 17.09.2026 начался бой с корованом мимо всех гейтов).
  // Паша, 17.09.2026: "четверг - делай просто по гайду", то есть боссов проходим.
  // Бой обязателен через гейт; если HP не хватает - ЖДЁМ, а не бросаем (waitForRecovery),
  // иначе маршрут сюда придётся идти заново. Если в бой всё же нельзя - уходим из комнаты,
  // чтобы не оставить за собой активную кнопку "Атаковать".
  if (await existsAnyText(page, ['Атаковать'])) {
    // Паша, 17.09.2026: "то что без боя можно не ждать восстановления хп и делай пока резервы
    // есть чтобы не простаивать зря". Поэтому НЕ ждём лечения внутри маршрута: ожидание
    // держало весь цикл (живьём - 7 минут на одном боссе), пока рядом стояли доступные
    // безбоевые дела. Гейт остаётся, но при нехватке HP просто выходим и вернёмся в
    // следующем цикле - маршрут сюда дешёвый (конь + пара кликов).
    if (!(await questFightHpGate(page, 'Четверг: мясник (Желтая комната)'))) {
      await clickByTexts(page, ['Выскочить из комнаты'], 'Выскочить из комнаты').catch(() => {});
      return false;
    }
    console.log('Четверг/мясник: бой в Желтой комнате.');
    await clickByTexts(page, ['Атаковать'], 'Атаковать (мясник)');
    await fightLoop(page);
    await pause(page, 800, 1500);
    await clickByTexts(page, ['В игру', 'в игру'], 'В игру (мясник)').catch(() => {});
    return true;
  }

  const ok = await clickByTexts(page, ['Мясник', 'мясник'], 'Мясник');
  if (!ok) {
    console.log('Четверг/мясник: ни "Атаковать", ни "Мясник" не найдены - похоже, на сегодня уже сделано.');
    return false;
  }
  await pause(page, 800, 1500);
  await clickByTexts(page, ['В игру', 'в игру'], 'В игру (мясник)').catch(() => {});
  return true;
}

// Дом в тупике, безбоевая ветка: ... -> 2 раза Запад -> Свернуть в переулок -> Идти к дому ->
// Осмотреть кучу тряпья.
async function progressDeadEndHouse(page) {
  await goToMisstoneMainStreet(page);
  // От Центральной улицы (куда привёл пролог) до переулка - ещё ДВА шага на запад.
  // Разведано живьём: запад x2 - Главная улица с разломом, запад x3 - Главная улица, где
  // и появляется "Свернуть в переулок". Гайд считал шаги именно от Центральной улицы.
  for (let i = 1; i <= 2; i++) {
    await performStep(page, {
      stepName: `Идти на запад (${i}/2, к переулку)`,
      currentTexts: ['Идти на запад'],
      skipIfNextVisible: false,
      retries: 3,
    });
  }
  await performStep(page, { stepName: 'Свернуть в переулок', currentTexts: ['Свернуть в переулок'], retries: 3 });
  await performStep(page, { stepName: 'Идти к дому', currentTexts: ['Идти к дому'], retries: 3 });
  const ok = await clickByTexts(page, ['Осмотреть кучу тряпья', 'осмотреть кучу тряпья'], 'Осмотреть кучу тряпья');
  if (!ok) {
    console.log('Четверг/тупик: "Осмотреть кучу тряпья" не найдено - возможно, уже сделано сегодня.');
    return false;
  }
  await pause(page, 800, 1500);
  await clickByTexts(page, ['В игру', 'в игру'], 'В игру (тупик)').catch(() => {});
  return true;
}

// Босс могильщика (гайд): ... -> Идти в дом могильщика -> Идти в правую дверь ->
// Спуститься в чулан -> Атаковать. Призрак тёщи могильщика, даёт "Ржавую сковороду".
// НЕ ПРОВЕРЕНО ВЖИВУЮ - первый запуск смотреть по логам.
async function progressGravediggerBoss(page) {
  await goToMisstoneMainStreet(page);
  await performStep(page, { stepName: 'Идти в дом могильщика', currentTexts: ['Идти в дом могильщика'], retries: 3 });
  await performStep(page, { stepName: 'Идти в правую дверь', currentTexts: ['Идти в правую дверь'], retries: 3 });
  await performStep(page, { stepName: 'Спуститься в чулан', currentTexts: ['Спуститься в чулан'], retries: 3 });

  // Без ожидания лечения - см. комментарий у мясника: простой всего цикла дороже, чем
  // повторная поездка сюда в следующем заходе.
  if (!(await questFightHpGate(page, 'Четверг: призрак тёщи могильщика'))) {
    return false;
  }
  console.log('Четверг/могильщик: бой с призраком тёщи (ожидается "Ржавая сковорода").');
  await clickByTexts(page, ['Атаковать'], 'Атаковать (призрак тёщи)');
  await fightLoop(page);
  await pause(page, 800, 1500);
  await clickByTexts(page, ['В игру', 'в игру'], 'В игру (могильщик, босс)').catch(() => {});
  return true;
}

// Босс дома в тупике (гайд): ... -> Свернуть в переулок -> Идти к дому -> Войти в дом ->
// Войти в дверь -> Войти в комнату -> Идти в глубь комнаты -> Атаковать.
// Призрачная ведьма, даёт "Коготь ведьмы". НЕ ПРОВЕРЕНО ВЖИВУЮ.
async function progressDeadEndBoss(page) {
  await goToMisstoneMainStreet(page);
  for (let i = 1; i <= 2; i++) {
    await performStep(page, {
      stepName: `Идти на запад (${i}/2, к переулку)`,
      currentTexts: ['Идти на запад'],
      skipIfNextVisible: false,
      retries: 3,
    });
  }
  await performStep(page, { stepName: 'Свернуть в переулок', currentTexts: ['Свернуть в переулок'], retries: 3 });
  await performStep(page, { stepName: 'Идти к дому', currentTexts: ['Идти к дому'], retries: 3 });
  await performStep(page, { stepName: 'Войти в дом', currentTexts: ['Войти в дом'], retries: 3 });
  await performStep(page, { stepName: 'Войти в дверь', currentTexts: ['Войти в дверь'], retries: 3 });
  await performStep(page, { stepName: 'Войти в комнату', currentTexts: ['Войти в комнату'], retries: 3 });
  await performStep(page, { stepName: 'Идти в глубь комнаты', currentTexts: ['Идти в глубь комнаты'], retries: 3 });

  // Без ожидания лечения - см. комментарий у мясника.
  if (!(await questFightHpGate(page, 'Четверг: призрачная ведьма'))) {
    return false;
  }
  console.log('Четверг/тупик: бой с призрачной ведьмой (ожидается "Коготь ведьмы").');
  await clickByTexts(page, ['Атаковать'], 'Атаковать (призрачная ведьма)');
  await fightLoop(page);
  await pause(page, 800, 1500);
  await clickByTexts(page, ['В игру', 'в игру'], 'В игру (тупик, босс)').catch(() => {});
  return true;
}

// Меню ежедневных заданий (ссылка "D<N>" на локации -> location.php?r=NNNN&mod=daily).
// Разобрано живьём 17.09.2026 по скриншоту Паши: строки имеют вид "1/4 Обыскать дом мясника
// в Мисттоуне", то есть игра САМА показывает прогресс. Это единственный надёжный источник:
// свои булевы флаги в state.json меня подвели - я пометил цель выполненной после одного
// прохода и объявил четверг закрытым, когда на деле было 1/4.
// r= меняется при каждой загрузке, поэтому href берём со свежей страницы, а не хардкодим.
async function readDailyTasksProgress(page) {
  await page.goto('http://lbast.ru/location.php', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  const href = await page
    .evaluate(() => {
      const a = Array.from(document.querySelectorAll('a'))
        .find((x) => (x.getAttribute('href') || '').includes('mod=daily'));
      return a ? a.getAttribute('href') : null;
    })
    .catch(() => null);

  if (!href) {
    console.log('Дейлики: ссылка на меню ежедневных заданий не найдена.');
    return [];
  }

  await page.goto(`http://lbast.ru/${href.replace(/^\//, '')}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await pause(page, 400, 800);

  const text = await getBodyText(page);
  const tasks = [];
  for (const line of text.split('\n')) {
    const m = line.trim().match(/^(\d+)\s*\/\s*(\d+)\s+(.+)$/);
    if (!m) continue;
    tasks.push({ done: Number(m[1]), total: Number(m[2]), title: m[3].trim() });
  }

  // ОБЯЗАТЕЛЬНО вернуться на локацию. Живой баг 17.09.2026: функция оставляла страницу на
  // меню дейликов, и следующий же маршрут падал на первом шаге - "Не найден шаг Мисттоун
  // (url=...&mod=daily)", потому что ссылки "Конь" в меню нет. Первый маршрут срывался,
  // второй проходил только потому, что после recoverToCity мы случайно оказывались в городе.
  await page.goto('http://lbast.ru/location.php', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  await pause(page, 300, 700);

  return tasks;
}

// Квестовая сцена может оставить персонажа "внутри себя": location.php отдаёт не локацию, а
// экран сцены. Живой случай 17.09.2026 - Чулан дома могильщика ("Убежать" / "Атаковать").
// Шапки со статами там нет и ссылки Q нет, поэтому сыплется ВЕСЬ цикл: parseStats даёт
// null/null, "Не найдено для шага open quests menu", runDailyQuests возвращает пустоту.
// Внешне похоже на автобан или на залипший бой, но это ни то, ни другое.
// Выход из таких сцен всегда безопасный. Бой отсюда НЕ начинаем: это решение, и оно обязано
// идти через questFightHpGate, а не через "нажми хоть что-нибудь".
const STUCK_SCENE_EXITS = ['Убежать', 'Выскочить из комнаты', 'Выйти из дома', 'Вернуться', 'Уйти'];

// Висящий бой посреди цикла. Симптом: location.php отдаёт голый "В бой!" со ссылкой boj=,
// статов нет, Q-меню нет - и весь остаток цикла идёт вслепую (null/null). 18.09.2026 так
// запирало игру трижды за утро (Харчевня, Корованы, засада Телохранителя у банкира), и каждый
// раз вытаскивал вручную. Вариантов у такого экрана ровно два:
//  - бой уже ЗАВЕРШЁН, но итог не подтверждён (игра держит персонажа, HP не растёт) -> подтвердить;
//  - бой идёт -> только довести. Отказаться нельзя, а ждать HP бессмысленно: в бою оно почти
//    не растёт (+18 за 40 минут). fightLoop сам пьёт эликсиры с пояса при низком HP.
async function resolvePendingFightIfAny(page) {
  await page.goto('http://lbast.ru/location.php', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  const boj = await page.evaluate(() => {
    const a = Array.from(document.querySelectorAll('a')).find((x) => (x.getAttribute('href') || '').includes('boj='));
    return a ? a.getAttribute('href') : null;
  }).catch(() => null);
  if (!boj) return false;

  await page.goto(`http://lbast.ru/${boj.replace(/^\//, '')}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  const text = await getBodyText(page);
  if (/Бой завершен/i.test(text)) {
    console.log('Висящий бой: он уже завершён, подтверждаю итог.');
    await clickByTexts(page, ['Бой завершен!', 'Бой завершен'], 'Бой завершен (подтверждение итога)').catch(() => {});
    return true;
  }
  if (!/Ударить/i.test(text)) {
    console.log('Висящий бой: экран боя без "Ударить" и без итога - не понимаю, что это, не трогаю.');
    return false;
  }
  // Нападение живого игрока (латинский ник) отдаём handleIncomingAttackIfAny - там оповещение.
  const foe = (text.match(/VS\.\s*\n\s*([^\n\[]+?)\s*\[\d+\]/) || [])[1] || '';
  if (/^[A-Za-z0-9_.-]+$/.test(foe)) {
    console.log(`Висящий бой: противник похож на игрока (${foe}) -> отдаю обработчику нападений.`);
    return false;
  }
  const me = text.match(/AI__\s*\[\d+\]\s*\((-?\d+)\s*\/\s*(\d+)\)/);
  console.log(`Висящий бой: идёт (HP ${me ? me[1] + '/' + me[2] : '?'}) -> довожу, другого выхода из него нет.`);
  await fightLoop(page);
  return true;
}

async function escapeStuckSceneIfAny(page) {
  const text = await getBodyText(page);
  if (isBattleScreenText(text)) return false; // это бой - им занимается другой код

  // ВАЖНО: определять сцену по отсутствию шапки со статами НЕЛЬЗЯ. Живая проверка 17.09.2026:
  // в Чулане шапка была на месте - "AI__ (245/380) (23) Q9 D6", - и такая проверка молча
  // пропустила бы застревание. Надёжный признак: на обычной локации есть ссылка на меню
  // квестов (mod=quests), а внутри квестовой сцены её нет.
  const onNormalLocation = await page
    .evaluate(() => Boolean(document.querySelector('a[href*="mod=quests"]')))
    .catch(() => true); // не смогли проверить - считаем, что всё нормально, и не трогаем
  if (onNormalLocation) return false;

  for (const exit of STUCK_SCENE_EXITS) {
    if (await existsAnyText(page, [exit])) {
      console.log(`Залипшая сцена: выхожу через "${exit}" (шапки со статами нет, Q недоступно).`);
      await clickByTexts(page, [exit], `выход из сцены (${exit})`).catch(() => {});
      await pause(page, 600, 1200);
      await page.goto('http://lbast.ru/location.php', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
      return true;
    }
  }
  return false;
}

// Сопоставление строк меню дейликов с маршрутами. Названия в меню (снято со скриншота Паши
// 17.09.2026): "Обыскать дом могильщика в Мисттоуне", "Обыскать дом мясника в Мисттоуне",
// "Обыскать дом в тупике в Мисттоуне".
// Для могильщика и тупика берём БЕЗБОЕВЫЕ ветки: они не тратят HP и не упираются в гейт, а
// засчитываются так же. У мясника безбоевого пути нет вовсе - за жёлтой дверью только
// "Атаковать", - поэтому там маршрут с боем и гейтом.
const THURSDAY_TASK_ROUTES = [
  { re: /дом\s+могильщика/i, label: 'Дом могильщика', fn: (p) => progressGravediggerHouse(p) },
  { re: /дом\s+мясника/i, label: 'Дом мясника', fn: (p) => progressButcherHouse(p) },
  { re: /дом\s+в\s+тупике/i, label: 'Дом в тупике', fn: (p) => progressDeadEndHouse(p) },
];

// ===================================================================================
// Дейлики по дню недели «как у Цунами» (Паша, 19.09.2026: «активируй дейлики как у цунами. Все
// идентично кроме четверга, четверг у тебя свой»). Порт EXTRA_DAILY_TASKS из origin/main
// (daily_quests_piraty.js, fb9dea7): Вс - кабан x3 + бизон x3; Вт - гарпии x3 (уже есть,
// runHarpyFarmRound); Ср - дух гор, гиены x2, кабан x2, бизон x2, варан x2; Пт - кабан x2, варан x2.
// Кабан и бизон у AI__ фармятся каждый цикл по тем же маршрутам, что у Цунами, поэтому здесь только
// то, чего в фарме нет: дух гор, гиены, варан. Маршруты взяты из кода Цунами, для AI__ вживую ещё
// НЕ проверены. Отличия от Цунами: HP-гейт 70% перед выездом и перед каждым боем (ниже - просто
// ждём следующего цикла), и после проигрыша цель на сегодня бросается, чтобы не умирать по кругу.
// ===================================================================================
const WEEKDAY_HUNT_PLAN = {
  3: [['spirit', 1], ['hyena', 2], ['varan', 2]], // среда
  5: [['varan', 2]],                              // пятница
};
const WEEKDAY_HUNT_NAMES = { spirit: 'дух гор', hyena: 'гиены', varan: 'варан' };
const WEEKDAY_HUNT_HP_FLOOR = 0.7;

function weekdayHuntState() {
  const key = getDayKeyNow();
  let s = persistedState.weekdayHunts;
  if (!s || s.dayKey !== key) {
    s = { dayKey: key, done: {}, lost: {} };
    persistedState.weekdayHunts = s;
  }
  return s;
}

async function weekdayHuntHpOk(page, label) {
  await page.goto('http://lbast.ru/location.php', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  const st = parseStats(await getBodyText(page));
  if (typeof st.hpCurrent !== 'number' || typeof st.hpMax !== 'number' || st.hpMax <= 0) return false;
  const ok = st.hpCurrent >= st.hpMax * WEEKDAY_HUNT_HP_FLOOR;
  if (!ok) console.log(`Дейлик (${label}): HP ${st.hpCurrent}/${st.hpMax} ниже 70% -> в следующем цикле.`);
  return ok;
}

async function weekdayHuntRideByHorse(page, city, firstStep) {
  const V_PUTI = ['В пути еще', 'В пути ещё', 'В пути'];
  await performStep(page, { stepName: 'Конь', currentTexts: ['Конь', 'конь'], nextTexts: [city], retries: 3 });
  await performStep(page, {
    stepName: city, currentTexts: [city], waitAfterClickMs: 7000,
    nextTexts: [...V_PUTI, firstStep], retries: 3,
  });
  // Поездка бывает длинной (до Мисттоуна - пять «В пути еще»), поэтому цикл, а не один клик.
  for (let i = 0; i < 8; i++) {
    const t = await getBodyText(page);
    if (new RegExp(firstStep, 'i').test(t)) break;
    const ok = await tryPerformStepOptional(page, {
      stepName: 'В пути', currentTexts: V_PUTI, nextTexts: [firstStep], waitForNextMs: 30000,
    });
    if (!ok) await page.waitForTimeout(5000);
  }
}

// Возвращает текст кнопки, которая открывает бой на месте.
async function weekdayHuntRoute(page, target) {
  if (target === 'spirit') {
    // Конь -> Горы Дарии -> запад/юг/запад/запад/север/север -> Осмотреть пещеру -> Спуститься в тоннель (бой)
    await weekdayHuntRideByHorse(page, 'Горы Дарии', 'Запад');
    for (const [dir, n] of [['Запад', 1], ['Юг', 2], ['Запад', 3], ['Запад', 4], ['Север', 5], ['Север', 6]]) {
      await performStep(page, { stepName: `${dir} (${n}/6)`, currentTexts: [dir, dir.toLowerCase()], retries: 3, skipIfNextVisible: false });
    }
    await performStep(page, { stepName: 'Осмотреть пещеру', currentTexts: ['Осмотреть пещеру'], nextTexts: ['Спуститься в тоннель'], retries: 3 });
    return 'Спуститься в тоннель';
  }
  if (target === 'hyena') {
    // Амулет -> Таверна -> юг -> запад -> Выслеживать гиен
    await performStep(page, { stepName: 'Амулет', currentTexts: ['Амулет', 'амулет'], nextTexts: ['Таверна'], retries: 3 });
    await performStep(page, { stepName: 'Таверна', currentTexts: ['Таверна'], nextTexts: ['Юг'], retries: 3 });
    await performStep(page, { stepName: 'Юг', currentTexts: ['Юг', 'юг'], nextTexts: ['Запад'], retries: 3, skipIfNextVisible: false });
    await performStep(page, { stepName: 'Запад', currentTexts: ['Запад', 'запад'], nextTexts: ['Выслеживать гиен'], retries: 3 });
    return 'Выслеживать гиен';
  }
  // varan: Дорожный крест (fastway lway=9; «Амулет» текстом не кликаем - латинская A) -> юг -> Устроиться на привал
  await page.goto(DEMON_LAKE_FASTWAY_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await pause(page, 500, 900);
  await performStep(page, { stepName: 'Юг', currentTexts: ['Юг', 'юг', 'Идти на юг'], nextTexts: ['Устроиться на привал'], retries: 3 });
  return 'Устроиться на привал';
}

async function runWeekdayHuntTarget(page, target, count) {
  const s = weekdayHuntState();
  const name = WEEKDAY_HUNT_NAMES[target];
  const done = s.done[target] || 0;
  if (done >= count || s.lost[target]) return false;
  if (!(await weekdayHuntHpOk(page, name))) return false;

  console.log(`Дейлик: ${name} - выезжаю (сделано ${done}/${count}).`);
  let fightText;
  try {
    fightText = await weekdayHuntRoute(page, target);
  } catch (e) {
    console.log(`Дейлик: ${name} - маршрут не пройден: ${e.message}`);
    s.lost[target] = 'route';
    saveStateToDisk(persistedState);
    return true;
  }

  for (let i = done; i < count; i++) {
    const st = parseStats(await getBodyText(page));
    if (typeof st.hpCurrent === 'number' && typeof st.hpMax === 'number' && st.hpCurrent < st.hpMax * WEEKDAY_HUNT_HP_FLOOR) {
      console.log(`Дейлик (${name}): HP ${st.hpCurrent}/${st.hpMax} ниже 70% перед боем ${i + 1}/${count} -> доделаю в следующем цикле.`);
      break;
    }
    const hpBefore = st.hpCurrent;
    await performStep(page, { stepName: `${fightText} (${i + 1}/${count})`, currentTexts: [fightText, fightText.toLowerCase()], retries: 3 });
    let won;
    try {
      won = await fightLoop(page);
    } catch (e) {
      const waitMinutes = parseCooldownError(e);
      if (waitMinutes !== null) {
        console.log(`Дейлик (${name}): цель на кулдауне (${waitMinutes} мин, сделано ${i}/${count}) -> в следующем цикле.`);
        await clickByTexts(page, ['Назад', 'назад'], 'Назад').catch(() => {});
        break;
      }
      console.log(`Дейлик (${name}): ошибка боя: ${e.message}`);
      won = null;
    }
    const after = parseStats(await getBodyText(page));
    console.log(`Дейлик: ${name} бой ${i + 1}/${count} result=${won} HP ${hpBefore}->${after.hpCurrent}`);
    if (won === false || (typeof after.hpCurrent === 'number' && after.hpCurrent <= 0)) {
      console.log(`Дейлик: ${name} - проиграл, на сегодня эту цель бросаю.`);
      s.lost[target] = 'lost';
      saveStateToDisk(persistedState);
      break;
    }
    s.done[target] = i + 1;
    saveStateToDisk(persistedState);
    await pause(page, 800, 1400);
  }

  if (await existsAnyText(page, ['В игру'])) {
    await clickByTexts(page, ['В игру'], 'В игру').catch(() => {});
    await pause(page, 800, 1600);
  }
  return true;
}

// По одной цели за вызов, как четверг: не занимать драйвер надолго.
async function runWeekdayHuntsIfDue(page) {
  const plan = WEEKDAY_HUNT_PLAN[getWeekday()];
  if (!plan) return false;
  for (const [target, count] of plan) {
    const s = weekdayHuntState();
    if ((s.done[target] || 0) >= count || s.lost[target]) continue;
    return runWeekdayHuntTarget(page, target, count);
  }
  return false;
}

async function runThursdayDailiesIfAvailable(page) {
  if (getWeekday() !== THURSDAY_WEEKDAY) {
    return false; // сегодня не четверг - этих дейликов просто нет
  }

  // ИСТОЧНИК ИСТИНЫ - САМА ИГРА, а не наши флаги. Паша, 17.09.2026, прислал скриншот меню
  // дейликов: "1/2 Собрать два эликсира...", "1/4 Обыскать дом мясника", "2/4 Обыскать дом в
  // тупике". Эти задания МНОГОКРАТНЫЕ, а прежний код помечал цель выполненной после одного
  // прохода - и я на этом основании объявил четверг закрытым при 1/4. Поля
  // thursdayDailiesDone в state.json больше не участвуют в решениях (оставлены как история).
  const tasks = await readDailyTasksProgress(page);
  if (!tasks.length) {
    console.log('Четверг: меню ежедневных заданий не прочиталось - пропускаю в этом цикле.');
    return false;
  }

  console.log(`Дейлики дня: ${tasks.map((t) => `${t.done}/${t.total} ${t.title}`).join(' | ')}`);

  const pending = tasks.filter((t) => t.done < t.total);
  if (!pending.length) {
    console.log('Четверг: все ежедневные задания закрыты.');
    return false;
  }

  // По ОДНОМУ заходу на цель за цикл. Четыре подряд надолго заняли бы драйвер, а Паша просил
  // не простаивать: "делай пока резервы есть чтобы не простаивать зря". Остаток доберём в
  // следующих циклах - счётчик игры сам покажет, когда цель закрыта.
  let didAnything = false;
  for (const t of pending) {
    const route = THURSDAY_TASK_ROUTES.find((r) => r.re.test(t.title));
    if (!route) continue; // например "Собрать два эликсира с дерева жизни" - это квест Дерево жизни

    const ok = await runNonQQuestSafe(page, `Четверг: ${route.label} (${t.done}/${t.total})`, () => route.fn(page));
    if (ok) {
      didAnything = true;
      console.log(`Четверг: заход в "${route.label}" выполнен (было ${t.done}/${t.total}).`);
    }
  }
  return didAnything;
}
