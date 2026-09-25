// Галерея/лазулиты, Демон озера, Ордо экзекуторс, Кораблекрушение, сбор трав.
// Выделено из ai_char/module.js (там только сборка экспорта). Изменяемое состояние - S из ./state.

// Экспорт стоит ДО require: файлы lib/ вызывают друг друга по кругу, а объявления функций
// всплывают (hoisting), поэтому к моменту любого встречного require все функции уже здесь.
module.exports = {
  absUrl, findLinkHref, progressGalleryLazuliteQuest, runGalleryQuestIfAvailable,
  progressDemonLakeQuest, reportDemonLakeQuest, demonLakeAwaitsReport, walkToOrdoTower,
  progressOrdoQuest, runOrdoQuestsIfAvailable, runDemonLakeQuestIfAvailable,
  progressShipwreckQuest, progressHerbGatherQuest, runHerbQuestsIfAvailable,
  runShipwreckQuestIfAvailable,
};

const {
  S, DEMON_LAKE_FASTWAY_URL, getDayKeyNow, persistDailyQuestState, QUEST_FIGHT_HP_FLOOR,
} = require('./state');
const { waitOutHorseTravel } = require('./assassins');
const { appendDebugSnapshot, getBodyText, pause, snapshotText } = require('./core');
const { runNonQQuestSafe } = require('./daily_quests');
const { fightLoop } = require('./fight');
const {
  preTripHpGate, questFightHpGate, runQuestStepSafe, tryPerformStepOptional,
} = require('./hp');
const {
  clickInfoForQuest, dropCurrentAssignment, hasAlreadyHasQuestText, isQuestInMenu, openQuestsMenu,
  parseQuestNamesFromQMenuText, resetToQuestMenu,
} = require('./quest_menu');
const { clickByTexts, existsAnyText, performStep } = require('./ui');

// ===================================================================================
// Галерея искусств / лазулиты. Квест МНОГОРАЗОВЫЙ (Паша, 25.09.2026: "это многоразовый
// квест и у меня и у него") -- в каталоге "Все квесты" он в разделе МНОГОРАЗОВЫЕ, после
// сдачи встаёт кулдаун около недели.
//
// Маршрут поиска переписан 25.09.2026 после живого прохождения на Цунами. Прежняя версия
// (записанная 14.09.2026) расходилась с игрой в двух местах:
//   1) поиск считался простым циклом "жать Искать лазулиты, пока не выпадет камень". На деле
//      это ветвящаяся сценка: виньетка про побережье -> "Идти вперед" -> развилка
//      "Идти по берегу" / "Свернуть на косу" -> "Ударить их мечом" -> ДВА боя подряд ->
//      "Продолжить квест" -> "Уйти". Нужна именно КОСА, берег уводит мимо;
//   2) находка определялась по слову "лазулит", а оно есть и в описании побережья -- то есть
//      засчитывалась там, где камня не было, и Марсиус потом выдавал задание заново.
// Ещё деталь: ссылка "Искать лазулиты" живёт на клетке (location.php), а сценка уводит на свои
// экраны, где её уже нет -- каждый заход начинаем с возврата на клетку.
// ===================================================================================

function absUrl(href) {
  return href.startsWith('http') ? href : (href.startsWith('/') ? 'http://lbast.ru' + href : 'http://lbast.ru/' + href);
}

async function findLinkHref(page, regex) {
  return await page.evaluate((src) => {
    const re = new RegExp(src, 'i');
    const a = Array.from(document.querySelectorAll('a')).find((el) => re.test(el.textContent));
    return a ? a.getAttribute('href') : null;
  }, regex.source);
}

const FISH_VILLAGE_KONJ_URL = 'http://lbast.ru/location.php?mod=konj&lway=7';

// Порядок = приоритет: на экране бывает несколько ссылок, берём первую из списка.
// "Идти по берегу" сюда НЕ входит намеренно -- это вторая половина развилки, и она уводит мимо.
const GALLERY_SCENE_STEPS = [
  'Свернуть на косу',
  'Ударить их мечом',
  'Идти вперед',
  'Продолжить квест',
  'Далее',
];
const GALLERY_SEARCH_ROUNDS = 4;
const GALLERY_SCENE_SCREENS = 24;

