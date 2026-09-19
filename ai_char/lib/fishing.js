// Рыбалка и кухня (жарка рыбы в доме, Кулак Хаоса).
// Выделено из ai_char/module.js (там только сборка экспорта). Изменяемое состояние - S из ./state.

// Экспорт стоит ДО require: файлы lib/ вызывают друг друга по кругу, а объявления функций
// всплывают (hoisting), поэтому к моменту любого встречного require все функции уже здесь.
module.exports = {
  isFishingSpotLocation, goRouteToFishingSpot, leaveFishingResultToGame, fryFishWhileHealing,
  finishFishingBiteWait, castFishingRodAndDetectCatch, runFishingIfDue, runFishingTask,
  runFishingViaLastPortalOrRoute,
};

const { S, FISHING_DAILY_CATCH_LIMIT, persistDailyQuestState } = require('./state');
const { getBodyText, pause, snapshotText, parseStats } = require('./core');
const { canRunFishingNow, syncFishingDayState } = require('./daily_quests');
const { tryPerformStepOptional } = require('./hp');
const { goToChaosByAmulet } = require('./recovery');
const { clickByTexts, performStep } = require('./ui');

// Рыбалка (ловим карасей на кухню для Последнего дома): Конь -> Клановый замок -> В пути ->
// Идти на север -> Рыбачить -> Забросить удочку -> В игру. Первые шаги совпадают со Статуей
// славы вплоть до подтверждения поездки, дальше маршрут расходится.
function isFishingSpotLocation(text) {
  return /Рыбачить/i.test(String(text || ''));
}

// Конь -> Клановый замок -> В пути (7 сек) -> Идти на север -> [Рыбачить видно на странице].
async function goRouteToFishingSpot(page) {
  const HORSE       = 'Конь';
  const CLAN_CASTLE  = 'Клановый замок';
  const V_PUTI       = 'В пути';
  const V_PUTI_E     = 'В пути еще';
  const V_PUTI_Y     = 'В пути ещё';
  const NORTH        = 'Идти на север';
  const FISH_SPOT     = 'Рыбачить';

  await performStep(page, {
    stepName: HORSE,
    currentTexts: [HORSE, HORSE.toLowerCase()],
    nextTexts: [CLAN_CASTLE, CLAN_CASTLE.toLowerCase()],
    retries: 3,
  });

  // После выбора клановый замок нужно 7 сек — затем появляется экран поездки
  // ("В пути"/"В пути еще"), и только после подтверждения — "Идти на север".
  await performStep(page, {
    stepName: CLAN_CASTLE,
    currentTexts: [CLAN_CASTLE, CLAN_CASTLE.toLowerCase()],
    waitAfterClickMs: 7000,
    nextTexts: [
      V_PUTI, V_PUTI.toLowerCase(),
      V_PUTI_E, V_PUTI_E.toLowerCase(),
      V_PUTI_Y, V_PUTI_Y.toLowerCase(),
      NORTH, NORTH.toLowerCase(),
    ],
    retries: 3,
  });

  // Кликаем "В пути" (подтверждение) и ждём до 30 сек пока появится "Идти на север".
  await tryPerformStepOptional(page, {
    stepName: V_PUTI,
    currentTexts: [
      V_PUTI_E, V_PUTI_E.toLowerCase(),
      V_PUTI_Y, V_PUTI_Y.toLowerCase(),
      V_PUTI, V_PUTI.toLowerCase(),
    ],
    nextTexts: [NORTH, NORTH.toLowerCase()],
    waitForNextMs: 30000,
  });

  await performStep(page, {
    stepName: NORTH,
    currentTexts: [NORTH, NORTH.toLowerCase()],
    nextTexts: [FISH_SPOT, FISH_SPOT.toLowerCase()],
    retries: 3,
  });
}

