// Квест "Рыбный ресторан Тёща Кумуса" (выключен, см. FISH_RESTAURANT_ENABLED).
// Выделено из ai_char/module.js (там только сборка экспорта). Изменяемое состояние - S из ./state.

// Экспорт стоит ДО require: файлы lib/ вызывают друг друга по кругу, а объявления функций
// всплывают (hoisting), поэтому к моменту любого встречного require все функции уже здесь.
module.exports = {
  goToFishRestaurant, progressFishRestaurantJournal, goToFishRestaurantBranch, skipTravelVignettes,
  progressFishRestaurantReward1, runFishRestaurantQuestIfAvailable,
};

const {
  S, FISH_RESTAURANT_ENABLED, getDayKeyNow, persistDailyQuestState, QUEST_FIGHT_HP_FLOOR,
} = require('./state');
const { waitOutHorseTravel } = require('./assassins');
const { getBodyText, pause } = require('./core');
const { runNonQQuestSafe } = require('./daily_quests');
const { fightLoop } = require('./fight');
const { questFightHpGate, tryPerformStepOptional } = require('./hp');
const { isBattleScreenText } = require('./pvp');
const {
  clickInfoForQuest, isQuestInMenu, parseQuestNamesFromQMenuText, resetToQuestMenu,
} = require('./quest_menu');
const { clickByTexts, existsAnyText, performStep } = require('./ui');

// ===================================================================================
// "Рыбный ресторан Тёща Кумуса" (эскорт-квест с Яшкой/Гретхис) — источник: блог Dikaya в
// игре (zhg_web.php?st_id=224300, st_id=225290), см. LESSONS_AI_CHAR.md "Рыбный ресторан".
// НЕ проверено вживую - маршрут записан буквально по тексту гайда. Паша попросил проходить
// награды журнала по порядку номеров (15.09.2026), начиная с №1.
// ===================================================================================