// Один заход в сценку поиска: "Искать лазулиты" и дальше до конца (два боя и выход).
// true -- дошли до боёв, камень наш; false -- коса не выпала, стоит повторить; null -- сбой.
async function runGalleryScene(page, round) {
  await page.goto('http://lbast.ru/location.php', { waitUntil: 'domcontentloaded', timeout: 60000 });
  const searchHref = await findLinkHref(page, /Искать лазулиты/);
  if (!searchHref) {
    console.log('Gallery quest: объект "Искать лазулиты" не найден на клетке — маршрут сбился.');
    return null;
  }
  await page.goto(absUrl(searchHref), { waitUntil: 'domcontentloaded', timeout: 60000 });

  let fights = 0;
  for (let screen = 0; screen < GALLERY_SCENE_SCREENS; screen++) {
    const text = await getBodyText(page);

    // Уже на боевом экране: уйти с заряженного боя нельзя, поэтому ждём лечения, а не отказываемся
    // (иначе бой потом подберёт обработчик атак в обход гейта -- история с корованом 17.09.2026).
    if (/Ударить/i.test(text)) {
      if (!(await questFightHpGate(page, `Gallery: бой ${fights + 1}`, QUEST_FIGHT_HP_FLOOR, { waitForRecovery: true }))) {
        return null;
      }
      await fightLoop(page);
      fights += 1;
      console.log(`Gallery quest: бой ${fights} пройден.`);
      await pause(page, 900, 1500);
      continue;
    }

    const toFight = await findLinkHref(page, /В бой!/);
    if (toFight) {
      await page.goto(absUrl(toFight), { waitUntil: 'domcontentloaded', timeout: 60000 });
      continue;
    }

    let next = null;
    for (const name of GALLERY_SCENE_STEPS) {
      const href = await findLinkHref(page, new RegExp(name));
      if (href) { next = { name, href }; break; }
    }
    if (next) {
      await page.goto(absUrl(next.href), { waitUntil: 'domcontentloaded', timeout: 60000 });
      await pause(page, 600, 1100);
      continue;
    }

    // Сценка кончилась (ссылок не осталось) -- выходим "Уйти", если он есть.
    const out = await findLinkHref(page, /Уйти/);
    if (out) await page.goto(absUrl(out), { waitUntil: 'domcontentloaded', timeout: 60000 });
    console.log(`Gallery quest: заход ${round} завершён, боёв ${fights}.`);
    return true;
  }

  console.log(`Gallery quest: сценка ${round} не кончилась за ${GALLERY_SCENE_SCREENS} экранов.`);
  return true;
}