// Post-fishing result screen usually has "В игру", but sometimes the game returns straight to the
// normal location view (Ивовое озеро с навигацией Амулет|Конь), where "В игру" isn't present.
// Click it if there; otherwise we're already back in the game — don't throw. Fall back to location.php.
async function leaveFishingResultToGame(page) {
  const clicked = await clickByTexts(page, ['В игру', 'в игру'], 'В игру (после рыбалки)');
  if (clicked) {
    await pause(page, 800, 1600);
    return;
  }

  const text = await getBodyText(page);
  if (/Амулет/i.test(text) || /Рыбачить/i.test(text)) {
    // Уже на обычной странице локации (есть навигация Амулет / действие Рыбачить) — всё ок.
    return;
  }

  try {
    await page.goto('http://lbast.ru/location.php', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await pause(page, 800, 1600);
  } catch (e) { /* ignore */ }
}

// Assumes we're already at the fishing spot ("Рыбачить" visible). Does NOT navigate away
// afterward — the caller decides where to go next (В игру, or Кулак хаоса during recovery).
// ===================================================================================
// Кухня в доме (Кулак Хаоса). Паша, 19.09.2026: «купил кухню, теперь можешь заходить в свой дом
// и жарить рыбу пока восстанавливаешься, 1 рыба - 10 минут резерва, жарь так чтобы не в ущерб
// фарму». Жареная рыба стоит 48 дин против 2 у сырого карася.
// ВНИМАНИЕ: GET на flag=kuchnya сразу жарит одну рыбу (проверено: «посмотреть» кухню = пожарить).
// Поэтому вызывается только отсюда и только при резерве от FRY_MIN_RESERVE (15).
// ===================================================================================
const HOUSE_ID = 34309;
const KITCHEN_URL = `http://lbast.ru/dom.php?mod=inhouse&dom_id=${HOUSE_ID}&flag=kuchnya`;
const FRY_MIN_RESERVE = Number(process.env.AI_FRY_MIN_RESERVE || 15); // Паша 19.09: 30 - это максимум резерва, жарить от 15

// S.kitchenOutOfFish: объявлено в lib/state.js (всё изменяемое состояние - там).

async function fryFishWhileHealing(page, stats) {
  const reserve = stats && (typeof stats.reserveMinutes === 'number' ? stats.reserveMinutes : stats.cooldown);
  if (typeof reserve !== 'number' || reserve < FRY_MIN_RESERVE) return false;
  if (S.kitchenOutOfFish) return false;
  let fried = false;
  try {
    // В дом пускают только из Форпоста («Вы находитесь не в том месте» с улицы Кулака, 19.09):
    // улица -> «Форпост» (dom.php) -> свой дом -> кухня.
    await page.goto('http://lbast.ru/location.php', { waitUntil: 'domcontentloaded', timeout: 60000 });
    const fortHref = await page.evaluate(() => {
      const a = Array.from(document.querySelectorAll('a')).find((x) => /^Форпост$/i.test((x.innerText || '').trim()));
      return a ? a.getAttribute('href') : null;
    }).catch(() => null);
    if (!fortHref) {
      console.log('Кухня: нет ссылки «Форпост» (не в Кулаке?) -> не жарю.');
      return false;
    }
    await page.goto(`http://lbast.ru/${fortHref.replace(/^\//, '')}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await pause(page, 500, 1000);
    await page.goto(`http://lbast.ru/dom.php?mod=inhouse&dom_id=${HOUSE_ID}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await pause(page, 500, 1000);
    // Паша, 19.09.2026 (скриншот: стоит в Кулаке с резервом 30 и не жарит): жарить подряд, пока
    // резерв не упадёт ниже порога, а не по одной рыбе раз в 2 минуты. Уже внутри дома кухня
    // открывается прямой ссылкой; новый резерв читается из шапки страницы кухни.
    let left = reserve;
    for (let n = 0; n < 3 && left >= FRY_MIN_RESERVE; n++) {
      await page.goto(KITCHEN_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
      const t = await getBodyText(page);
      if (/поджарили/i.test(t)) {
        fried = true;
        const after = parseStats(t);
        const r = typeof after.reserveMinutes === 'number' ? after.reserveMinutes : after.cooldown;
        console.log(`Кухня: поджарил рыбу (резерв был ${left}${typeof r === 'number' ? `, стал ${r}` : ''}).`);
        // Шапка кухни показывает резерв ДО списания (живьём 19.09: 30 -> «стал 30»), поэтому
        // доверяем ей только в меньшую сторону: каждая рыба стоит 10 минут резерва.
        left = typeof r === 'number' ? Math.min(r, left - 10) : left - 10;
        await pause(page, 600, 1200);
      } else if (/жарен\S*\s+рыб[^.]*нужно иметь|нужно иметь в инвентаре (рыб|карас)/i.test(t)) {
        S.kitchenOutOfFish = true;
        console.log('Кухня: сырой рыбы нет -> не жарю до следующего улова.');
        break;
      } else {
        console.log(`Кухня: не получилось: "${snapshotText(t, 200)}"`);
        break;
      }
    }
  } catch (e) {
    console.log('Кухня: ошибка', e.message);
  }
  await page.goto('http://lbast.ru/location.php', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  return fried;
}

// Экран ожидания поклёва: "Подождем еще <nobr id=pbar>N</nobr> сек" + ссылка "Ждать" (go=1).
// Ждём отсчёт и подсекаем; если экран повторился (рано или новый отсчёт) — до 3 раз.
// Живой прогон 18.09.2026: после подсечки бывает ещё экран "Что-то не клюет, но вы же терпеливый
// рыбак, подождем… Ждать" без отсчёта — жмём "Ждать", пока он есть (до 8 раз), без отсчёта ждём 3 с.
async function finishFishingBiteWait(page) {
  // 4, не 8: круг "не клюет" -> отсчёт ~115 с повторяется, 8 кругов держали драйвер 16 минут без
  // улова. Удочка остаётся заброшенной, следующий заход продолжит ожидание (alreadyCast).
  for (let i = 0; i < 4; i++) {
    const text = await getBodyText(page);
    if (/вытаскиваете из воды/i.test(text)) return;
    const mm = text.match(/Подождем еще\s*(\d+)\s*сек/i);
    const waitingScreen = mm || /подсекай|не клюет|подождем/i.test(text);
    if (!waitingScreen) return;
    const secs = mm ? Number(mm[1]) + 1 : 3;
    console.log(`Рыбалка: жду поклёва ${secs} сек, потом "Ждать" (${i + 1}/4).`);
    await page.waitForTimeout(secs * 1000);
    const href = await page.evaluate(() => {
      const a = Array.from(document.querySelectorAll('a')).find((x) => /^Ждать$/i.test((x.innerText || '').trim()));
      return a ? a.getAttribute('href') : null;
    }).catch(() => null);
    if (!href) return;
    await page.goto(`http://lbast.ru/${href.replace(/^\//, '')}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(800);
  }
}

async function castFishingRodAndDetectCatch(page) {
  const FISH_SPOT = 'Рыбачить';
  const CAST = 'Забросить удочку';

  await performStep(page, {
    stepName: FISH_SPOT,
    currentTexts: [FISH_SPOT, FISH_SPOT.toLowerCase()],
    nextTexts: [CAST, CAST.toLowerCase()],
    retries: 3,
  });

  // Дневной лимит рыбы кончился: после "Рыбачить" игра показывает "Похоже, вы выловили всю рыбу,
  // приходите завтра" вместо кнопки "Забросить удочку". Наш счётчик может ещё показывать <6 (лимит
  // считается на сервере), поэтому выставляем его в лимит, чтобы canRunFishingNow больше не гонял
  // на рыбалку, и выходим чисто — без ошибки и общего бэкоффа "Retry after N min".
  // 18.09.2026: экран рыбалки иногда приходит почти пустым (одно время) и дорисовывается позже —
  // ждём до 8 с, пока появится одно из известных состояний, иначе performStep перезагрузит
  // location.php и потеряет экран.
  let afterRodText = await getBodyText(page);
  for (let i = 0; i < 16 && !/Забросить удочку|Ждать|выловили\s+всю\s+рыбу/i.test(afterRodText); i++) {
    await page.waitForTimeout(500);
    afterRodText = await getBodyText(page);
  }
  if (/выловили\s+всю\s+рыбу/i.test(afterRodText)) {
    console.log('Рыбалка: на сегодня рыба закончилась ("выловили всю рыбу") -> отмечаю лимит и выхожу');
    syncFishingDayState();
    S.fishingCatchesToday = FISHING_DAILY_CATCH_LIMIT;
    S.lastFishingAttemptAt = Date.now();
    persistDailyQuestState();
    await leaveFishingResultToGame(page);
    return false;
  }

  // Удочка уже заброшена (прошлый заход ушёл, не дождавшись) — сразу к ожиданию поклёва.
  const alreadyCast = !/Забросить удочку/i.test(afterRodText) && /Подождем еще|Ждать/.test(afterRodText);
  if (!alreadyCast) {
    await performStep(page, {
      stepName: CAST,
      currentTexts: [CAST, CAST.toLowerCase()],
      nextTexts: [],
      retries: 3,
      skipIfNextVisible: false,
    });
  }

  // 18.09.2026, разобрано по сохранённому HTML: после заброса игра показывает "Подождем еще
  // <N> сек, авось клюнет" с отсчётом (по нулю -> "подсекай!") и ссылку "Ждать" (go=1) — это и
  // есть подсечка. Ждём N+1 сек и жмём "Ждать". Раньше код сразу читал этот экран, находил в
  // шутке под ним слово "карасей" и засчитывал улов, которого не было.
  await finishFishingBiteWait(page);

  // Confirmed real success text: "...Вы с легким усилием вытаскиваете из воды карася! Далее".
  const resultText = await getBodyText(page);
  // Не просто "карас" где угодно: экран ожидания показывает шутку "— Карасей ловил", что дало бы
  // ложный улов. Засчитываем только фразу вытаскивания рыбы.
  const caught = /вытаскиваете из воды/i.test(resultText);

  S.lastFishingAttemptAt = Date.now();

  if (caught) {
    syncFishingDayState();
    S.fishingCatchesToday += 1;
    S.kitchenOutOfFish = false; // есть свежий карась - кухне снова есть что жарить
    persistDailyQuestState();
    console.log(`Рыбалка: поймали карася (${S.fishingCatchesToday}/${FISHING_DAILY_CATCH_LIMIT} today)`);
  } else {
    // Текст результата в лог: проверка улова стала строгой ("вытаскиваете из воды"), и если игра
    // пишет улов иначе, это должно быть видно, а не молча считаться промахом.
    console.log(`Рыбалка: не повезло в этот раз ("${snapshotText(resultText, 200)}")`);
  }

  // The result (catch or miss) is usually a separate confirmation screen with "В игру", but the
  // game sometimes drops us straight back to the location view (no "В игру"). Handle both cleanly.
  await leaveFishingResultToGame(page);

  return caught;
}

// Used between quests: full route there, fish once, return to the city.
// castFishingRodAndDetectCatch already clicks "В игру" at the end, landing back on the main
// location page.
// 18.09.2026, Паша: "первым в дом купим кухню... там можно будет жарить рыбу и продавать,
// можешь включить рыбалку". Маршрут и счётчики рыбалки жили только в doScenario (коде
// Tsunami), а драйвер AI__ его не вызывает - рыбалка у AI__ не шла ни разу. Эта обёртка
// сама проверяет дневной лимит (6 карасей) и кулдаун (2 мин).
async function runFishingIfDue(page) {
  if (!canRunFishingNow()) return false;
  await runFishingTask(page);
  return true;
}
async function runFishingTask(page) {
  console.log('Рыбалка: начинаю маршрут Конь -> Клановый замок -> В пути -> Идти на север -> Рыбачить -> Забросить удочку -> В игру');

  await goRouteToFishingSpot(page);
  await castFishingRodAndDetectCatch(page);
}

// Used during critical-HP recovery (Последний дом): try the "Последний портал" shortcut first
// (same pattern as goblins — if it lands at the fishing spot, great; otherwise the full manual
// route). After fishing, jump to Кулак хаоса (fastest heal) instead of returning to the city.
async function runFishingViaLastPortalOrRoute(page) {
  console.log('Рыбалка (во время восстановления): пробую Последний портал');

  const AMULET = 'Амулет';
  const LAST_PORTAL = 'Последний портал';

  const amuletOk = await clickByTexts(page, [AMULET, AMULET.toLowerCase()], AMULET);
  if (amuletOk) {
    await pause(page, 800, 2000);
    const portalOk = await clickByTexts(page, [LAST_PORTAL, LAST_PORTAL.toLowerCase()], LAST_PORTAL);
    if (portalOk) {
      await pause(page, 800, 2000);
      const afterPortalText = await getBodyText(page);
      if (isFishingSpotLocation(afterPortalText)) {
        await castFishingRodAndDetectCatch(page);
        await goToChaosByAmulet(page);
        return;
      }
      console.log('Fishing last portal did not reach the fishing spot -> routing manually.');
    } else {
      await clickByTexts(page, ['Вернуться', 'вернуться'], 'Вернуться');
      await pause(page, 800, 1600);
    }
  }

  // Fallback: manual route.
  await page.goto('http://lbast.ru/location.php', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await pause(page, 1000, 2000);
  await goRouteToFishingSpot(page);
  await castFishingRodAndDetectCatch(page);
  await goToChaosByAmulet(page);
}
