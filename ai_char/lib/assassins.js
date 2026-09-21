// Гильдия асассинов (банкир/картина/торговец).
// Выделено из ai_char/module.js (там только сборка экспорта). Изменяемое состояние - S из ./state.

// Экспорт стоит ДО require: файлы lib/ вызывают друг друга по кругу, а объявления функций
// всплывают (hoisting), поэтому к моменту любого встречного require все функции уже здесь.
module.exports = {
  goToAssassinGuildBuilding, acceptAssassinGuildQuest, ensureAssassinQuestTaken,
  waitOutHorseTravel, goToAssassinGuildQuestSpot, progressAssassinBankerQuest,
  progressAssassinPaintingQuest, progressAssassinMerchantQuest, runAssassinGuildQuestsIfAvailable,
};

const {
  S, ASSASSIN_MERCHANT_MAX_ATTEMPTS_PER_DAY, assassinGuildDoneToday, persistDailyQuestState,
  resetAssassinGuildDayIfNeeded,
} = require('./state');
const { getBodyText, parseStats, pause } = require('./core');
const { fightLoop } = require('./fight');
const {
  hpFractionForGate, noteHpFromPageText, questFightHpGate, runQuestStepSafe,
  tryPerformStepOptional,
} = require('./hp');
const {
  hasAlreadyHasQuestText, parseQuestNamesFromQMenuText, resetToQuestMenu,
} = require('./quest_menu');
const { ensureNoStuckResponsibleTask } = require('./scenario');
const { clickByTexts, existsAnyText, performStep } = require('./ui');