async function progressGalleryLazuliteQuest(page) {
  await page.goto(FISH_VILLAGE_KONJ_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await waitOutHorseTravel(page, FISH_VILLAGE_KONJ_URL);

  const galleryHref = await findLinkHref(page, /Галерея искусств/);
  if (!galleryHref) {
    console.log('Gallery quest: объект "Галерея искусств" не найден в Рыбацкой деревне.');
    return false;
  }
  const galleryBase = absUrl(galleryHref);

  await page.goto(`${galleryBase}&go=1`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await pause(page, 700, 1200);
  await page.goto(`${galleryBase}&go=3`, { waitUntil: 'domcontentloaded', timeout: 60000 });

  let text = await getBodyText(page);
  if (/Благодарствую|Получено \d+ дин/i.test(text)) {
    console.log('Gallery quest: лазулит уже был на руках, сдан Марсиусу — задание завершено.');
    return true;
  }

  if (!/Задание получено|лазулит/i.test(text)) {
    console.log('Gallery quest: неожиданный текст у Марсиуса, прекращаю:', text.slice(0, 300));
    return false;
  }

  // Пешком с побережья: 2 клетки на запад от Рыбацкой деревни.
  await page.goto('http://lbast.ru/location.php', { waitUntil: 'domcontentloaded', timeout: 60000 });
  for (let i = 0; i < 2; i++) {
    const westHref = await findLinkHref(page, /На запад|Идти на запад/);
    if (!westHref) break;
    await page.goto(absUrl(westHref), { waitUntil: 'domcontentloaded', timeout: 60000 });
    await pause(page, 500, 900);
  }

  // Успех определяет МАРСИУС, а не текст поиска. Прежняя версия считала находкой любой экран со
  // словом "лазулит", а оно есть и в описании побережья -- и квест "завершался" без камня.
  // Наблюдения к тому же расходятся: 14.09.2026 на AI__ камень выпал после пары случайных засад,
  // 25.09.2026 на Цунами -- через сценку с косой и двумя боями. Поэтому не гадаем: отыграли заход
  // -- сходили к Марсиусу. Принял ("Благодарствую"/"Получено N дин") -- готово; снова выдал
  // задание -- значит камня нет, возвращаемся на побережье и пробуем ещё раз.
  for (let round = 1; round <= GALLERY_SEARCH_ROUNDS; round++) {
    const r = await runGalleryScene(page, round);
    if (r === null) return false;

    // Обратно: 2 клетки на восток до Рыбацкой деревни, к Марсиусу.
    await page.goto('http://lbast.ru/location.php', { waitUntil: 'domcontentloaded', timeout: 60000 });
    for (let i = 0; i < 2; i++) {
      const eastHref = await findLinkHref(page, /Идти на восток|На восток/);
      if (!eastHref) break;
      await page.goto(absUrl(eastHref), { waitUntil: 'domcontentloaded', timeout: 60000 });
      await pause(page, 500, 900);
    }

    const galleryHref2 = await findLinkHref(page, /Галерея искусств/);
    if (!galleryHref2) {
      console.log('Gallery quest: не нашёл галерею на обратном пути для сдачи.');
      return false;
    }
    const galleryBase2 = absUrl(galleryHref2);
    await page.goto(`${galleryBase2}&go=1`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await pause(page, 700, 1200);
    await page.goto(`${galleryBase2}&go=3`, { waitUntil: 'domcontentloaded', timeout: 60000 });

    text = await getBodyText(page);
    if (/Благодарствую|Получено \d+ дин/i.test(text)) {
      console.log(`Gallery quest: лазулит сдан Марсиусу с ${round}-го захода, задание завершено.`);
      return true;
    }

    console.log(`Gallery quest: после захода ${round} камня нет (Марсиус снова выдал задание).`);
    if (round === GALLERY_SEARCH_ROUNDS) break;

    // Ещё раз на побережье: 2 клетки на запад.
    await page.goto('http://lbast.ru/location.php', { waitUntil: 'domcontentloaded', timeout: 60000 });
    for (let i = 0; i < 2; i++) {
      const westHref = await findLinkHref(page, /На запад|Идти на запад/);
      if (!westHref) break;
      await page.goto(absUrl(westHref), { waitUntil: 'domcontentloaded', timeout: 60000 });
      await pause(page, 500, 900);
    }
  }

  console.log(`Gallery quest: за ${GALLERY_SEARCH_ROUNDS} заходов лазулит так и не добыт.`);
  return false;
}

// В меню Q этот квест не показывается -- он берётся прямо у Марсиуса, поэтому гейт только по
// собственному периоду. Раньше здесь стоял флаг galleryQuestDone ("сдал один раз -- больше не
// ходим"), но квест МНОГОРАЗОВЫЙ, и после первой же сдачи диспетчер переставал ходить навсегда.
// Период взят по живому наблюдению на Цунами 25.09.2026: сразу после сдачи в каталоге встало
// "через 6 дн.", значит цикл около недели.
const GALLERY_PERIOD_MS = 7 * 24 * 60 * 60 * 1000;

async function runGalleryQuestIfAvailable(page) {
  if (Date.now() - (S.galleryLastDoneAt || 0) < GALLERY_PERIOD_MS) {
    return false;
  }

  const GALLERY_QUEST = 'Галерея искусств';
  const ok = await runQuestStepSafe(page, GALLERY_QUEST, () => progressGalleryLazuliteQuest(page));
  if (ok) {
    S.galleryLastDoneAt = Date.now();
    persistDailyQuestState();
  }
  return ok;
}

// ===================================================================================
// "Орден Тригмагистров: Охота на демона" (Демон озера) — маршрут продиктован Пашей
// 14.09.2026 (не проверен вживую, запускать первый раз с осторожностью, читать логи):
//   Амулет -> Дорожный крест -> Цитадель Ордена Тригмагистров -> Получить задание ->
//   В игру -> [инфо] у "Орден Тригмагистров: Охота на демона" -> "К озеру" -> ждать 7с/
//   "В пути" -> "Поросль камышей" -> "Идти по левой" -> "Идти дальше" -> "В бой!"
//   (обычный бой) -> Амулет -> Дорожный крест -> Цитадель Ордена Тригмагистров ->
//   "Доложить о задании".
// Обычный дневной квест (не одноразовый) - state с day-key, как Штольни/Харчевня.
// ===================================================================================
// DEMON_LAKE_FASTWAY_URL: определено в lib/state.js (константа нужна нескольким файлам).

async function progressDemonLakeQuest(page) {
  const QUEST = 'Орден Тригмагистров: Охота на демона';

  await page.goto(DEMON_LAKE_FASTWAY_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await waitOutHorseTravel(page, DEMON_LAKE_FASTWAY_URL);

  // Взять задание (безопасно, если уже взято - ссылка "Получить задание" просто не найдётся).
  const enteredCitadel = await clickByTexts(page, ['Цитадель Ордена Тригмагистров'], 'Цитадель Ордена Тригмагистров');
  if (enteredCitadel) {
    await pause(page, 800, 1500);
    await clickByTexts(page, ['Получить задание'], 'Получить задание');
    await pause(page, 800, 1500);
    if (hasAlreadyHasQuestText(await getBodyText(page))) {
      console.log('Demon lake quest: игра ответила "у вас уже есть задание" -> иду в анкету отказываться.');
      await dropCurrentAssignment(page, 'Демон озера: мешает взять задание');
      return false;
    }
    await clickByTexts(page, ['В игру'], 'В игру');
    await pause(page, 800, 1500);
  }

  // "В игру" lands on the regular location, not the quest board — clickInfoForQuest
  // needs the "• Name [инфо]" list, which only renders on location.php?mod=quests.
  // Found 15.09.2026: without this, clickInfoForQuest always failed ("Info link not
  // found"), and the leftover page state then cascaded into Fish Eye/Tavern failures
  // in the same cycle too.
  const onQuestBoard = await openQuestsMenu(page);
  if (!onQuestBoard) {
    console.log('Demon lake quest: could not open quest board before info click.');
    return false;
  }

  const infoOk = await clickInfoForQuest(page, QUEST);
  if (!infoOk) {
    console.log('Demon lake quest: could not open quest info.');
    return false;
  }

  const wentToLake = await clickByTexts(page, ['К озеру', 'к озеру'], 'К озеру');
  if (!wentToLake) {
    console.log('Demon lake quest: "К озеру" link not found on quest info page.');
    return false;
  }
  await pause(page, 6500, 7500);
  await waitOutHorseTravel(page, page.url());

  const reachedReeds = await clickByTexts(page, ['Поросль камышей'], 'Поросль камышей');
  if (!reachedReeds) {
    console.log('Demon lake quest: "Поросль камышей" not found - stopping, needs manual check.');
    await appendDebugSnapshot('Demon lake: state after "К озеру" + travel wait, reeds step not found', {
      label: 'demon_lake_no_reeds',
      url: page.url(),
      text: await getBodyText(page),
    });
    return false;
  }
  await pause(page, 800, 1500);

  await clickByTexts(page, ['Идти по левой', 'идти по левой'], 'Идти по левой');
  await pause(page, 800, 1500);

  await clickByTexts(page, ['Идти дальше'], 'Идти дальше');
  await pause(page, 800, 1500);

  if (await existsAnyText(page, ['В бой!', 'в бой!', 'В бой', 'в бой'])) {
    if (!(await questFightHpGate(page, 'Демон озера'))) return false;
    await performStep(page, {
      stepName: 'В бой!',
      currentTexts: ['В бой!', 'в бой!', 'В бой', 'в бой'],
      retries: 4,
    });
    await fightLoop(page);
  }

  return reportDemonLakeQuest(page);
}

async function reportDemonLakeQuest(page) {
  await page.goto(DEMON_LAKE_FASTWAY_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await waitOutHorseTravel(page, DEMON_LAKE_FASTWAY_URL);
  await clickByTexts(page, ['Цитадель Ордена Тригмагистров'], 'Цитадель Ордена Тригмагистров');
  await pause(page, 800, 1500);
  const reported = await clickByTexts(page, ['Доложить о задании'], 'Доложить о задании');
  if (reported) {
    await pause(page, 800, 1500);
    console.log(`Demon lake quest: доклад -> ${snapshotText(await getBodyText(page), 160)}`);
    await clickByTexts(page, ['В игру'], 'В игру').catch(() => {});
  }
  return Boolean(reported);
}

// 18.09.2026, живой случай: демона убил обработчик висящего боя (гейт квеста отказал уже у
// демона), до "Доложить о задании" код квеста не дошёл, а взятое задание из меню Q пропадает.
// Итог - слот задания висел с "Принесите доказательства найденного", и гильдия асассинов
// отвечала торговцу "У вас уже есть задание" весь день. Источник истины - анкета: если там
// висит задание про Ивовое озеро, едем докладывать.
async function demonLakeAwaitsReport(page) {
  await page.goto('http://lbast.ru/pers.php', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  const text = await getBodyText(page).catch(() => '');
  const m = text.match(/Текущее задание:\s*([\s\S]*?)\s*-\s*отказаться/i);
  return Boolean(m && /Ивового озера/i.test(m[1]));
}

// ===================================================================================
// Ордо Экзекуторс - квесты на мораль в ПЛЮС (Паша, 18.09.2026: "асассинов больше не делаем,
// нам нужны квесты ордо... как поймёшь - заскриптуй и выполняй, как только появятся в меню").
// Оба задания пройдены вживую 18.09.2026 (Медальон бандита, Костяная цепь бандита).
// Официальный гайд: library/help/index.php?mod=102.
//  - Взять: Стоунгард -> Южные ворота -> Идти на юг -> Идти на восток -> Башня Ордо Экзекуторс
//    -> "Уничтожить главаря банды" (zad=1) / "Уничтожить банду" (zad=2).
//  - Главарь: конь lway=q2001_1 (Рыбацкая деревня) -> Идти за скальную гряду -> Идти по ТРОПЕ
//    (по дороге - охрана с паролем) -> Идти дальше (не "Спрыгнуть на него") -> Залезть в люк ->
//    Прокрасться (мимо двоих у костра) -> Идти дальше -> Напасть -> бой. После - час запрета.
//  - Банда: конь lway=q2001_2 (Пещера бандитов, горы Дарии) -> Добить бандитов -> В бой!
//  - Доклад (go=2) - только с 6 уровня: "А пока копите предметы задания, вам их нужно 56".
//    Пока просто копим предметы; задание само освобождает слот после победы.
// ===================================================================================
const ORDO_TOWER_OBJ = 5100;
const ORDO_QUESTS = [
  { zad: 1, label: 'Ордо: главарь банды', menu: 'Ордо экзекуторс: Уничтожить главаря банды', take: 'Уничтожить главаря банды' },
  { zad: 2, label: 'Ордо: банда', menu: 'Ордо экзекуторс: Уничтожить банду', take: 'Уничтожить банду' },
];
// Выбор на каждом экране миссии, по порядку предпочтения. "Сдаться", "Спрыгнуть на него",
// "Идти по дороге", "Слезть к пещере" и драка с двумя у костра сюда НЕ входят намеренно.
const ORDO_MISSION_STEPS = [
  'Идти за скальную гряду', 'Идти по тропе', 'Залезть в люк', 'Прокрасться', 'Идти дальше',
  'Добить бандитов', 'Напасть', 'В бой!',
];

async function walkToOrdoTower(page) {
  await page.goto('http://lbast.ru/location.php?mod=fastway&lway=2', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await waitOutHorseTravel(page, 'http://lbast.ru/location.php');
  for (const step of ['Южные ворота', 'Идти на юг', 'Идти на восток', 'Башня Ордо Экзекуторс']) {
    await performStep(page, { stepName: step, currentTexts: [step], retries: 3 });
  }
}

async function progressOrdoQuest(page, q) {
  if (!(await preTripHpGate(page, q.label))) return false;

  await walkToOrdoTower(page);
  await clickByTexts(page, [q.take], q.take);
  await pause(page, 800, 1500);
  const takeText = await getBodyText(page);
  if (!/Задание принято/i.test(takeText) && !hasAlreadyHasQuestText(takeText)) {
    // Начало страницы башни — одно описание Ордена; причина отказа ниже, в списке заданий
    // и строке "Текущее задание" (19.09.2026 лог обрезался ровно перед ней).
    const at = takeText.search(/Задания:|Выполняйте задания|Текущее задание/);
    console.log(`${q.label}: задание не выдали: ${snapshotText(at >= 0 ? takeText.slice(at) : takeText, 600)}`);
    return false;
  }

  const horse = `http://lbast.ru/location.php?mod=konj&lway=q2001_${q.zad}`;
  await page.goto(horse, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await waitOutHorseTravel(page, 'http://lbast.ru/location.php');

  let fought = false;
  for (let i = 0; i < 14; i++) {
    const text = await getBodyText(page);
    if (/Ударить/i.test(text)) {
      await fightLoop(page);
      fought = true;
      await pause(page, 800, 1500);
      // После победы нас выкидывает на локацию, где снова виден ВХОД в миссию - не начинать
      // её по второму кругу. Бой посреди пути (заметили у костра) входа не показывает.
      const after = await getBodyText(page);
      if (after.includes('Идти за скальную гряду') || after.includes('Добить бандитов')) break;
      continue;
    }
    const next = ORDO_MISSION_STEPS.find((s) => text.includes(s));
    if (!next) break; // миссия кончилась - обычная локация
    await clickByTexts(page, [next], `${q.label}: ${next}`);
    await pause(page, 800, 1500);
  }
  if (!fought) {
    console.log(`${q.label}: до боя не дошёл - решит меню Q в следующем цикле.`);
    return false;
  }
  console.log(`${q.label}: бой пройден, предмет задания должен быть в инвентаре (доклад - с 6 уровня).`);
  return true;
}

async function runOrdoQuestsIfAvailable(page) {
  if (!(await resetToQuestMenu(page))) return false;
  await pause(page, 700, 1300);
  const names = parseQuestNamesFromQMenuText(await getBodyText(page));
  let did = false;
  for (const q of ORDO_QUESTS) {
    if (!isQuestInMenu(names, q.menu)) continue;
    const ok = await runNonQQuestSafe(page, q.label, () => progressOrdoQuest(page, q));
    if (ok) did = true;
  }
  return did;
}

async function runDemonLakeQuestIfAvailable(page) {
  const today = getDayKeyNow();
  if (S.demonLakeDayKey !== today) {
    S.demonLakeDayKey = today;
    S.demonLakeDoneToday = false;
  }
  if (S.demonLakeDoneToday) {
    return false;
  }

  const QUEST = 'Орден Тригмагистров: Охота на демона';
  // 14.09.2026: диспетчер должен сам открыть меню квестов, а не проверять текст ТЕКУЩЕЙ
  // страницы (обычно это location.php, там названий квестов нет) - иначе existsAnyText
  // всегда false и квест никогда не запускается.
  const menuOpened = await resetToQuestMenu(page);
  if (!menuOpened) {
    return false;
  }
  const qNamesNow = parseQuestNamesFromQMenuText(await getBodyText(page));
  if (!isQuestInMenu(qNamesNow, QUEST)) {
    if (!(await demonLakeAwaitsReport(page))) return false;
    console.log('Demon lake quest: в меню Q нет, но в анкете висит задание Ордена -> еду докладывать.');
    const reported = await runNonQQuestSafe(page, 'Demon lake report', () => reportDemonLakeQuest(page));
    if (reported) {
      S.demonLakeDoneToday = true;
      persistDailyQuestState();
    }
    return Boolean(reported);
  }

  const ok = await runNonQQuestSafe(page, 'Demon lake quest', () => progressDemonLakeQuest(page));
  if (ok) {
    S.demonLakeDoneToday = true;
    persistDailyQuestState();
  }
  return Boolean(ok);
}

// ===================================================================================
// "Кораблекрушение" — маршрут продиктован Пашей 14.09.2026 (не проверен вживую):
//   [инфо] -> "К месту выполнения" -> ждать 7с / "В пути" -> Тещин маяк -> "Далее" x3 ->
//   "По рукам, вези." -> "Столкнуть лодку в воду" -> "Далее" x3 -> "Ступить на борт
//   корабля" -> "Идти в каюту капитана" -> "Напасть на них" -> "В бой!" (бой 1) ->
//   "Вернуться" -> "Продолжить квест" -> "В бой!" (бой 2) -> "Продолжить квест" ->
//   "Открыть сундук" -> "Взять деньги и вернуться на палубу" -> "Сесть за весла" ->
//   "Причалить к берегу" -> "достать мешочек с монетами из кармана" -> задание завершено.
// Обычный дневной квест (не одноразовый), появляется в Q без отдельного "взять задание".
// ===================================================================================
async function progressShipwreckQuest(page) {
  const QUEST = 'Кораблекрушение';

  const infoOk = await clickInfoForQuest(page, QUEST);
  if (!infoOk) {
    console.log('Shipwreck quest: could not open quest info.');
    return false;
  }

  const travelOk = await clickByTexts(page, ['К месту выполнения'], 'К месту выполнения');
  if (!travelOk) {
    console.log('Shipwreck quest: "К месту выполнения" not found.');
    return false;
  }
  await pause(page, 6500, 7500);
  await waitOutHorseTravel(page, page.url());

  const preFightSteps = [
    'Далее', 'Далее', 'Далее',
    'По рукам, вези.',
    'Столкнуть лодку в воду',
    'Далее', 'Далее', 'Далее',
    'Ступить на борт корабля',
    'Идти в каюту капитана',
    'Напасть на них',
  ];
  for (const step of preFightSteps) {
    await tryPerformStepOptional(page, { stepName: step, currentTexts: [step, step.toLowerCase()] });
    await pause(page, 700, 1300);
  }

  if (await existsAnyText(page, ['В бой!', 'в бой!', 'В бой', 'в бой'])) {
    if (!(await questFightHpGate(page, 'Кораблекрушение (бой 1)'))) return false;
    await performStep(page, {
      stepName: 'В бой!',
      currentTexts: ['В бой!', 'в бой!', 'В бой', 'в бой'],
      retries: 4,
    });
    await fightLoop(page);
  }

  await pause(page, 700, 1300);
  await tryPerformStepOptional(page, { stepName: 'Вернуться', currentTexts: ['Вернуться', 'вернуться'] });
  await pause(page, 700, 1300);
  await tryPerformStepOptional(page, { stepName: 'Продолжить квест', currentTexts: ['Продолжить квест', 'продолжить квест'] });
  await pause(page, 700, 1300);

  if (await existsAnyText(page, ['В бой!', 'в бой!', 'В бой', 'в бой'])) {
    if (!(await questFightHpGate(page, 'Кораблекрушение (бой 2)'))) return false;
    await performStep(page, {
      stepName: 'В бой! (2)',
      currentTexts: ['В бой!', 'в бой!', 'В бой', 'в бой'],
      retries: 4,
    });
    await fightLoop(page);
  }

  await pause(page, 700, 1300);
  const postFightSteps = [
    'Продолжить квест',
    'Открыть сундук',
    'Взять деньги и вернуться на палубу',
    'Сесть за весла',
    'Причалить к берегу',
    'достать мешочек с монетами из кармана',
  ];
  for (const step of postFightSteps) {
    const ok = await tryPerformStepOptional(page, { stepName: step, currentTexts: [step, step.toLowerCase()] });
    if (ok) await pause(page, 700, 1300);
  }

  return true;
}

// ===================================================================================
// "Травы" (Арайя/Шипы дикого кактуса/Кустарник травии/Дикий пустолист/Хмель/Пререя) -
// 6 однотипных ежедневных квестов сбора трав, найдены и разобраны вживую 15.09.2026 по
// прямой просьбе Паши ("можешь начать рвать траву") - подтвердил "трава это без боя,
// можешь собирать при положительных резервах и хп", так что HP-гейта тут нет вообще.
// Механика одинакова для всех шести (только разное имя квеста/локация):
// [инфо] -> "К месту выполнения" (конь до нужного места, авто, без ручной навигации по
// тексту "два раза на запад, четыре раза на юг" и т.п. - это просто флейвор, "К месту
// выполнения" сам довозит) -> "Искать травы" -> сетка из 16 ссылок "*" (loc.php?...&
// gamekl=N). Клик по любой "*" раскрывает число (промах, безопасно) или "#" с текстом
// "Вы укололись о ядовитый шип и ничего не нашли!" (тоже безопасно - живьём подтверждено:
// HP до и после теста не изменился, 87/340 -> 87/340) - оба исхода без урона, просто
// одна попытка в день заканчивается либо травой, либо шипом. Не найдено способа предугадать
// исход по числам-подсказкам за одну попытку в день - клик по первой доступной "*"
// достаточен и ничем не хуже любой другой стратегии.
// Квест сам пропадает из Q-меню после израсходованной на сегодня попытки (тот же сигнал,
// что и у Кораблекрушения/Демон озера) - отдельный day-key в state.json не нужен.
// ===================================================================================
const HERB_QUEST_NAMES = [
  'Травы: Арайя',
  'Травы: Шипы дикого кактуса',
  'Травы: Кустарник травии',
  'Травы: Дикий пустолист',
  'Травы: Хмель',
  'Травы: Пререя',
];

async function progressHerbGatherQuest(page, questName) {
  const infoOk = await clickInfoForQuest(page, questName);
  if (!infoOk) return false;
  await pause(page, 500, 900);

  const travelOk = await clickByTexts(page, ['К месту выполнения'], 'К месту выполнения');
  if (!travelOk) return false;

  for (let i = 0; i < 10; i++) {
    await pause(page, 1500, 2000);
    const t = await getBodyText(page);
    if (!/В пути ещ/i.test(t)) break;
    await page.goto(page.url(), { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  }

  const searchOk = await clickByTexts(page, ['Искать травы'], 'Искать травы');
  if (!searchOk) {
    console.log(`Herb quest "${questName}": "Искать травы" не найдено на месте - непредвиденный маршрут, пропускаю.`);
    return false;
  }
  await pause(page, 800, 1200);

  for (let round = 0; round < 20; round++) {
    const links = await page.evaluate(() =>
      Array.from(document.querySelectorAll('a')).map((a) => ({ text: a.textContent.trim(), href: a.getAttribute('href') }))
    );
    const pick = links.find((l) => l.text === '*') || links.find((l) => l.text === 'Далее');
    if (!pick) break;
    const href = pick.href.startsWith('http') ? pick.href : `http://lbast.ru/${pick.href.replace(/^\//, '')}`;
    await page.goto(href, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    await pause(page, 500, 900);
  }

  console.log(`Herb quest "${questName}": попытка на сегодня завершена.`);
  return true;
}

async function runHerbQuestsIfAvailable(page) {
  const menuOpened = await resetToQuestMenu(page);
  if (!menuOpened) return false;
  const qNames = parseQuestNamesFromQMenuText(await getBodyText(page));
  for (const name of HERB_QUEST_NAMES) {
    if (isQuestInMenu(qNames, name)) {
      return await runNonQQuestSafe(page, `Herb: ${name}`, () => progressHerbGatherQuest(page, name));
    }
  }
  return false;
}

async function runShipwreckQuestIfAvailable(page) {
  const today = getDayKeyNow();
  if (S.shipwreckDayKey !== today) {
    S.shipwreckDayKey = today;
    S.shipwreckDoneToday = false;
  }
  if (S.shipwreckDoneToday) {
    return false;
  }

  const QUEST = 'Кораблекрушение';
  // 14.09.2026: та же правка, что и для "Демон озера" - проверять список квестов через
  // открытое меню Q, а не текст текущей (обычно location.php) страницы.
  const menuOpened = await resetToQuestMenu(page);
  if (!menuOpened) {
    return false;
  }
  const qNamesNow = parseQuestNamesFromQMenuText(await getBodyText(page));
  if (!isQuestInMenu(qNamesNow, QUEST)) {
    return false;
  }

  const ok = await runNonQQuestSafe(page, 'Shipwreck quest', () => progressShipwreckQuest(page));
  if (ok) {
    // Не отмечаем сразу "сделано" — проверяем, что квест реально исчез из Q меню (тот же приём, что для Харчевни/Штолен/Корованов).
    const menuOk = await resetToQuestMenu(page);
    if (menuOk) {
      const qNames = parseQuestNamesFromQMenuText(await getBodyText(page));
      if (!isQuestInMenu(qNames, QUEST)) {
        S.shipwreckDoneToday = true;
        persistDailyQuestState();
        console.log('Shipwreck quest: done today (confirmed gone from Q).');
      } else {
        console.log('Shipwreck quest: flow ran but quest still in Q -> will retry.');
      }
    } else {
      S.shipwreckDoneToday = true;
      persistDailyQuestState();
    }
  }
  return Boolean(ok);
}
