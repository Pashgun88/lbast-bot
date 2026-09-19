// Ежемесячный квест "Шепот".
// Выделено из ai_char/module.js (там только сборка экспорта). Изменяемое состояние - S из ./state.

// Экспорт стоит ДО require: файлы lib/ вызывают друг друга по кругу, а объявления функций
// всплывают (hoisting), поэтому к моменту любого встречного require все функции уже здесь.
module.exports = {
  hpFraction, shepotCheckHpFloorOrStop, shepotBlastThroughNarrative, shepotChurchToBar,
  shepotRunOneFight, shepotSnap, shepotReadHpFrom, shepotWaitForHp, runShepotGauntletContinuous,
  progressShepotQuestStage, runShepotQuestIfAvailable,
};

const {
  S, getMonthKeyNow, HP_FLOOR_WITH_BUFF, parseCooldownError, persistDailyQuestState,
} = require('./state');
const { getBodyText, parseStats, pause } = require('./core');
const { runNonQQuestSafe } = require('./daily_quests');
const { fightLoop } = require('./fight');
const { isQuestInMenu, parseQuestNamesFromQMenuText, resetToQuestMenu } = require('./quest_menu');
const { isAnyBuffAleActive, tryDrinkBuffAle } = require('./recovery');
const { clickByTexts, clickOnlySensibleOption, existsAnyText } = require('./ui');

// ===================================================================================
// "Шепот" - взят у "Кулак Хаоса", раз в МЕСЯЦ (Паша, 16.09.2026: "запомни как делается он
// периодический"). Гайд Kate2008 (zhg_web.php?st_id=122225), но живой прогон 16.09.2026 разошёлся
// с текстом гайда в нескольких местах - код ниже использует ПОДТВЕРЖДЁННЫЙ живьём маршрут
// (см. aichar_shepot_quest.md), а не гайд буквально:
//   - вместо "К месту выполнения" (просто показывает текущую локацию, не запускает сцену) -
//     Амулет -> Кулак Хаоса -> "К себе в дом".
//   - вместо долгого морского маршрута до Глинбага - "Пристань" -> лодка (15 дин), см. stage 3.
//   - фигура в церкви: трогаем ЗВЕЗДУ (подтверждено Пашей для мировоззрения AI__), не круг/треугольник.
//   - реальная кнопка на утёсе - "Пройтись по утесу" (не "Прогуляться", как в гайде).
//
// КРИТИЧЕСКИ ВАЖНЫЙ УРОК (инцидент 17.09.2026): на экране "В бой!" сайт временно перестаёт
// показывать HP (parseStats -> null/null) до разрешения боя. Первая версия этого кода проверяла
// HP только НЕПОСРЕДСТВЕННО перед кликом "В бой!" и, если parseStats возвращал null, тупо
// пропускала проверку порога вместо того чтобы её заблокировать - это позволило войти во второй
// бой гаунтлета при HP 210/380 (55%, уже ниже 70%) и уйти в минус (-8/380, фактическая "смерть").
// Отсюда два жёстких правила ниже:
//   1) shepotCheckHpFloorOrStop читает HP на СТАБИЛЬНОМ экране (там, где статы гарантированно
//      видны - "К себе в дом", "Продолжить квест" и т.п.), НИКОГДА на экране "В бой!" самом.
//   2) Если HP не читается (null) - код ОСТАНАВЛИВАЕТСЯ, а не пропускает проверку.
//   3) Гаунтлет из 4 боёв (stage 5) делает РОВНО ОДИН бой за вызов и возвращается - следующий
//      бой начнётся только на следующий вызов функции (следующий цикл driver.js), давая время
//      на естественное восстановление HP между боями вместо слепого чейна всех 4 подряд.
//
// Стадии (shepotStage, персистится в state.json - переживает рестарт процесса):
//   0 - интро (свинья/бабка/кошмары) в Кулак Хаоса, не пройдено вживую подряд в этом коде -
//       используется clickOnlySensibleOption как основной механизм (чисто линейные экраны).
//   1 - церковь (первый визит) -> бар -> соглашение принести сталь+мёд.
//   2 - маршрут на Каменный утёс, бой с Духом гнома (сталь).
//   3 - маршрут на Глинбаг (лодка) -> Лес -> бой с Троллем (мёд).
//   4 - возврат в бар, сдача стали+мёда Фра Станьоле.
//   5 - гаунтлет у Кулак Хаоса: ударить свинью/"Продолжить квест" -> определить, какой монстр
//       появился (Нежить/Нечисть/Призрак/ведьма) -> использовать СООТВЕТСТВУЮЩИЙ предмет ->
//       один бой -> return. Стадия не увеличивается, пока не пройдены все 4 монстра (гейт по
//       диалогу "Гильдия вичхантеров" в тексте страницы).
//   6 - сдача квеста в Гильдии вичхантеров (маршрут до гильдии НЕ проверен вживую - см. заметку
//       внутри, verify live перед первым использованием этой стадии).
// ===================================================================================