// 15.09.2026, первая живая попытка: простой заход пешком (fastway -> клик "Рыбный
// ресторан") приводит только к NPC Гретхис, которая молча здоровается ("Уйти" —
// единственный вариант) - без формального "взятия" квеста через Q-меню игра не
// поднимает сценарий (то же самое, что и "Колодец Страха" - см. LESSONS_AI_CHAR.md).
// Правильный вход - как у Кораблекрушения: [инфо] в Q-меню -> "К месту выполнения".
// НО если квест уже взят и диалог на середине (Паша вручную прошёл начало живьём
// 15.09.2026: Тёща Кумуса -> "Я насчет работы." -> Яшка спрашивает про мрамару ->
// развилка Холмы/Болота/Опушка) - location.php показывает "Продолжить квест" наверху,
// и заходить заново через [инфо] НЕЛЬЗЯ (потеряется прогресс диалога, тот же принцип,
// что и для Штолен). Проверяем это первым делом.
async function goToFishRestaurant(page) {
  await page.goto('http://lbast.ru/location.php', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await pause(page, 500, 1000);

  if (await existsAnyText(page, ['Продолжить квест'])) {
    await clickByTexts(page, ['Продолжить квест'], 'Продолжить квест');
    await pause(page, 800, 1500);
    return;
  }

  const QUEST = 'Рыбный ресторан';
  const menuOk = await resetToQuestMenu(page);
  if (!menuOk) {
    throw new Error('Fish Restaurant: could not open quest menu.');
  }
  const infoOk = await clickInfoForQuest(page, QUEST);
  if (!infoOk) {
    throw new Error('Fish Restaurant: could not open quest info.');
  }
  const travelOk = await clickByTexts(page, ['К месту выполнения'], 'К месту выполнения');
  if (!travelOk) {
    throw new Error('Fish Restaurant: "К месту выполнения" not found.');
  }
  await pause(page, 6500, 7500);
  await waitOutHorseTravel(page, page.url());

  // Свежий заход: Форт Жженого листа -> "Рыбный ресторан" -> "Тёща Кумуса" -> "Я насчет
  // работы." запускает цепочку диалога (Тёща Кумуса -> Яшка про мрамару -> развилка).
  // Остальные реплики между ними - best-effort клики, не критичные (страница может
  // проскочить их сама); если что-то не найдётся, просто идём дальше к развилке.
  await performStep(page, { stepName: 'Рыбный ресторан (вход)', currentTexts: ['Рыбный ресторан', 'рыбный ресторан'], retries: 3 });
  // 25.09.2026: дальше проход падал на «Тёща Кумуса», а performStep при ненайденном шаге
  // перезагружает location.php - и настоящий экран внутри ресторана в лог не попадал ни разу.
  // Печатаем его сразу после входа, до любых шагов.
  {
    const inside = await page.evaluate(() => Array.from(document.querySelectorAll('a'))
      .map((a) => (a.innerText || '').trim()).filter(Boolean)).catch(() => []);
    const insideText = (await getBodyText(page).catch(() => '')).replace(/\s+/g, ' ');
    console.log(`Рыбный ресторан: внутри ссылки: ${inside.join(' | ').slice(0, 300)}`);
    console.log(`Рыбный ресторан: внутри текст: ${insideText.slice(0, 400)}`);
  }
  await performStep(page, { stepName: 'Тёща Кумуса', currentTexts: ['Тёща Кумуса', 'тёща кумуса'], retries: 3 });
  await tryPerformStepOptional(page, { stepName: 'Я насчет работы.', currentTexts: ['Я насчет работы.'] });
  await tryPerformStepOptional(page, { stepName: 'Скоро вернусь.', currentTexts: ['Скоро вернусь.'] });
  await tryPerformStepOptional(page, { stepName: 'Ну рассказывай где искать мрамару?', currentTexts: ['Ну рассказывай где искать мрамару?'] });
}

// Одноразовый мини-квест: открывает "Журнал наград" у Тёщи Кумуса. Без него награды за
// эскорт-квест не фиксируются (только дины). Безопасный бой с Учебным манекеном.
async function progressFishRestaurantJournal(page) {
  await goToFishRestaurant(page);

  // 15.09.2026, живая проверка: физически придя в ресторан, объекта "Как быть
  // продуктивным" на месте не оказалось (видно только "Тёща Кумуса"/"Турнир рыболовов"/
  // "Уйти") - похоже, это ротирующееся/не всегда доступное объявление, а не постоянный
  // объект. Не гадаем дальше и не долбим боем - мягко отступаем, попробуем в другой раз.
  if (!(await existsAnyText(page, ['Как быть продуктивным', 'как быть продуктивным']))) {
    console.log('Fish Restaurant journal: объявление "Как быть продуктивным" сейчас не на месте -> отступаю без боя.');
    return false;
  }

  await performStep(page, {
    stepName: 'Как быть продуктивным',
    currentTexts: ['Как быть продуктивным', 'как быть продуктивным'],
    retries: 3,
  });

  await performStep(page, {
    stepName: 'Уровень*100 дин?',
    currentTexts: ['Уровень*100 дин? Надеюсь лекция того стоит, возьмите мои деньги.'],
    retries: 3,
  });

  await performStep(page, {
    stepName: 'Лучше помнить где что полезное (до боя)',
    currentTexts: ['Лучше помнить где что полезное можно найти на заданиях.'],
    retries: 3,
  });

  console.log('Fish Restaurant journal: бой с Учебным манекеном (безопасный)');
  await fightLoop(page);
  await pause(page, 800, 1500);

  await tryPerformStepOptional(page, {
    stepName: 'Лучше помнить где что полезное (после боя)',
    currentTexts: ['Лучше помнить где что полезное можно найти на заданиях.'],
  });

  await performStep(page, {
    stepName: 'Молча уйти',
    currentTexts: ['Молча уйти', 'молча уйти'],
    retries: 3,
  });

  console.log('Fish Restaurant journal: открыт (навык ведения дневника наград получен).');
  return true;
}

// goToFishRestaurant уже доводит диалог до развилки Холмы/Болота/Опушка (живьём
// подтверждено 15.09.2026 - Паша прошёл начало вручную, "Продолжить квест" на
// location.php вывел ровно на этот выбор). Здесь только сам выбор ветки.
// Мягкий клик (tryPerformStepOptional), не жёсткий: если попытка на этой награде уже
// прерывалась раньше (recovery), "Продолжить квест" может вернуть на середину маршрута
// ПОСЛЕ развилки - тогда текста ветки уже не будет, и это нормально, а не ошибка.
async function goToFishRestaurantBranch(page, branchStepName, branchTexts) {
  await goToFishRestaurant(page);
  await tryPerformStepOptional(page, {
    stepName: branchStepName,
    currentTexts: branchTexts,
  });
}

// 15.09.2026, обнаружено на "Рыбном ресторане" (несколько живых прогонов подряд): между
// ЛЮБЫМИ двумя реальными шагами сюжета игра может вставить переменное число (замечено от
// 0 до 3+ подряд) экранов-виньеток случайного флейвор-текста ("Топи"/"На пути к болотам" и
// т.п.), каждый ровно с одной ссылкой внутри `.bBorder` - гайд их все склеивает в один шаг,
// поэтому хардкодить каждый текст по одному бессмысленно (тексты каждый раз разные и в
// разном количестве). Вызывать перед каждым performStep реального шага - кликает виньетки,
// если они есть, и молча ничего не делает, если цель уже видна.
// Site-chrome link texts that are always present and must never be mistaken for a
// vignette's "continue" link (top nav, header, footer).
const VIGNETTE_EXCLUDE_TEXTS = new Set([
  'Обновить', 'Чат', 'В игру', 'Q', 'Настройки', 'Выход', 'Друзья', 'Гильдия',
  'Правила', 'Поддержка', 'Форум', 'Личные сообщения', 'Все квесты', 'Амулет',
  'Магазин', 'Инвентарь', 'Карта', 'Почта',
]);

// Ссылки, начинающие бой. Пропуск виньеток НЕ ИМЕЕТ ПРАВА их нажимать: вход в бой - это
// решение (и оно обязано проходить через questFightHpGate), а не "продолжить рассказ".
// Живой случай 17.09.2026: в маршруте Рыбного ресторана эвристика "единственная нечужая
// ссылка" нажала "В бой!" и утащила персонажа в бой с Пятнистым аллигатором мимо всех
// гейтов. Незавершённый бой затем заблокировал игру целиком - посыпались Рыбий глаз,
// травы, все три четверговых дейлика и Q-меню (везде голый "В бой!").
const VIGNETTE_FIGHT_LINK_RE = /^(в\s*бой!?|напасть\b.*|атаковать\b.*|ударить|вступить\s+в\s+бой|принять\s+бой)$/i;

async function skipTravelVignettes(page, targetTexts, maxAttempts = 8) {
  for (let i = 0; i < maxAttempts; i++) {
    if (await existsAnyText(page, targetTexts)) return;

    // Боевой экран - это не виньетка. Кликать здесь нечего, и чем раньше выйдем, тем лучше.
    if (isBattleScreenText(await getBodyText(page))) {
      console.log('skipTravelVignettes: это боевой экран, а не виньетка -> выхожу, не кликаю.');
      return;
    }
    const clicked = await page.evaluate(() => {
      const el = document.querySelector('.bBorder a');
      if (!el) return false;
      el.click();
      return true;
    }).catch(() => false);
    if (clicked) {
      await pause(page, 800, 1500);
      continue;
    }
    // Some vignette screens don't use .bBorder at all, just a plain "Далее" link
    // (same pattern used elsewhere, e.g. boat trip screens) - fall back to it.
    const clickedNext = await clickByTexts(page, ['Далее', 'далее'], 'travel vignette (Далее)').catch(() => false);
    if (clickedNext) {
      await pause(page, 800, 1500);
      continue;
    }
    // Last resort: vignette link text is unpredictable ("Возвращаться в форт" etc.), so
    // if there is exactly ONE non-chrome link on the page, treat it as the vignette's
    // single "continue" choice. Deliberately a no-op (returns false) when 0 or 2+ such
    // links exist, so it never guesses on a real multi-option decision screen.
    const excludeArr = Array.from(VIGNETTE_EXCLUDE_TEXTS);
    const clickedLone = await page.evaluate(({ exclude, fightRe }) => {
      const re = new RegExp(fightRe, 'i');
      const links = Array.from(document.querySelectorAll('a'))
        .filter((a) => a.textContent && a.textContent.trim().length > 0)
        .filter((a) => !exclude.includes(a.textContent.trim()));
      if (links.length !== 1) return false;
      const label = links[0].textContent.trim();
      if (re.test(label)) return 'fight'; // единственная ссылка ведёт в бой - не трогаем
      links[0].click();
      return true;
    }, { exclude: excludeArr, fightRe: VIGNETTE_FIGHT_LINK_RE.source }).catch(() => false);
    if (clickedLone === 'fight') {
      console.log('skipTravelVignettes: единственная ссылка на экране начинает бой -> НЕ нажимаю, выхожу.');
      return;
    }
    if (!clickedLone) return;
    console.log('skipTravelVignettes: клик по единственной нечужой ссылке на экране (эвристика).');
    await pause(page, 800, 1500);
  }
}

// Награда №1: ветка "Болота", по пути засада с аллигатором и три нарастающих боя с призраком.
// 24.09.2026 переписано: раньше это была жёсткая цепочка performStep по одному шагу. Любой сбой
// (засада, прерванная сцена) ронял её на первом же шаге, а следующий круг начинал маршрут заново
// с развилки - Паша дважды про это сказал: «ты начинаешь выполнять рыбный ресторан и уходишь с
// локации после 1го боя», «рыбный ресторан ты не доделал до конца и прыгнул в город».
// Теперь идём ПО ЭКРАНУ: смотрим, какие ссылки есть, и делаем то, что уместно. Такой проход
// подхватывает сцену с любого места - в том числе после боя и после перезапуска драйвера.
const REWARD1_STEPS = [
  // Диалог до развилки (Тёща Кумуса -> Яшка -> куда ведём). Он тоже должен быть здесь: 24.09.2026
  // проход встал на экране Тёщи Кумуса, потому что список знал только шаги после развилки.
  'Я насчет работы.', 'Скоро вернусь.', 'Ну рассказывай где искать мрамару?',
  'Веди-ка ты меня на болота',
  // Ветка «Болота»
  'Идти направо за Яшкой', 'Забрать налево', 'Шагнуть вперёд', 'Шагнуть вперед',
  'Мы выберем то, что нам пригодится', 'Идти к лианам', 'Попробовать встать',
];
const REWARD1_FIGHT_LINKS = ['Напасть', 'В бой!', 'В бой'];
const REWARD1_MAX_SCREENS = 40;

async function progressFishRestaurantReward1(page) {
  const FR = 'Рыбный ресторан reward #1';
  await goToFishRestaurantBranch(page, 'Болота', ['Веди-ка ты меня на болота']);

  let fights = 0;
  let idle = 0;
  // 25.09.2026, Паша: «рыбный ресторан застопорился». Проход молча накручивал 40 экранов: ветка
  // «Продолжить квест» была единственной без записи в лог и вела на тот же экран по кругу. Теперь
  // клик логируется, а одинаковый экран трижды подряд прекращает проход с полным дампом сцены -
  // иначе не понять, какой реплики не хватает в REWARD1_STEPS.
  let lastSignature = '';
  let sameScreenTimes = 0;
  let contDumped = false;
  // Сколько раз подряд нажали «Продолжить квест» без единого шага сюжета между ними.
  let contClicks = 0;
  for (let i = 0; i < REWARD1_MAX_SCREENS; i++) {
    // 25.09.2026: пропуск виньеток стоял ЗДЕСЬ, до чтения экрана, и жал первую ссылку в рамке
    // (`.bBorder a`). На диалоге Тёщи Кумуса это уводило на локацию форта, где оставалось одно
    // «Продолжить квест» - отсюда и брался круг. Теперь виньетки пропускаем только тогда, когда
    // на экране не нашлось ни известной реплики, ни боя, ни продолжения (ниже).
    const text = await getBodyText(page);
    if (/Задание выполнено|Задание завершено|Квест выполнен/i.test(text)) {
      console.log(`${FR}: задание выполнено (боёв ${fights}).`);
      return true;
    }
    const links = await page.evaluate(() => Array.from(document.querySelectorAll('a'))
      .map((a) => ({ t: (a.innerText || '').trim(), h: a.getAttribute('href') || '' }))
      .filter((x) => x.t && x.h)).catch(() => []);
    const find = (names) => links.find((l) => names.some((n) => l.t === n));

    // Часы сайта в первой строке («09:28:54, Пт.») меняются каждую секунду: с ними в подписи любой
    // экран выглядел новым, и защита от круга не срабатывала ни разу (живьём 25.09.2026, 40 кликов
    // «Продолжить квест» подряд). Время из подписи вырезаем.
    const plain = text.replace(/\d{1,2}:\d{2}(:\d{2})?/g, '').replace(/\s+/g, ' ');
    const signature = `${links.map((l) => l.t).join('|')}##${plain.slice(0, 200)}`;
    sameScreenTimes = signature === lastSignature ? sameScreenTimes + 1 : 0;
    lastSignature = signature;
    if (sameScreenTimes >= 2) {
      console.log(`${FR}: один и тот же экран ${sameScreenTimes + 1} раза подряд - нужной реплики в списке нет.`);
      console.log(`${FR}: ссылки экрана: ${links.map((l) => l.t).join(' | ').slice(0, 400)}`);
      console.log(`${FR}: текст экрана: ${text.replace(/\s+/g, ' ').slice(0, 500)}`);
      return false;
    }

    const step = find(REWARD1_STEPS);
    if (step) {
      idle = 0;
      contClicks = 0;
      console.log(`${FR}: ${step.t}`);
      await page.goto(new URL(step.h, page.url()).href, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await pause(page, 700, 1300);
      continue;
    }

    const fight = find(REWARD1_FIGHT_LINKS);
    if (fight) {
      idle = 0;
      // Бой в сцене бросать нельзя - ждём подлечивания, а не убегаем (эскорт-квест).
      if (!(await questFightHpGate(page, `${FR} (бой ${fights + 1})`, QUEST_FIGHT_HP_FLOOR, { waitForRecovery: true }))) {
        console.log(`${FR}: HP мало перед боем ${fights + 1} - остаюсь в сцене, продолжу в следующем круге.`);
        return false;
      }
      console.log(`${FR}: бой ${fights + 1} (${fight.t})`);
      await page.goto(new URL(fight.h, page.url()).href, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await fightLoop(page);
      fights += 1;
      await pause(page, 800, 1500);
      continue;
    }

    // После боя игра выкидывает на локацию, а сцена ждёт на ссылке «Продолжить квест».
    const cont = find(['Продолжить квест']);
    if (cont) {
      idle = 0;
      contClicks += 1;
      console.log(`${FR}: Продолжить квест (возврат в сцену)`);
      if (contClicks > 3) {
        console.log(`${FR}: «Продолжить квест» ${contClicks} раза подряд возвращает сюда же - сцена не открывается, выхожу.`);
        console.log(`${FR}: ссылки экрана: ${links.map((l) => l.t).join(' | ').slice(0, 300)}`);
        return false;
      }
      if (!contDumped) {
        contDumped = true;
        console.log(`${FR}: экран перед «Продолжить квест»: ${links.map((l) => l.t).join(' | ').slice(0, 300)}`);
        console.log(`${FR}: текст: ${plain.slice(0, 400)}`);
      }
      await page.goto(new URL(cont.h, page.url()).href, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await pause(page, 700, 1300);
      continue;
    }

    // Нечего нажать. Один раз перечитываем локацию (сцена могла ещё не проявиться), потом выходим.
    if (idle === 0) {
      idle = 1;
      // Сначала пробуем пропустить виньетку (экран-флейвор с одной ссылкой), и только если и это
      // не помогло - перечитываем локацию.
      await skipTravelVignettes(page, [...REWARD1_STEPS, ...REWARD1_FIGHT_LINKS]);
      if (await existsAnyText(page, [...REWARD1_STEPS, ...REWARD1_FIGHT_LINKS, 'Продолжить квест'])) continue;
      await page.goto('http://lbast.ru/location.php', { waitUntil: 'domcontentloaded', timeout: 60000 });
      await pause(page, 900, 1500);
      continue;
    }
    console.log(`${FR}: на экране нет ни шага, ни боя, ни продолжения (боёв ${fights}) - оставляю как есть.`);
    // Печатаем, что было на экране: без этого не понять, какой реплики не хватает в списке.
    console.log(`${FR}: ссылки экрана: ${links.map((l) => l.t).join(' | ').slice(0, 400)}`);
    return fights >= 3;
  }
  console.log(`${FR}: ${REWARD1_MAX_SCREENS} экранов подряд без конца квеста - выхожу, продолжу в следующем круге.`);
  return false;
}

const FISH_RESTAURANT_REWARD_HANDLERS = {
  1: progressFishRestaurantReward1,
};

// FISH_RESTAURANT_ENABLED: определено в lib/state.js (константа нужна нескольким файлам).

async function runFishRestaurantQuestIfAvailable(page) {
  if (!FISH_RESTAURANT_ENABLED) {
    console.log('Fish Restaurant: выключен до настройки засады с аллигатором (FISH_RESTAURANT_ENABLED = false).');
    return false;
  }

  const today = getDayKeyNow();
  if (S.fishRestaurantDayKey !== today) {
    S.fishRestaurantDayKey = today;
    S.fishRestaurantDoneToday = false;
  }
  if (S.fishRestaurantDoneToday) {
    return false;
  }

  const QUEST = 'Рыбный ресторан';
  const menuOpened = await resetToQuestMenu(page);
  if (!menuOpened) {
    return false;
  }
  const qNamesNow = parseQuestNamesFromQMenuText(await getBodyText(page));
  if (!isQuestInMenu(qNamesNow, QUEST)) {
    // 15.09.2026, живой баг: формальный accept ("К месту выполнения") убирает квест из
    // общего Q-меню (как и другие "эксклюзивные" квесты - Харчевня/Штольни), но это НЕ
    // значит "недоступен на сегодня" - если предыдущая попытка упала на середине маршрута
    // (напр. на виньетке), квест остаётся в процессе и ждёт "Продолжить квест" на
    // location.php. Раньше это молча трактовалось как "квест недоступен" и весь день
    // пропадал без единой попытки резюме - проверяем эту возможность явно перед сдачей.
    await page.goto('http://lbast.ru/location.php', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    const locText = await getBodyText(page);
    if (!/Продолжить квест/i.test(locText)) {
      // 25.09.2026: молчаливый выход было не отличить от «шаг вообще не вызвался» - пишем причину.
      console.log(`Fish Restaurant: квеста нет в Q-меню и на локации нет «Продолжить квест» - пропускаю круг. В меню было: ${qNamesNow.join(', ').slice(0, 200)}`);
      return false;
    }
    console.log('Fish Restaurant: не в Q-меню, но есть "Продолжить квест" - квест в процессе, резюмирую.');
  }

  // Журнал наград - опционален (без него награда за проход просто дины, а не предмет),
  // НЕ обязателен для самого эскорт-квеста (живьём подтверждено 15.09.2026 - Паша дошёл
  // до развилки Холмы/Болота/Опушка, не открывая журнал вовсе). Поэтому сначала пробуем
  // сегодняшнюю пронумерованную награду (она ограничена одной попыткой в день), а журнал -
  // только если наградный проход на сегодня уже сделан (не мешает ему, не блокирует его).
  const handler = FISH_RESTAURANT_REWARD_HANDLERS[S.fishRestaurantNextRewardNumber];
  if (handler) {
    // Берём фокус на время прохода: пока он держится, isExclusiveQQuestInProgress не даст
    // начать другие квесты, и маршрут доводится до конца (или до таймаута в 30 минут).
    if (!S.fishRestaurantFocusStartedAt) S.fishRestaurantFocusStartedAt = Date.now();
    const ok = await runNonQQuestSafe(page, `Fish Restaurant reward #${S.fishRestaurantNextRewardNumber}`,
      () => handler(page), { keepPlace: true });
    if (ok) {
      S.fishRestaurantDoneToday = true;
      S.fishRestaurantNextRewardNumber += 1;
      S.fishRestaurantFocusStartedAt = 0;
      S.fishRestaurantSuppressedUntil = 0;
      persistDailyQuestState();
    } else {
      // Проход не продвинулся. Раньше фокус в таком случае висел до таймаута (часы), и всё это
      // время исключительный режим не пускал остальные квесты - Паша 24.09.2026 прислал список:
      // Харчевня, Еда для рыбака, Грабим корованы и прочее висели открытыми весь день.
      // Не вышло - отпускаем фокус и не лезем в ресторан полчаса, пусть работают другие квесты.
      S.fishRestaurantFocusStartedAt = 0;
      S.fishRestaurantSuppressedUntil = Date.now() + 30 * 60 * 1000;
      persistDailyQuestState();
      console.log('Fish Restaurant: проход не продвинулся - отпускаю фокус на 30 минут, чтобы шли другие квесты.');
    }
    return Boolean(ok);
  }
  // Маршрута нет - держать фокус бессмысленно, иначе заблокируем остальные квесты до таймаута.
  S.fishRestaurantFocusStartedAt = 0;
  console.log(`Fish Restaurant: нет закодированного маршрута для награды №${S.fishRestaurantNextRewardNumber} - остановлено, ждёт ручного добавления.`);

  if (!S.fishRestaurantJournalOpened) {
    const ok = await runNonQQuestSafe(page, 'Fish Restaurant journal', () => progressFishRestaurantJournal(page));
    if (ok) {
      S.fishRestaurantJournalOpened = true;
      persistDailyQuestState();
      return true;
    }
    return Boolean(ok);
  }

  return false;
}