// 15.09.2026, финальный найденный корень сегодняшних сбоев банкира: "obj=44" (Гильдия
// асассинов) рендерит СОВЕРШЕННО ПУСТУЮ страницу (даже без списка заданий), если открыть
// его напрямую URL'ом, находясь не на своей клетке - объект живёт на "Западные ворота"
// Стоунгарда, и без физического захода туда сначала (Стоунгард -> Западные ворота ->
// Гильдия асассинов) go=1&zad=N молча ничего не делает. Раньше это иногда "работало"
// случайно, если персонаж уже был на воротах от предыдущего действия - отсюда
// непоследовательные результаты весь день.
async function goToAssassinGuildBuilding(page) {
  await page.goto('http://lbast.ru/location.php?mod=fastway&lway=2', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await pause(page, 800, 1500);
  await clickByTexts(page, ['Западные ворота'], 'Западные ворота');
  await pause(page, 800, 1500);
}

async function acceptAssassinGuildQuest(page, zad) {
  await goToAssassinGuildBuilding(page);
  await page.goto(`http://lbast.ru/loc.php?obj=44&go=1&zad=${zad}`, {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  await pause(page, 900, 1500);

  // 17.09.2026: этот шаг был НЕМЫМ - он не проверял, взялось ли задание, и не писал в лог
  // ни строки. Из-за этого сообщение о том, что цель не появилась, выглядело загадкой:
  // непонятно, ответила ли гильдия, отказала ли и почему. Немой шаг в середине цепочки
  // превращает любой сбой ниже по течению в необъяснимый.
  const respText = await getBodyText(page).catch(() => '');
  const flat = String(respText || '').split(String.fromCharCode(10)).join(' ').trim().slice(0, 220);
  console.log(`Гильдия асассинов: ответ на взятие задания zad=${zad}: ${flat || '(ПУСТАЯ СТРАНИЦА)'}`);
  return respText;
}

// 15.09.2026, живой регресс: сначала пытался снимать блокер "ответственного задания" ПЕРЕД
// каждым accept - но если этот самый банкир/картина/торговец уже В ПРОЦЕССЕ (сам занимает
// слот, персонаж на середине гаунтлета с охранниками), это ошибочно сбрасывало СОБСТВЕННЫЙ
// незавершённый прогресс квеста при каждой повторной попытке, снова и снова начиная его с
// нуля. Правильный порядок: сначала проверить цель на месте БЕЗ переприёма (если квест уже
// наш и активен - она будет видна, ничего не трогаем); только если её нет - принять
// (и лишь если это тоже не помогло - тогда уже искать чужой блокер и снимать именно его).
async function ensureAssassinQuestTaken(page, zad, targetTexts) {
  await goToAssassinGuildQuestSpot(page, zad);
  if (await existsAnyText(page, targetTexts)) {
    return true;
  }

  await acceptAssassinGuildQuest(page, zad);
  await goToAssassinGuildQuestSpot(page, zad);
  if (await existsAnyText(page, targetTexts)) {
    return true;
  }

  const dropped = await ensureNoStuckResponsibleTask(page);
  if (!dropped) {
    return false;
  }
  await acceptAssassinGuildQuest(page, zad);
  await goToAssassinGuildQuestSpot(page, zad);
  return existsAnyText(page, targetTexts);
}

// Прямой goto на quest-шорткат коня иногда приземляется на промежуточный экран поездки
// ("Вы скачете вперед... В пути еще N сек.") вместо конечной локации — ждём и обновляем
// страницу, пока не доедем (обычно 3-7 сек, см. остальные Конь-маршруты в этом файле).
async function waitOutHorseTravel(page, url, maxAttempts = 8) {
  for (let i = 0; i < maxAttempts; i++) {
    const text = await getBodyText(page);
    if (!/В\s*пути/i.test(text)) {
      return;
    }
    await pause(page, 2000, 3000);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  }
}

async function goToAssassinGuildQuestSpot(page, zad) {
  const url = `http://lbast.ru/location.php?mod=konj&lway=q2_${zad}`;
  await page.goto(url, {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  await pause(page, 900, 1500);
  await waitOutHorseTravel(page, url);
}

async function progressAssassinBankerQuest(page) {
  const taken = await ensureAssassinQuestTaken(page, 3, ['Идти к дому', 'идти к дому']);

  // Похоже, каждое задание гильдии выполнимо не чаще раза в день: если цель на клетке
  // не появилась даже после честной попытки принять и снять чужой блокер, задание уже
  // сделано сегодня — это не ошибка, а нормальный дневной лимит.
  // 17.09.2026: раньше здесь стояло `return true` с рассуждением "не нашёл цель - похоже,
  // уже сделано". Это и есть источник ложных флагов: тот же самый отрицательный сигнал даёт
  // гибель в гаунтлете, неудачная поездка на коне и чужой блокер в анкете. "Не смог
  // убедиться" - не "сделано". О выполненности судит меню Q в runAssassinGuildQuestsIfAvailable.
  if (!taken) {
    console.log('Assassin quest (банкир): цель "Идти к дому" не появилась - не берусь судить, сделано ли; решает меню Q.');
    return false;
  }

  // 15.09.2026, живой баг: "Идти к дому" может успешно появиться и сработать (квест ещё
  // числится не сданным в state.json, напр. после ручного вмешательства Паши), но "Дом
  // банкира" сам сообщает "Вы уже выполняли это задание сегодня." вместо реального
  // гаунтлета - раньше это било в "Не найден шаг Идти в спальню" -> Quest step error ->
  // Recover to city каждый цикл подряд, вместо того чтобы просто пометить готово.
  if (await existsAnyText(page, ['Вы уже выполняли это задание сегодня'])) {
    console.log('Assassin quest (банкир): "Вы уже выполняли это задание сегодня" — считаю сделанным.');
    return true;
  }

  // 15.09.2026, живой прогон: реальность не совпала с изначально закодированным маршрутом -
  // "Зайти в дом"/"Идти вперед" не появлялись вовсе, "Войти в ворота" был только на первом
  // заходе, и боёв с охранником оказалось явно больше одного-двух (не выяснено точное число
  // без риска). Вместо жёсткого счётчика - адаптивный цикл: "Идти к дому" (+опциональные
  // "Войти в ворота"/"Зайти в дом"/"Идти вперед", если появятся) -> бой, если есть -> повтор,
  // пока не появится "Идти в спальню" (следующий реальный шаг) или не сработает страховочный
  // лимит попыток. HP-гейт перед каждым боем - не лезем в драку ниже 70% макс (см. просьбу
  // Паши "не забывай про хп, с низким не заходи в бой"; порог поднят после реального
  // KO ниже в этом же коде).
  const MAX_GUARD_FIGHTS = 6;
  for (let attempt = 1; attempt <= MAX_GUARD_FIGHTS; attempt += 1) {
    if (await existsAnyText(page, ['Идти в спальню', 'идти в спальню', 'Идти к банкиру', 'идти к банкиру'])) {
      break;
    }
    if (await existsAnyText(page, ['Вы уже выполняли это задание сегодня'])) {
      console.log('Assassin quest (банкир): "Вы уже выполняли это задание сегодня" (обнаружено в гаунтлете) — считаю сделанным.');
      return true;
    }

    // 15.09.2026, живой инцидент: один охранник (С:44,И:37,Л:30,Бр:37, урон 55-63) один раз
    // унёс HP с 210ish до -15 ДАЖЕ с эликсиром (+40) применённым в процессе - обычный порог
    // 40% тут недостаточен, слишком близко к тому, что один бой реально может забрать больше
    // половины макс. HP. Порог поднят до 70% специально для этого квеста.
    const preText = await getBodyText(page);
    const preStats = parseStats(preText);
    noteHpFromPageText(preText, 'банкир: перед боем');
    const guardFrac = hpFractionForGate(preStats);
    if (guardFrac === null || guardFrac < 0.7) {
      const shown = guardFrac === null ? 'HP не читается ни на экране, ни по последнему замеру' : `${Math.round(guardFrac * 100)}% < 70%`;
      console.log(`Assassin quest (банкир): HP-гейт не пройден (${shown}) -> останавливаюсь перед боем, продолжу позже ("Продолжить квест" сохранит прогресс).`);
      return false;
    }

    await tryPerformStepOptional(page, { stepName: 'Идти к дому', currentTexts: ['Идти к дому', 'идти к дому'] });
    await tryPerformStepOptional(page, { stepName: 'Войти в ворота', currentTexts: ['Войти в ворота', 'войти в ворота'] });
    await tryPerformStepOptional(page, { stepName: 'Зайти в дом', currentTexts: ['Зайти в дом', 'зайти в дом'] });
    await tryPerformStepOptional(page, { stepName: 'Идти вперед', currentTexts: ['Идти вперед', 'идти вперед', 'Идти вперёд', 'идти вперёд'] });

    if (await existsAnyText(page, ['Идти в спальню', 'идти в спальню'])) {
      break;
    }

    if (await existsAnyText(page, ['В бой!', 'в бой!', 'Ударить', 'ударить'])) {
      console.log(`Assassin quest (банкир): бой с охранником, попытка ${attempt}/${MAX_GUARD_FIGHTS}`);
      await fightLoop(page);
      await pause(page, 900, 1500);
    }
  }

  // 18.09.2026, живой прогон: после "Продолжить квест" персонаж стоит УЖЕ в спальне (там
  // "Идти к банкиру" / "Взломать сейф"), и жёсткий шаг "Идти в спальню" ронял квест каждый
  // цикл. А сам шаг в спальню может выбросить засаду - Телохранителя (210 HP, урон 55-63):
  // бой начинается сразу, "Идти к банкиру" на экране нет. Засаду добиваем (отказаться от неё
  // нельзя) и продолжаем квест через "Продолжить квест".
  if (!(await existsAnyText(page, ['Идти к банкиру', 'идти к банкиру']))) {
    await performStep(page, {
      stepName: 'Идти в спальню',
      currentTexts: ['Идти в спальню', 'идти в спальню'],
      retries: 3,
    });
  }
  if (!(await existsAnyText(page, ['Идти к банкиру', 'идти к банкиру']))
    && (await existsAnyText(page, ['В бой!', 'в бой!', 'Ударить', 'ударить']))) {
    console.log('Assassin quest (банкир): засада у спальни (Телохранитель) -> довожу бой.');
    await fightLoop(page);
    await pause(page, 900, 1500);
    await tryPerformStepOptional(page, { stepName: 'Продолжить квест', currentTexts: ['Продолжить квест', 'продолжить квест'] });
  }

  // Гейт финала - В СПАЛЬНЕ, до "Идти к банкиру": здесь ещё есть выход "В игру", а после
  // клика уже нет. Раньше он стоял после клика (та же ошибка, что в Харчевне и Корованах).
  if (!(await questFightHpGate(page, 'Assassin quest (банкир): финал'))) return false;

  // РАЗВИЛКА: только "Идти к банкиру". "Взломать сейф" проваливает задание на сегодня — не трогать.
  await performStep(page, {
    stepName: 'Идти к банкиру',
    currentTexts: ['Идти к банкиру', 'идти к банкиру'],
    retries: 3,
  });

  console.log('Assassin quest (банкир): финальный бой с банкиром');
  await fightLoop(page);

  console.log('Assassin quest (банкир): проход завершён, "Часы банкира" должны быть получены.');
  return true;
}

async function progressAssassinPaintingQuest(page) {
  const taken = await ensureAssassinQuestTaken(page, 2, ['Прокрасться в дом', 'прокрасться в дом']);
  // См. тот же разбор у банкира: "не нашёл цель" не означает "сделано".
  if (!taken) {
    console.log('Assassin quest (картина): цель "Прокрасться в дом" не появилась - не берусь судить, сделано ли; решает меню Q.');
    return false;
  }
  if (await existsAnyText(page, ['Вы уже выполняли это задание сегодня'])) {
    console.log('Assassin quest (картина): "Вы уже выполняли это задание сегодня" — считаю сделанным.');
    return true;
  }

  // 15.09.2026, живой прогон: флейвор-текст при accept предупреждает "дом охраняют
  // большие боевые псы" (множественное число) - подтверждено вживую: после победы над
  // одним псом игра выбрасывает обратно на "Боевые кварталы" (не в "Пройти в дальнюю
  // комнату"), и "Прокрасться в дом" нужно нажимать заново - гаунтлет из нескольких псов,
  // как и гаунтлет охранников у банкира. Адаптивный цикл вместо жёсткой
  // последовательности шагов: заходим -> идём по коридору -> бой, если есть -> повтор,
  // пока не появится "Пройти в дальнюю комнату", с тем же 70%-гейтом перед каждым боем.
  const MAX_DOG_FIGHTS = 6;
  for (let attempt = 1; attempt <= MAX_DOG_FIGHTS; attempt += 1) {
    if (await existsAnyText(page, ['Пройти в дальнюю комнату', 'пройти в дальнюю комнату'])) {
      break;
    }

    await tryPerformStepOptional(page, { stepName: 'Прокрасться в дом', currentTexts: ['Прокрасться в дом', 'прокрасться в дом'] });
    await tryPerformStepOptional(page, { stepName: 'Пройти в конец коридора', currentTexts: ['Пройти в конец коридора', 'пройти в конец коридора'] });

    if (await existsAnyText(page, ['Пройти в дальнюю комнату', 'пройти в дальнюю комнату'])) {
      break;
    }

    if (await existsAnyText(page, ['В бой!', 'в бой!'])) {
      const preText = await getBodyText(page);
      const preStats = parseStats(preText);
      noteHpFromPageText(preText, 'картина: перед боем');
      const frac = hpFractionForGate(preStats);
      if (frac === null || frac < 0.7) {
        const shown = frac === null ? 'HP не читается ни на экране, ни по последнему замеру' : `${Math.round(frac * 100)}% < 70%`;
        console.log(`Assassin quest (картина): HP-гейт не пройден (${shown}) -> не вступаю в бой с псом, продолжу позже ("Продолжить квест" сохранит прогресс).`);
        return false;
      }
      console.log(`Assassin quest (картина): бой с боевым псом, попытка ${attempt}/${MAX_DOG_FIGHTS}`);
      await fightLoop(page);
      await pause(page, 800, 1500);
    }
  }

  // НЕ трогать "Проверить сундучок" — не проверено, что оно даёт, идём сразу в дальнюю комнату.
  await performStep(page, {
    stepName: 'Пройти в дальнюю комнату',
    currentTexts: ['Пройти в дальнюю комнату', 'пройти в дальнюю комнату'],
    retries: 3,
  });

  console.log('Assassin quest (картина): проход завершён, "Старая картина" должна быть получена.');
  return true;
}

async function progressAssassinMerchantQuest(page) {
  const acceptText = await acceptAssassinGuildQuest(page, 1);
  // 18.09.2026: три из шести дневных попыток ушли на ответ "У вас уже есть задание" - слот
  // держали Харчевня и Демон озера, до каравана дело не дошло. Лимит придуман против
  // "караван не стоит на клетке", а не против занятого слота, поэтому такую попытку
  // возвращаем. Дальше всё равно идём на клетку: слот мог занимать сам торговец.
  if (hasAlreadyHasQuestText(acceptText) && S.assassinMerchantAttemptsToday > 0) {
    S.assassinMerchantAttemptsToday -= 1;
    persistDailyQuestState();
    console.log(`Assassin quest (торговец): слот задания занят - попытку не считаю (${S.assassinMerchantAttemptsToday}/${ASSASSIN_MERCHANT_MAX_ATTEMPTS_PER_DAY}).`);
  }
  await goToAssassinGuildQuestSpot(page, 1);

  if (await existsAnyText(page, ['Вы уже выполняли это задание сегодня'])) {
    console.log('Assassin quest (торговец): "Вы уже выполняли это задание сегодня" — считаю сделанным.');
    return true;
  }

  const text = await getBodyText(page);
  if (!/торговый караван/i.test(text)) {
    console.log('Assassin quest (торговец): каравана сейчас нет на этой клетке, попробую в следующий раз.');
    S.assassinMerchantNoCaravanAt = Date.now();
    return false;
  }

  const preStats = parseStats(text);
  noteHpFromPageText(text, 'торговец: перед боем');
  const merchantFrac = hpFractionForGate(preStats);
  if (merchantFrac === null || merchantFrac < 0.7) {
    const shown = merchantFrac === null ? 'HP не читается ни на экране, ни по последнему замеру' : `${Math.round(merchantFrac * 100)}% < 70%`;
    console.log(`Assassin quest (торговец): HP-гейт не пройден (${shown}) -> откладываю бой с караваном (яд опаснее остальных боёв гильдии), попробую в следующем цикле.`);
    return false;
  }

  await performStep(page, {
    stepName: 'Напасть на караван',
    currentTexts: ['Напасть на караван', 'напасть на караван'],
    retries: 3,
  });

  console.log('Assassin quest (торговец): бой с торговцем (возможен урон от яда, было опаснее остальных)');
  await fightLoop(page);

  console.log('Assassin quest (торговец): проход завершён, "Четки торговца" должны быть получены.');
  return true;
}

// Дневной диспетчер: гоняется из runDailyQuests/driver.js каждый цикл, сам решает, что ещё
// не сделано сегодня, и делает ровно один шаг за вызов (не спамит все три подряд без пауз).
// 17.09.2026, Паша: "почему не выполняются квесты асасинов?".
// Разбор: banker и painting стояли done=true в state.json, поэтому обе ветки пропускались
// молча - но игра ПРИ ЭТОМ держала "Гильдия асассинов: Убить банкира" в меню Q, то есть квест
// не сдан. Флаг встал ложно: progressAssassin*Quest возвращали true, когда цель на клетке не
// появилась ("не нашёл -> похоже, уже сделано"). Тот же отрицательный сигнал даёт гибель в
// гаунтлете (а персонаж сегодня там и погиб), неудачная поездка и чужой блокер. То есть
// "не смог убедиться" записывалось как "сделано", и на весь день.
// Что признак достоверен, видно на сверке: картина сегодня действительно сдана - её в Q нет,
// и флаг совпал; банкир в Q есть - флаг врал. Значит источник истины - меню Q, а не флаги.
// Это тот же вывод, что и по четверговым дейликам: судить о выполненности по своим флагам,
// когда игра показывает своё состояние, нельзя.
const ASSASSIN_GUILD_QUESTS = [
  { key: 'banker', re: /банкир/i, label: 'Гильдия асассинов: банкир', run: (p) => progressAssassinBankerQuest(p) },
  { key: 'painting', re: /картин/i, label: 'Гильдия асассинов: картина', run: (p) => progressAssassinPaintingQuest(p) },
  { key: 'merchant', re: /торгов/i, label: 'Гильдия асассинов: торговец', run: (p) => progressAssassinMerchantQuest(p) },
];

// Паша, 18.09.2026: "квесты асассинов - это прокачка морали в минус. Нам нужны квесты
// Ордена". Было выключено.
// Паша, 21.09.2026: «я вернул в информирование квесты ассасинов, делай их тоже, продадим» - предметы
// (Четки торговца, Старая картина, Часы банкира) продаются игрокам по 50 дин (первая партия ушла Hank).
// Включено по умолчанию; выключить снова: AI_ASSASSIN_QUESTS=0.
const ASSASSIN_QUESTS_ENABLED = process.env.AI_ASSASSIN_QUESTS !== '0';

async function runAssassinGuildQuestsIfAvailable(page) {
  if (!ASSASSIN_QUESTS_ENABLED) return false;
  resetAssassinGuildDayIfNeeded();

  if (!(await resetToQuestMenu(page))) {
    return false;
  }
  // Пауза ОБЯЗАТЕЛЬНА: resetToQuestMenu делает паузу ПЕРЕД открытием меню, а не после, и
  // getBodyText успевал прочитать ещё не отрисованную страницу.
  await pause(page, 700, 1300);
  const qNames = parseQuestNamesFromQMenuText(await getBodyText(page));

  // 17.09.2026, моя же ошибка в первой версии этой правки: пустой список я приравнял к
  // "заданий в меню нет" и пометил ВСЕ ТРИ выполненными на день - хотя runDailyQuests в том
  // же цикле прекрасно видел и банкира, и торговца. Пустое/непрочитанное меню - это третий
  // исход ("не смог убедиться"), и решать по нему нельзя ни в одну сторону. Ровно то правило,
  // которое нарушала прежняя версия с "не нашёл цель -> значит сделано".
  if (qNames.length === 0) {
    console.log('Гильдия асассинов: меню Q не прочиталось (пустой список) -> ничего не решаю, вернусь в следующем цикле.');
    return false;
  }

  // ВНИМАНИЕ: классы w и b в регулярках JavaScript - ТОЛЬКО ASCII, кириллицу они не
  // покрывают. Первая версия этого фильтра требовала после фрагмента гильди пробел, а в
  // слове Гильдия там стоит я - и фильтр не совпадал НИКОГДА. Замер: проверка класса w на
  // букве я даёт false, фильтр дал 0 совпадений из 8 реальных имён меню Q.
  // Последствие оказалось хуже исходного бага: guildNames выходил пустым, все три задания
  // объявлялись отсутствующими в Q и помечались выполненными на день - дважды подряд,
  // затирая ручную починку флагов в state.json. Кириллицу в регулярках описывать явно.
  const guildNames = qNames.filter((n) => /асассин/i.test(n));

  for (const quest of ASSASSIN_GUILD_QUESTS) {
    const inMenu = guildNames.some((n) => quest.re.test(n));

    if (!inMenu) {
      // Игра больше не предлагает это задание - значит на сегодня оно закрыто. Это
      // ЕДИНСТВЕННЫЙ признак, по которому мы имеем право пометить квест сделанным.
      if (!assassinGuildDoneToday[quest.key]) {
        assassinGuildDoneToday[quest.key] = true;
        persistDailyQuestState();
        console.log(`${quest.label}: в меню Q его нет -> на сегодня закрыт.`);
      }
      continue;
    }

    // Квест висит в меню - значит он НЕ сдан, что бы ни говорил наш флаг. Чиним флаг.
    if (assassinGuildDoneToday[quest.key]) {
      console.log(`${quest.label}: флаг говорил "сделано", но квест висит в Q -> флаг был ложным, пробую заново.`);
      assassinGuildDoneToday[quest.key] = false;
      persistDailyQuestState();
    }

    // У торговца остаётся лимит попыток: он может просто не стоять сейчас на клетке, и
    // бесконечно ездить к нему бессмысленно. Это ограничение по МИРУ, а не по выполненности.
    if (quest.key === 'merchant') {
      if (S.assassinMerchantAttemptsToday >= ASSASSIN_MERCHANT_MAX_ATTEMPTS_PER_DAY) {
        console.log(`${quest.label}: дневной лимит попыток исчерпан (${S.assassinMerchantAttemptsToday}/${ASSASSIN_MERCHANT_MAX_ATTEMPTS_PER_DAY}) - цель могла не появиться на клетке.`);
        continue;
      }
      S.assassinMerchantAttemptsToday += 1;
      persistDailyQuestState();
    }

    const ok = await runQuestStepSafe(page, quest.label, () => quest.run(page));
    if (ok) {
      return true;
    }
  }

  return false;
}