const SHEPOT_HP_FLOOR = 0.7;

function hpFraction(stats) {
  if (!stats || stats.hpCurrent == null || stats.hpMax == null || stats.hpMax === 0) return null;
  return stats.hpCurrent / stats.hpMax;
}

// Единственное место, где код решает "можно ли в бой" - читает HP ИМЕННО СЕЙЧАС (вызывающий
// обязан звать это на стабильном экране, не на "В бой!"). null (не прочитали) тоже блокирует -
// это и есть исправление бага 17.09.2026, где null ошибочно пропускал проверку.
async function shepotCheckHpFloorOrStop(page, label) {
  const stats = parseStats(await getBodyText(page));
  const frac = hpFraction(stats);
  console.log(`Шепот (${label}): HP ${stats.hpCurrent}/${stats.hpMax}`);
  if (frac == null) {
    console.log(`Шепот (${label}): HP не читается - на всякий случай СТОП, не рискую (см. инцидент 17.09.2026).`);
    return false;
  }
  if (frac < SHEPOT_HP_FLOOR) {
    console.log(`Шепот (${label}): HP ${Math.round(frac * 100)}% ниже порога ${SHEPOT_HP_FLOOR * 100}% - жду восстановления, бой не начинаю.`);
    return false;
  }
  return true;
}

// Линейные повествовательные экраны (интро, видение в церкви) - используем
// clickOnlySensibleOption, чтобы не перечислять вручную формулировки каждой кнопки (гайд и
// живой текст расходятся в мелочах). Останавливается на реальных развилках/боях/целевом экране.
async function shepotBlastThroughNarrative(page, { stopTexts = [], maxSteps = 30, label = '' } = {}) {
  for (let i = 0; i < maxSteps; i++) {
    if (await existsAnyText(page, stopTexts)) {
      return { reachedStop: true, steps: i };
    }
    if (await existsAnyText(page, ['Ответить "да"'])) {
      await clickByTexts(page, ['Ответить "да"'], `Шепот/${label}: Ответить "да"`);
      await pause(page, 800, 1500);
      continue;
    }
    if (await existsAnyText(page, ['Коснуться звезды'])) {
      await clickByTexts(page, ['Коснуться звезды'], `Шепот/${label}: Коснуться звезды`);
      await pause(page, 800, 1500);
      continue;
    }
    if (await existsAnyText(page, ['В бой!', 'В бой'])) {
      return { reachedFight: true, steps: i };
    }
    const result = await clickOnlySensibleOption(page, `Шепот/${label} шаг ${i}`);
    if (result.clicked) {
      await pause(page, 800, 1500);
      continue;
    }
    if (result.reason === 'no_candidates' && (await existsAnyText(page, ['Уйти']))) {
      await clickByTexts(page, ['Уйти'], `Шепот/${label}: Уйти`);
      await pause(page, 800, 1500);
      continue;
    }
    console.log(`Шепот/${label}: застрял на шаге ${i} (${result.reason}), кандидаты: ${JSON.stringify(result.candidates)}`);
    return { stuck: true, reason: result.reason, candidates: result.candidates, steps: i };
  }
  return { maxStepsReached: true };
}

// Церковь -> звезда -> переулок -> бар. Общий кусок для stage 1 (первый визит) и stage 4
// (возврат со сталью/мёдом) - подтверждено живьём 16-17.09.2026 (возврат), первый визит из
// более ранней сессии (не в этом транскрипте, но тот же одноразовый сценарий).
async function shepotChurchToBar(page) {
  await clickByTexts(page, ['Конь'], 'Шепот: Конь');
  await pause(page, 800, 1200);
  await clickByTexts(page, ['Таможенный пост'], 'Шепот: Таможенный пост');
  await pause(page, 8000, 9000);
  await page.goto('http://lbast.ru/location.php', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  await pause(page, 500, 800);

  for (const dir of ['Идти на запад', 'Идти на запад', 'Идти на север']) {
    await clickByTexts(page, [dir], `Шепот: ${dir}`);
    await pause(page, 800, 1200);
  }

  if (await existsAnyText(page, ['Продолжить квест'])) {
    await clickByTexts(page, ['Продолжить квест'], 'Шепот: Продолжить квест (церковь)');
    await pause(page, 800, 1200);
  } else if (await existsAnyText(page, ['Зайти в церковь'])) {
    await clickByTexts(page, ['Зайти в церковь'], 'Шепот: Зайти в церковь');
    await pause(page, 800, 1200);
  }

  const result = await shepotBlastThroughNarrative(page, {
    stopTexts: ['Зайти в Бар', 'Зайти в бар'],
    maxSteps: 30,
    label: 'церковь->бар',
  });
  if (!result.reachedStop) {
    console.log('Шепот: не дошёл до бара автоматически - см. лог выше, нужна ручная проверка.');
    return false;
  }

  await clickByTexts(page, ['Зайти в Бар'], 'Шепот: Зайти в Бар');
  await pause(page, 800, 1200);
  if (await existsAnyText(page, ['Спросить про знахаря'])) {
    await clickByTexts(page, ['Спросить про знахаря'], 'Шепот: Спросить про знахаря');
    await pause(page, 800, 1500);
  }
  // Первый визит (обещание принести предметы) и возврат (сдача предметов) продолжаются разным
  // диалогом - добиваем что осталось через общий помощник, он сам остановится на "Уйти"/пустоте.
  await shepotBlastThroughNarrative(page, { stopTexts: [], maxSteps: 10, label: 'бар-диалог' });
  return true;
}

async function shepotRunOneFight(page, label) {
  if (!(await shepotCheckHpFloorOrStop(page, label))) return false;
  await clickByTexts(page, ['В бой!', 'В бой'], `Шепот: В бой! (${label})`);
  const won = await fightLoop(page);
  const after = parseStats(await getBodyText(page));
  console.log(`Шепот: бой "${label}" завершён, won=${won}, HP после: ${after.hpCurrent}/${after.hpMax}`);
  return true;
}

// ===================================================================================
// Гаунтлет "Шепота" - НЕПРЕРЫВНЫЙ прогон (17.09.2026, после 5 неудачных попыток подряд).
// Установленный живьём факт: гаунтлет это ОДНА непрерывная сцена. После "Бой завершен!"
// следующий монстр появляется на ТОМ ЖЕ экране ("Из тумана перед вами появляется нечисть!").
// Если уйти со сцены (навигация, закрытие браузера) - цепочка теряется целиком: "Продолжить
// квест" на форпосте НЕ появляется, а повторный вход "К себе в дом" + "Ударить свинью"
// начинает всё заново с нежити. Именно поэтому 5 попыток подряд дрались с нежитью.
// Второй установленный факт: экраны внутри дома не показывают шапку со статами (HP = null),
// поэтому HP читается с ОТДЕЛЬНОЙ вкладки (hpPage) - основная вкладка со сценой не трогается.
// Предметы ("отвар арайи"/"рябина"/"святая вода") - это кнопки сцены, а НЕ предметы
// инвентаря (проверено: в инвентаре их нет вообще), поэтому "кончились" тут невозможно.
// ===================================================================================
const SHEPOT_MONSTER_ITEMS = [
  { re: /нежить/i, item: 'Использовать отвар арайи', name: 'Нежить' },
  { re: /нечисть/i, item: 'Использовать рябину', name: 'Нечисть' },
  { re: /призрак/i, item: 'Использовать святую воду', name: 'Призрак' },
  { re: /ведьм/i, item: null, name: 'Старая ведьма' },
];

function shepotSnap(t, n = 900) {
  return String(t || '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
}

async function shepotReadHpFrom(hpPage) {
  await hpPage.goto('http://lbast.ru/location.php', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  return parseStats(await getBodyText(hpPage));
}

// Ждёт восстановления HP, НЕ трогая вкладку со сценой. null (не прочитали) - это СТОП,
// а не "пропустить проверку" (инцидент 17.09.2026, см. feedback_shtolni_debugging_mistakes).
async function shepotWaitForHp(hpPage, floor, label, maxWaitMs = 90 * 60 * 1000) {
  const started = Date.now();
  // Сколько подряд нечитаемых опросов HP терпим, прежде чем сдаться (см. комментарий ниже).
  const MAX_NULL_READS = 5;
  let nullReads = 0;
  for (;;) {
    const stats = await shepotReadHpFrom(hpPage);
    const frac = hpFraction(stats);
    if (frac == null) {
      // 17.09.2026, живой случай: ОДИН нечитаемый опрос HP на второй вкладке (страница
      // отрендерилась без шапки - похоже на входящую атаку или сбой загрузки) убил весь прогон
      // гаунтлета на призраке, хотя сцена была цела и бой был не начат. Правило "null = не
      // драться" остаётся железным, но блокировать оно должно БОЙ, а не само ожидание:
      // перечитываем. Сдаёмся только если HP не читается много опросов подряд.
      nullReads += 1;
      if (nullReads >= MAX_NULL_READS) {
        console.log(`Шепот/${label}: HP не читается ${nullReads} опросов подряд -> СТОП.`);
        return false;
      }
      console.log(`Шепот/${label}: HP не прочитался (попытка ${nullReads}/${MAX_NULL_READS}) - перечитаю через минуту, сцену не трогаю.`);
      await new Promise((r) => setTimeout(r, 60000));
      continue;
    }
    nullReads = 0;
    // 17.09.2026: с активным элем порог опускается до HP_FLOOR_WITH_BUFF - это давнее правило
    // Паши ("с активным элем можно опустить порог хп до 0.4"), и именно здесь оно принципиально.
    // Гаунтлет обязан уложиться в ОДНУ сессию (иначе цепочка рвётся), а бафф эля конечен: ждать
    // до 70%, пока эль тикает, значит рискнуть доигрывать уже без него, а без эля бои стоят
    // 170-210 урона вместо 50-116. Живой случай: регенерация встала на 230/340 (68%) в восьми
    // единицах от порога 70%, и ожидание жгло бафф впустую. Бафф перечитываем каждый опрос на
    // ОТДЕЛЬНОЙ вкладке - он может истечь посреди ожидания, и тогда порог обязан вернуться к 0.7.
    const buffed = await isAnyBuffAleActive(hpPage).catch(() => false);
    const effectiveFloor = buffed ? HP_FLOOR_WITH_BUFF : floor;
    if (frac >= effectiveFloor) {
      console.log(`Шепот/${label}: HP ${stats.hpCurrent}/${stats.hpMax} (${Math.round(frac * 100)}%), порог ${Math.round(effectiveFloor * 100)}%${buffed ? ' (эль активен)' : ''} - можно в бой.`);
      return true;
    }
    if (Date.now() - started > maxWaitMs) {
      console.log(`Шепот/${label}: HP не восстановилось за ${Math.round(maxWaitMs / 60000)} мин -> СТОП.`);
      return false;
    }
    console.log(`Шепот/${label}: HP ${stats.hpCurrent}/${stats.hpMax} (${Math.round(frac * 100)}%) < ${Math.round(effectiveFloor * 100)}%${buffed ? ' (эль активен)' : ''} - жду 2 мин, сцену не трогаю.`);
    await new Promise((r) => setTimeout(r, 120000));
  }
}

// maxSteps, а не maxFights: итерации цикла тратятся и на не-боевые экраны (Продолжить квест,
// промежуточные виньетки), поэтому запас должен быть заметно больше числа боёв (их 4).
async function runShepotGauntletContinuous(page, hpPage, { maxFights = 24, hpFloor = SHEPOT_HP_FLOOR } = {}) {
  await page.goto('http://lbast.ru/location.php', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await pause(page, 500, 800);

  if (!(await shepotWaitForHp(hpPage, hpFloor, 'перед входом в дом'))) return false;

  // Паша, 17.09.2026: "на второй бой надо будет выпить эль вырви глаз". Пьём с ОТДЕЛЬНОЙ
  // вкладки - tryDrinkBuffAle ходит в pers.php/inv.php и вернул бы основную вкладку по URL,
  // а это увело бы нас со сцены.
  await tryDrinkBuffAle(hpPage, 'Эль "Вырви глаз"').catch((e) => {
    console.log('Шепот: эль не выпит -', e.message);
    return false;
  });

  await clickByTexts(page, ['Амулет', 'Aмулет'], 'Шепот: Амулет');
  await pause(page, 800, 1200);
  await clickByTexts(page, ['Кулак Хаоса'], 'Шепот: Кулак Хаоса');
  await pause(page, 1500, 2500);

  if (await existsAnyText(page, ['Продолжить квест'])) {
    await clickByTexts(page, ['Продолжить квест'], 'Шепот: Продолжить квест (гаунтлет)');
    await pause(page, 800, 1200);
  } else if (await existsAnyText(page, ['К себе в дом'])) {
    await clickByTexts(page, ['К себе в дом'], 'Шепот: К себе в дом (гаунтлет)');
    await pause(page, 800, 1200);
  }

  let text = String((await getBodyText(page)) || '');
  const monsterOnScreen = SHEPOT_MONSTER_ITEMS.some(({ re }) => re.test(text));
  if (!monsterOnScreen && (await existsAnyText(page, ['Ударить свинью']))) {
    await clickByTexts(page, ['Ударить свинью'], 'Шепот: Ударить свинью (старт гаунтлета, один раз)');
    await pause(page, 800, 1500);
  }

  for (let i = 0; i < maxFights; i++) {
    text = String((await getBodyText(page)) || '');
    console.log(`\nШепот/гаунтлет, экран ${i + 1}: ${shepotSnap(text)}`);

    // Игра пишет про гильдию в РОДИТЕЛЬНОМ падеже и с маленькой буквы ("спешить в гильдию
    // вичхантеров"), поэтому точное "Гильдия вичхантеров" из гайда тут не матчится - ловим
    // по корню. Плюс победный текст "Ведьма убита" - самый надёжный признак конца гаунтлета.
    if (/Ведьма убита|гильди\w*\s+вичхантеров|Спросить орка Хрыга/i.test(text)) {
      console.log('Шепот: гаунтлет пройден! Дальше сдача в Гильдии вичхантеров (stage 6).');
      S.shepotStage = 6;
      S.shepotGauntletFightsDone = 0;
      persistDailyQuestState();
      return true;
    }

    let match = SHEPOT_MONSTER_ITEMS.find(({ re }) => re.test(text));
    // Слово "ведьм" встречается и в ПОБЕДНОМ тексте ("Ведьма убита...", "Отбившись от ведьминых
    // прихвостней"), поэтому для ведьмы одного упоминания мало - нужна реальная кнопка атаки.
    // Живой случай 17.09.2026: после победы код начал копить HP, чтобы "атаковать" уже убитую
    // ведьму, и ждал впустую.
    if (match && match.item === null && !(await existsAnyText(page, ['Атаковать ведьму']))) {
      match = undefined;
    }
    if (!match) {
      // Живой факт 17.09.2026: после КАЖДОГО боя игра сама выбрасывает обратно на форпост
      // "Кулак Хаоса", но сцена гаунтлета остаётся ПОДВЕШЕННОЙ - в шапке появляется
      // "Продолжить квест". Следующий монстр выходит именно по этой ссылке. Раньше цикл её
      // между боями не проверял и вставал на "ambiguous" (на форпосте десяток обычных ссылок).
      if (await existsAnyText(page, ['Продолжить квест'])) {
        await clickByTexts(page, ['Продолжить квест'], 'Шепот: Продолжить квест (следующий монстр)');
        await pause(page, 800, 1500);
        continue;
      }
      // Подвешенной сцены нет - значит цепочка потеряна (вероятно, протухла за время ожидания
      // регенерации HP). Тогда гаунтлет начинается заново, с нежити - это не ошибка, просто
      // дороже по HP.
      if (await existsAnyText(page, ['К себе в дом'])) {
        console.log('Шепот: "Продолжить квест" нет - сцена потеряна, захожу в дом заново (гаунтлет начнётся с нежити).');
        await clickByTexts(page, ['К себе в дом'], 'Шепот: К себе в дом (рестарт гаунтлета)');
        await pause(page, 800, 1500);
        continue;
      }
      if (await existsAnyText(page, ['Ударить свинью'])) {
        await clickByTexts(page, ['Ударить свинью'], 'Шепот: Ударить свинью');
        await pause(page, 800, 1500);
        continue;
      }
      const stepped = await clickOnlySensibleOption(page, `Шепот/гаунтлет промежуточный экран ${i + 1}`);
      if (stepped.clicked) {
        await pause(page, 800, 1500);
        continue;
      }
      console.log(`Шепот: монстра на экране нет и линейного перехода нет (${stepped.reason}, кандидаты ${JSON.stringify(stepped.candidates)}) -> СТОП.`);
      return false;
    }

    if (!(await shepotWaitForHp(hpPage, hpFloor, `перед боем с "${match.name}"`))) return false;

    if (match.item) {
      if (!(await clickByTexts(page, [match.item], `Шепот: ${match.item} (${match.name})`))) {
        console.log(`Шепот: кнопка "${match.item}" не найдена -> СТОП.`);
        return false;
      }
    } else if (!(await clickByTexts(page, ['Атаковать ведьму'], 'Шепот: Атаковать ведьму!'))) {
      console.log('Шепот: "Атаковать ведьму" не найдено -> СТОП.');
      return false;
    }
    await pause(page, 800, 1500);

    if (!(await existsAnyText(page, ['В бой!', 'В бой']))) {
      console.log('Шепот: после предмета нет "В бой!" -> СТОП. Экран:');
      console.log(shepotSnap(await getBodyText(page), 1200));
      return false;
    }
    await clickByTexts(page, ['В бой!', 'В бой'], `Шепот: В бой! (${match.name})`);

    let won = false;
    try {
      won = await fightLoop(page);
    } catch (e) {
      const waitMinutes = parseCooldownError(e);
      if (waitMinutes !== null) {
        console.log(`Шепот: игровой кулдаун цели ${waitMinutes} мин -> жду на месте, сцену не покидаю.`);
        await new Promise((r) => setTimeout(r, (waitMinutes + 1) * 60000));
        continue;
      }
      console.log('Шепот: бой сорвался -', e.message);
      return false;
    }

    S.shepotGauntletFightsDone += 1;
    persistDailyQuestState();
    const hpAfter = await shepotReadHpFrom(hpPage);
    console.log(`Шепот: бой с "${match.name}" завершён (won=${won}), HP теперь ${hpAfter.hpCurrent}/${hpAfter.hpMax}`);
    await pause(page, 800, 1500);
  }

  console.log('Шепот: лимит боёв за один прогон исчерпан - выхожу, прогресс сохранён.');
  return true;
}

async function progressShepotQuestStage(page) {
  // Баг найден 17.09.2026: runShepotQuestIfAvailable вызывает эту функцию сразу после
  // resetToQuestMenu() (страница - меню квестов Q, там нет "Амулет"/"Конь"), а не после
  // возврата на location.php. Каждая стадия начинается с элементов location.php (Амулет/Конь/
  // "К себе в дом" и т.п.) - явно переходим туда в начале, не полагаясь на то, с какой страницы
  // нас позвали.
  await page.goto('http://lbast.ru/location.php', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  await pause(page, 500, 800);

  if (S.shepotStage === 0) {
    await clickByTexts(page, ['Амулет', 'Aмулет'], 'Шепот: Амулет');
    await pause(page, 800, 1200);
    await clickByTexts(page, ['Кулак Хаоса'], 'Шепот: Кулак Хаоса');
    await pause(page, 1500, 2500);
    if (await existsAnyText(page, ['К себе в дом'])) {
      await clickByTexts(page, ['К себе в дом'], 'Шепот: К себе в дом');
      await pause(page, 800, 1200);
    }
    const result = await shepotBlastThroughNarrative(page, {
      stopTexts: ['Зайти в церковь', 'Конь'],
      maxSteps: 30,
      label: 'интро',
    });
    if (result.reachedStop || result.maxStepsReached) {
      S.shepotStage = 1;
      persistDailyQuestState();
      return true;
    }
    console.log('Шепот stage 0 (интро): не завершилось само - нужна ручная проверка.');
    return false;
  }

  if (S.shepotStage === 1) {
    const ok = await shepotChurchToBar(page);
    if (ok) {
      S.shepotStage = 2;
      persistDailyQuestState();
    }
    return ok;
  }

  if (S.shepotStage === 2) {
    await clickByTexts(page, ['Конь'], 'Шепот: Конь');
    await pause(page, 800, 1200);
    await clickByTexts(page, ['Горы Дарии'], 'Шепот: Горы Дарии');
    await pause(page, 8000, 9000);
    await page.goto('http://lbast.ru/location.php', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    await pause(page, 500, 800);
    for (const dir of ['Идти на запад', 'Идти на юг', 'Идти на запад', 'Идти на запад', 'Идти на север', 'Идти на север', 'Идти на север']) {
      await clickByTexts(page, [dir], `Шепот: ${dir}`);
      await pause(page, 800, 1200);
    }
    await clickByTexts(page, ['Пройтись по утесу', 'Прогуляться по утесу'], 'Шепот: Пройтись по утесу');
    await pause(page, 800, 1200);
    if (!(await existsAnyText(page, ['В бой!', 'В бой']))) {
      console.log('Шепот stage 2: "В бой!" не найдено на утёсе - незнакомое состояние.');
      return false;
    }
    if (!(await shepotRunOneFight(page, 'Дух гнома'))) return false;
    await shepotBlastThroughNarrative(page, { stopTexts: [], maxSteps: 5, label: 'утёс-после-боя' });
    S.shepotStage = 3;
    persistDailyQuestState();
    return true;
  }

  if (S.shepotStage === 3) {
    await clickByTexts(page, ['Амулет', 'Aмулет'], 'Шепот: Амулет');
    await pause(page, 800, 1200);
    await clickByTexts(page, ['Девтаун'], 'Шепот: Девтаун');
    await pause(page, 1500, 2500);
    for (const dir of ['Идти на восток', 'Идти на восток']) {
      await clickByTexts(page, [dir], `Шепот: ${dir}`);
      await pause(page, 800, 1200);
    }
    await clickByTexts(page, ['Пристань'], 'Шепот: Пристань');
    await pause(page, 800, 1200);
    await clickByTexts(page, ['Взять лодку до острова Глинбаг'], 'Шепот: лодка до Глинбага (15 дин)');
    await pause(page, 800, 1200);
    await clickByTexts(page, ['Далее'], 'Шепот: Далее (после лодки)');
    await pause(page, 800, 1200);

    const glinbagRoute = [
      'Выйти на набережную',
      'Идти на север', 'Идти на север',
      'Идти на восток', 'Идти на восток', 'Идти на восток', 'Идти на восток',
      'Идти на юг', 'Идти на юг', 'Идти на юг',
      'Идти на запад',
      'Идти на юг',
      'Идти на запад',
      'Идти на север', 'Идти на север',
      'Идти на запад',
    ];
    for (const step of glinbagRoute) {
      await clickByTexts(page, [step], `Шепот: ${step}`);
      await pause(page, 700, 1100);
    }

    if (await existsAnyText(page, ['Пасечник'])) {
      await clickByTexts(page, ['Пасечник'], 'Шепот: Пасечник');
      await pause(page, 800, 1200);
    }
    await shepotBlastThroughNarrative(page, { stopTexts: ['В бой!', 'В бой'], maxSteps: 10, label: 'пасечник-диалог' });
    if (!(await existsAnyText(page, ['В бой!', 'В бой']))) {
      console.log('Шепот stage 3: "В бой!" (Тролль) не найдено - незнакомое состояние.');
      return false;
    }
    if (!(await shepotRunOneFight(page, 'Тролль'))) return false;
    if (await existsAnyText(page, ['Вернуться'])) {
      await clickByTexts(page, ['Вернуться'], 'Шепот: Вернуться (после Тролля)');
      await pause(page, 800, 1200);
    }
    S.shepotStage = 4;
    persistDailyQuestState();
    return true;
  }

  if (S.shepotStage === 4) {
    const ok = await shepotChurchToBar(page);
    if (ok) {
      S.shepotStage = 5;
      persistDailyQuestState();
    }
    return ok;
  }

  if (S.shepotStage === 5) {
    // 17.09.2026: гаунтлет обязан идти ОДНОЙ непрерывной сценой - подробности и причины
    // в комментарии над runShepotGauntletContinuous. Вторая вкладка нужна только для чтения
    // HP и питья эля, основная вкладка со сценой не покидается никогда.
    const hpPage = await page.context().newPage();
    try {
      return await runShepotGauntletContinuous(page, hpPage);
    } finally {
      await hpPage.close().catch(() => {});
    }
  }

  if (S.shepotStage === 6) {
    // Маршрут ПОДТВЕРЖДЁН живьём 17.09.2026. В гайде Kate2008 его нет вообще - гайд обрывается
    // на "Как можно быстрее нужно попасть в Гильдию вичхантеров". Паша подсказал город и ворота
    // (сначала назвал восточные - там гильдии нет, проверено; она у СЕВЕРНЫХ ворот Стоунгарда).
    // Точный текст ссылки входа: "Гильдия вичхантеров". Награда за сдачу: 274 дин.
    const GUILD = 'Гильдия вичхантеров';

    if (!(await existsAnyText(page, [GUILD]))) {
      await clickByTexts(page, ['Амулет', 'Aмулет'], 'Шепот: Амулет');
      await pause(page, 800, 1200);
      await clickByTexts(page, ['Стоунгард'], 'Шепот: Стоунгард');
      await pause(page, 1500, 2500);
      await page.goto('http://lbast.ru/location.php', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
      await pause(page, 600, 1000);
      if (await existsAnyText(page, ['Северные ворота'])) {
        await clickByTexts(page, ['Северные ворота'], 'Шепот: Северные ворота Стоунгарда');
        await pause(page, 800, 1200);
      }
    }

    if (!(await existsAnyText(page, [GUILD]))) {
      console.log('Шепот stage 6: "Гильдия вичхантеров" не найдена -> СТОП.');
      return false;
    }

    await clickByTexts(page, [GUILD], `Шепот: вход в ${GUILD}`);
    await pause(page, 900, 1400);

    // Реплики сдачи подтверждены живьём, слово в слово (совпали с гайдом).
    const TURN_IN_DIALOG = [
      'Спросить орка Хрыга',
      'Нет... А что это?',
      'Но теперь ведьма мертва, все в порядке?',
      'Взять и уйти',
    ];
    for (const line of TURN_IN_DIALOG) {
      if (!(await existsAnyText(page, [line]))) {
        console.log(`Шепот stage 6: реплика "${line}" не найдена -> СТОП.`);
        return false;
      }
      await clickByTexts(page, [line], `Шепот: ${line}`);
      await pause(page, 800, 1300);
    }

    console.log('Шепот: квест сдан, награда получена. Следующий заход - в следующем месяце.');
    S.shepotStage = 0;
    S.shepotGauntletFightsDone = 0;
    S.shepotDoneThisMonth = true;
    persistDailyQuestState();
    return true;
  }

  console.log(`Шепот: неизвестная стадия ${S.shepotStage} - сбрасываю на 0.`);
  S.shepotStage = 0;
  persistDailyQuestState();
  return false;
}

// Точка входа для driver.js: гейтит по разу-в-месяц и по наличию квеста в Q-меню (когда
// stage=0, т.е. квест ещё не в процессе), делает ОДИН логический шаг за вызов (не весь квест
// разом) - специально, чтобы driver.js мог продолжать обычный цикл (фарм/другие квесты/чат)
// между шагами, и чтобы HP-гейты внутри имели шанс сработать между вызовами, а не в одном
// монолитном забеге.
async function runShepotQuestIfAvailable(page) {
  const month = getMonthKeyNow();
  if (S.shepotMonthKey !== month) {
    S.shepotMonthKey = month;
    S.shepotDoneThisMonth = false;
    persistDailyQuestState();
  }
  if (S.shepotDoneThisMonth) return false;

  if (S.shepotStage === 0) {
    const menuOpened = await resetToQuestMenu(page);
    if (!menuOpened) return false;
    const qNames = parseQuestNamesFromQMenuText(await getBodyText(page));
    if (!isQuestInMenu(qNames, 'Шепот')) return false;
  }

  return await runNonQQuestSafe(page, 'Шепот quest', () => progressShepotQuestStage(page));
}
