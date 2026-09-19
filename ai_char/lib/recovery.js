// Восстановление: fastway-переходы, лечебная экипировка/эликсиры, эли, Последний дом, чтение статов на локации.
// Выделено из ai_char/module.js (там только сборка экспорта). Изменяемое состояние - S из ./state.

// Экспорт стоит ДО require: файлы lib/ вызывают друг друга по кругу, а объявления функций
// всплывают (hoisting), поэтому к моменту любого встречного require все функции уже здесь.
module.exports = {
  navigateFastway, goToStoneguardViaFastway, goToCityViaFastway, recoverToCity,
  scheduleLongRestMinutes, isOutfitSlotEmpty, ensureHealingGearEquipped, tryUseHealingElixir,
  equipNextHealingElixir, normalizeItemName, tryDrinkBuffAle, ensureBuffAlesActive,
  isAnyBuffAleActive, tryDrinkFestiveAle, useRecovery, goToChaosByAmulet, clickHealingRefreshLink,
  runLastHouseRecovery, getStatsFromPage, goToLocationAndReadStats,
};

const { S, BLAKE_MIN_HP, LAST_HOUSE_HP_THRESHOLD } = require('./state');
const {
  appendDebugSnapshot, fixedPause, getBodyText, mergeStatsPreferExisting, parseStats, pause,
} = require('./core');
const { canRunFishingNow } = require('./daily_quests');
const { fightLoop } = require('./fight');
const { runFishingViaLastPortalOrRoute } = require('./fishing');
const { handleIncomingAttackIfAny } = require('./pvp');
const { clickByTexts, performStep } = require('./ui');

const STONEGUARD_FASTWAY_URL = 'http://lbast.ru/location.php?r=6174&mod=fastway&lway=2';
const CITY_FASTWAY_URL = 'http://lbast.ru/location.php?r=7900&mod=fastway&lway=2';
// Ссылка "Амулет" в верхнем меню сайта написана с ЛАТИНСКОЙ "A" (U+0041), а не кириллической
// "А" (U+0410) - клик по тексту "Амулет" на этом аккаунте систематически не находит ссылку
// (см. LESSONS_AI_CHAR.md, "Технические баги"). Обходной путь везде, где раньше кликали
// Амулет -> конкретное направление: переходить прямо по URL mod=fastway&lway=N.
const CHAOS_FASTWAY_URL = 'http://lbast.ru/location.php?mod=fastway&lway=4'; // Кулак Хаоса

// DEVTOWN_FASTWAY_URL: определено в lib/state.js (константа нужна нескольким файлам).

async function navigateFastway(page, url, label) {
  try {
    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });
    console.log(`OK: Fastway -> ${label}`);
    await pause(page, 1000, 2000);
    return true;
  } catch (e) {
    console.log(`Не удалось перейти ${label} через Fastway: ${e.message}`);
    return false;
  }
}

async function goToStoneguardViaFastway(page, label = 'Стоунгард') {
  return navigateFastway(page, STONEGUARD_FASTWAY_URL, label);
}

async function goToCityViaFastway(page, label = 'city_fastway') {
  return navigateFastway(page, CITY_FASTWAY_URL, label);
}

async function recoverToCity(page, reason) {
  console.log(`Recover to city (${reason})`);

  const ok = await goToCityViaFastway(page, 'city_fastway_recovery');
  if (ok) {
    return true;
  }

  try {
    await page.goto(CITY_FASTWAY_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await pause(page, 800, 1600);
    return true;
  } catch (e) {
    return false;
  }
}

function scheduleLongRestMinutes(minutes, reason) {
  S.nextCycleDelayOverrideMs = minutes * 60 * 1000;
  console.log(`Long rest scheduled: ${minutes} min (${reason})`);
}

// "Эликсир лечения (HP+40)" (oid=1005), экипированный в подсумок (inv.php?mod=put_on),
// появляется в бою через кнопку "Пояс" (arena_go.php?poyas=1) как ссылка
// "Использовать Эликсир лечения (HP+40)" (arena_go.php?poyas=1&zapoyasom=1005).
// Найдено и подтверждено вживую 14.09.2026 после подсказки Паши про квест "Дерево жизни".
const HEALING_ELIXIR_ITEM_ID = '1005';

// HEALING_ELIXIR_HP_FRACTION: определено в lib/state.js (константа нужна нескольким файлам).

// 15.09.2026, Паша: "не забывай сам одевать" - после респека статов (Снять все -> сброс)
// консьюмерские слоты (Пояс/Подсумок) остаются пустыми, если их явно не переэкипировать -
// раньше это делалось вручную (то Пашей, то диагностическим скриптом), и не всегда
// вспоминали сразу. Периодическая самопроверка вместо того, чтобы полагаться на то, что
// кто-то заметит пустой слот: если Пояс или Подсумок пустует, ищем в инвентаре (invMod=3,
// с обходом всех cpage=) строку "Оберег воина"/"Эликсир лечения" с "Экипировать" и жмём.
// Никогда не трогает слот, если там уже что-то есть - только заполняет пустые.
const HEALING_SLOT_ITEM_NAMES = ['Оберег воина', 'Эликсир лечения'];

function isOutfitSlotEmpty(outfitText, slotLabel) {
  const lines = outfitText.split('\n').map((l) => l.trim());
  const line = lines.find((l) => l.startsWith(`${slotLabel}:`));
  if (!line) return false; // slot not found on page at all - don't guess
  const rest = line.slice(slotLabel.length + 1).trim();
  return rest.length === 0;
}

async function ensureHealingGearEquipped(page) {
  await page.goto('http://lbast.ru/inv.php?mod=outfit', { waitUntil: 'domcontentloaded', timeout: 60000 });
  const outfitText = await getBodyText(page);
  const beltEmpty = isOutfitSlotEmpty(outfitText, 'Пояс');
  const pouchEmpty = isOutfitSlotEmpty(outfitText, 'Подсумок');
  if (!beltEmpty && !pouchEmpty) return false;

  let equippedSomething = false;
  for (let cpage = 1; cpage <= 5; cpage++) {
    const url = cpage === 1
      ? 'http://lbast.ru/inv.php?invMod=3'
      : `http://lbast.ru/inv.php?invMod=3&cpage=${cpage}`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    const hrefs = await page.evaluate((names) => {
      const rows = Array.from(document.querySelectorAll('a'));
      const found = [];
      for (const a of rows) {
        if (a.textContent && a.textContent.trim() === 'Экипировать') {
          const row = a.closest('tr') || a.parentElement;
          const rowText = row ? row.textContent : '';
          if (names.some((n) => rowText.includes(n))) {
            found.push(a.getAttribute('href'));
          }
        }
      }
      return found;
    }, HEALING_SLOT_ITEM_NAMES).catch(() => []);

    if (hrefs.length === 0) continue;
    for (const href of hrefs) {
      const fullUrl = href.startsWith('http') ? href : `http://lbast.ru/${href.replace(/^\//, '')}`;
      await page.goto(fullUrl, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
      console.log('ensureHealingGearEquipped: экипировал предмет ->', fullUrl);
      equippedSomething = true;
      await pause(page, 500, 900);
    }
    // Re-check whether both slots are now filled before scanning more pages.
    await page.goto('http://lbast.ru/inv.php?mod=outfit', { waitUntil: 'domcontentloaded', timeout: 60000 });
    const recheck = await getBodyText(page);
    if (!isOutfitSlotEmpty(recheck, 'Пояс') && !isOutfitSlotEmpty(recheck, 'Подсумок')) break;
  }
  return equippedSomething;
}

// 15.09.2026, живой баг: когда эликсиров в инвентаре больше нет, эта страница отвечает
// "Предмет не найден!" (обычный 200 OK, не сетевая ошибка - try/catch её не ловит) и НЕ
// возвращает в бой - ни "Ударить", ни "В бой", ни "Сбросить пары" на ней нет. Раньше
// функция считала это успехом (`return true`), fightLoop продолжал ждать боевую кнопку и
// зависал на 10 итераций (`fight_not_reached`), оставляя location.php потом застрявшим на
// голом "В бой!" на много циклов подряд. Теперь проверяем текст ответа явно.
async function tryUseHealingElixir(page) {
  try {
    await page.goto(`http://lbast.ru/arena_go.php?poyas=1&zapoyasom=${HEALING_ELIXIR_ITEM_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });
    const text = await getBodyText(page);
    if (/Предмет не найден/i.test(text)) {
      console.log('Эликсир лечения: закончился в инвентаре ("Предмет не найден!") -> возвращаюсь в бой без лечения.');
      // Эта страница - тупик (нет ни "Ударить", ни "В бой"), нужно вернуться на сам бой.
      await page.goBack({ waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
      return false;
    }
    console.log('Used Эликсир лечения (HP+40) mid-fight.');
    return true;
  } catch (e) {
    return false;
  }
}

// Надеть следующий эликсир СРАЗУ ПОСЛЕ использования. Паша, 17.09.2026: "пояс не пустой
// потому что я экипировал. А ты сделай автоэкипировку после использования".
// Дыра была в моменте: ensureHealingGearEquipped вызывается раз в цикл, в самом его начале,
// то есть уже ПОСЛЕ боя. Использовав эликсир в бою, персонаж оставался с пустым подсумком до
// конца боя - хотя в инвентаре лежали ещё две штуки. Чинить надо там, где слот пустеет.
// Берём предмет из Избранного: Паша завёл его туда специально ("в инвентаре в избранное внёс,
// как зайдёшь - кликнешь на предмет и он оденется"), и ссылка там сразу ведёт на mod=put_on,
// без обхода страниц invMod=3 с их постраничностью.
// ВАЖНО: перед уходом в инвентарь запоминаем URL боя и возвращаемся на него, иначе бой
// останется висеть (см. LESSONS: читающая функция обязана вернуть страницу обратно).
async function equipNextHealingElixir(page) {
  const backUrl = page.url();
  try {
    await page.goto('http://lbast.ru/inv.php?mod=starred', { waitUntil: 'domcontentloaded', timeout: 60000 });
    const href = await page.evaluate(() => {
      const a = Array.from(document.querySelectorAll('a')).find(
        (x) => (x.getAttribute('href') || '').includes('mod=put_on')
          && /Эликсир лечения/i.test(x.textContent || ''),
      );
      return a ? a.getAttribute('href') : null;
    });
    if (!href) {
      console.log('Эликсир лечения: в Избранном надеть нечего (закончились?).');
      return false;
    }
    await page.goto(`http://lbast.ru/${href.replace(/^\//, '')}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    console.log('Эликсир лечения: надел следующий из Избранного.');
    return true;
  } catch (e) {
    console.log('equipNextHealingElixir error:', e.message);
    return false;
  } finally {
    await page.goto(backUrl, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  }
}

// Временные усилители из инвентаря (не боевые предметы, расходники) - дают бафф к статам
// на ограниченное время, статус виден в pers.php как "<название> ещё N мин." (подтверждено
// live 15-16.09.2026: "Состояние AI__: вырви глаз" уже был виден на боевом экране, значит
// эль вырви глаз кем-то использовался раньше и статус-текст в этом формате реален).
// 16.09.2026, Паша: "в игре есть усилители временные... праздничный эль и эль вырви глаз,
// можешь использовать их через инвентарь - усиляют на разное время, но будет проще бить
// ботов" - обобщили однократную функцию под Праздничный эль (была только для Штолен,
// 14.09.2026) на список из обоих элей, вызывается перед началом фарм-сессии (не в каждом
// бою - бафф держится долго, повторное использование при уже активном статусе - трата
// расходника впустую).
// 17.09.2026, живой баг: код искал эль в инвентаре ТОЧНЫМ сравнением строк и потому никогда
// его не находил ("Эль вырви глаз: не найден в инвентаре (закончился?)" в каждом запуске), хотя
// эль лежал на месте - реальное имя предмета в инвентаре пишется с кавычками и заглавной буквой:
// Эль "Вырви глаз". Сравниваем нормализованно (без кавычек, регистра и лишних пробелов).
function normalizeItemName(s) {
  return String(s || '').replace(/[«»"'`]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

const BUFF_ALE_ITEM_NAMES = ['Праздничный эль', 'Эль "Вырви глаз"'];

async function tryDrinkBuffAle(page, aleName) {
  const currentUrl = page.url();
  try {
    await page.goto('http://lbast.ru/pers.php', { waitUntil: 'domcontentloaded', timeout: 60000 });
    const persText = await getBodyText(page);
    // "Праздничный эль" -> "праздничный эль", Эль "Вырви глаз" -> "вырви глаз" (статус в
    // pers.php использует короткое имя эффекта, не полное название предмета; кавычки из
    // названия предмета в статусе не встречаются - снимаем их нормализацией).
    const statusName = normalizeItemName(aleName).replace(/^эль\s+/, '');
    if (new RegExp(`${statusName}\\s+ещ[её]`, 'i').test(persText)) {
      console.log(`${aleName}: уже активен, повторно не пьём.`);
      await page.goto(currentUrl, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
      return false;
    }

    await page.goto('http://lbast.ru/inv.php', { waitUntil: 'domcontentloaded', timeout: 60000 });
    const links = await page.locator('a').evaluateAll((els) =>
      els.map((e) => ({ t: e.textContent.trim(), href: e.getAttribute('href') })).filter((x) => x.t)
    );
    const idx = links.findIndex((l) => normalizeItemName(l.t) === normalizeItemName(aleName));
    if (idx === -1) {
      console.log(`${aleName}: не найден в инвентаре (закончился?).`);
      await page.goto(currentUrl, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
      return false;
    }
    const useLink = links.slice(idx, idx + 4).find((l) => l.t === 'Использовать');
    if (!useLink) {
      console.log(`${aleName}: не нашёл кнопку "Использовать" рядом с элем.`);
      await page.goto(currentUrl, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
      return false;
    }
    const useUrl = useLink.href.startsWith('http') ? useLink.href : 'http://lbast.ru/' + useLink.href.replace(/^\//, '');
    await page.goto(useUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    console.log(`Выпит ${aleName}.`);
    await page.goto(currentUrl, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    return true;
  } catch (e) {
    console.log(`tryDrinkBuffAle(${aleName}) error:`, e.message);
    await page.goto(currentUrl, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    return false;
  }
}

// Обходит оба эля раз за вызов - используется на старте фарм-сессии, не в каждом бою.
async function ensureBuffAlesActive(page) {
  let usedAny = false;
  for (const aleName of BUFF_ALE_ITEM_NAMES) {
    const used = await tryDrinkBuffAle(page, aleName);
    if (used) usedAny = true;
    await pause(page, 500, 1000);
  }
  return usedAny;
}

// HP_FLOOR_WITH_BUFF: определено в lib/state.js (константа нужна нескольким файлам).

async function isAnyBuffAleActive(page) {
  const currentUrl = page.url();
  try {
    await page.goto('http://lbast.ru/pers.php', { waitUntil: 'domcontentloaded', timeout: 60000 });
    const text = await getBodyText(page);
    const active = BUFF_ALE_ITEM_NAMES.some((aleName) => {
      const statusName = normalizeItemName(aleName).replace(/^эль\s+/, '');
      return new RegExp(`${statusName}\\s+ещ[её]`, 'i').test(text);
    });
    await page.goto(currentUrl, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    return active;
  } catch (e) {
    await page.goto(currentUrl, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    return false;
  }
}

// Обратная совместимость с существующим вызовом для Штолен (не трогаем этот путь).
async function tryDrinkFestiveAle(page) {
  return tryDrinkBuffAle(page, 'Праздничный эль');
}

async function useRecovery(page) {
  const success = await goToStoneguardViaFastway(page, 'Стоунгард (восстановление)');
  if (!success) {
    console.log('Не удалось попасть в Стоунгард через Fastway, вернусь на главную страницу.');
  }
}

async function goToChaosByAmulet(page) {
  // \u041a\u043b\u0438\u043a \u043f\u043e \u0442\u0435\u043a\u0441\u0442\u0443 "\u0410\u043c\u0443\u043b\u0435\u0442" \u0441\u0438\u0441\u0442\u0435\u043c\u0430\u0442\u0438\u0447\u0435\u0441\u043a\u0438 \u043d\u0435 \u043d\u0430\u0445\u043e\u0434\u0438\u0442 \u0441\u0441\u044b\u043b\u043a\u0443 (\u0441\u043c. CHAOS_FASTWAY_URL \u043a\u043e\u043c\u043c\u0435\u043d\u0442\u0430\u0440\u0438\u0439
  // \u0432\u044b\u0448\u0435) - \u043f\u0435\u0440\u0435\u0445\u043e\u0434\u0438\u043c \u043f\u0440\u044f\u043c\u043e \u043f\u043e fastway URL, \u043c\u0438\u043d\u0443\u044f \u0441\u0430\u043c\u0443 \u0441\u0441\u044b\u043b\u043a\u0443 "\u0410\u043c\u0443\u043b\u0435\u0442" \u0438 \u043f\u043e\u0434\u043c\u0435\u043d\u044e \u0446\u0435\u043b\u0438\u043a\u043e\u043c.
  await navigateFastway(page, CHAOS_FASTWAY_URL, '\u041a\u0443\u043b\u0430\u043a \u0425\u0430\u043e\u0441\u0430');
}

// The number in "Лечение: N hp/мин" is itself a link that refreshes HP/cooldown; its text
// changes every time, so we find it by walking to the nearest <a> on the same line as "Лечение".
async function clickHealingRefreshLink(page) {
  const links = page.locator('a');
  const total = await links.count().catch(() => 0);

  for (let i = 0; i < total; i++) {
    const link = links.nth(i);

    const lineText = await link.evaluate((el) => {
      const normalize = (s) => String(s || '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();

      let text = '';
      let cur = el.previousSibling;
      while (cur) {
        if (cur.nodeName === 'BR') break;
        text = (cur.textContent || '') + text;
        cur = cur.previousSibling;
      }
      cur = el.nextSibling;
      while (cur) {
        if (cur.nodeName === 'BR') break;
        text = text + (cur.textContent || '');
        cur = cur.nextSibling;
      }
      return normalize(text);
    }).catch(() => '');

    if (/Лечение/i.test(lineText)) {
      try {
        await link.click({ timeout: 8000, noWaitAfter: true });
        console.log('OK: обновил HP/кулдаун по ссылке "Лечение"');
        await pause(page, 800, 1600);
        return true;
      } catch (e) {
        console.log(`Не удалось кликнуть по ссылке "Лечение": ${e.message}`);
      }
    }
  }

  console.log('Ссылка "Лечение" не найдена, читаю статы как есть');
  return false;
}

const LAST_HOUSE_MAX_ITERATIONS = 200;

async function runLastHouseRecovery(page) {
  console.log('Последний дом: HP критично низкое, иду восстанавливаться (Форпост -> Последний дом)');

  const OUTPOST = 'Форпост';
  const LAST_HOUSE = 'Последний дом';
  const V_IGRU = 'В игру';

  const STATIONS = [
    'Исп. кухню',
    'Исп. самогонный аппарат',
    'Исп. набор травника',
  ];

  // Station cooldowns are long (20-25 min) but fishing's own cooldown is only 2 min. Sleeping the
  // full station wait in one blocking call would starve fishing of almost all its opportunities
  // during a long recovery (observed: ~5 casts across ~110 min instead of ~50) since the loop only
  // re-checks canRunFishingNow() once per iteration. Sleep in short chunks and bail out early the
  // moment fishing becomes available again, so the loop returns to it promptly instead of waiting
  // out the whole station cooldown first.
  async function waitStationCooldown(waitMinutes, reason) {
    console.log(`Последний дом: ${reason}, жду ${waitMinutes} мин (проверяю рыбалку каждые ~2 мин)`);
    const totalMs = waitMinutes * 60 * 1000;
    const chunkMs = 2 * 60 * 1000;
    let waited = 0;
    while (waited < totalMs) {
      const step = Math.min(chunkMs, totalMs - waited);
      await fixedPause(page, step);
      waited += step;
      if (canRunFishingNow()) {
        console.log('Последний дом: рыбалка снова доступна -> прерываю ожидание кулдауна станции');
        return;
      }
    }
  }

  async function enterLastHouse() {
    await performStep(page, {
      stepName: OUTPOST,
      currentTexts: [OUTPOST, OUTPOST.toLowerCase()],
      nextTexts: [LAST_HOUSE, LAST_HOUSE.toLowerCase()],
      retries: 3,
    });

    await performStep(page, {
      stepName: LAST_HOUSE,
      currentTexts: [LAST_HOUSE, LAST_HOUSE.toLowerCase()],
      retries: 3,
    });
  }

  await enterLastHouse();

  let stationIndex = 0;

  for (let i = 0; i < LAST_HOUSE_MAX_ITERATIONS; i++) {
    await clickHealingRefreshLink(page);
    let stats = parseStats(await getBodyText(page));

    if (typeof stats.hpCurrent === 'number' && stats.hpCurrent >= BLAKE_MIN_HP) {
      console.log(`Последний дом: HP восстановлено до ${stats.hpCurrent} (>= ${BLAKE_MIN_HP}) -> выхожу`);
      break;
    }

    // Combine station use with fishing: whenever fishing is due (daily catches left, 2-minute
    // cooldown elapsed), take that detour instead of a station, then jump to Кулак хаоса
    // (fastest heal) and come back to the Последний дом station rotation.
    if (canRunFishingNow()) {
      console.log('Последний дом: пробую совместить с рыбалкой');
      await runFishingViaLastPortalOrRoute(page);
      await enterLastHouse();
      continue;
    }

    const stationText = STATIONS[stationIndex % STATIONS.length];
    const used = await clickByTexts(page, [stationText, stationText.toLowerCase()], stationText);

    if (!used) {
      console.log(`Последний дом: не удалось использовать "${stationText}", жду и пробую снова`);
      await pause(page, 2000, 4000);
      continue;
    }

    stationIndex += 1;
    await pause(page, 800, 1600);

    await clickByTexts(page, ['Назад', 'назад'], 'Назад');
    await pause(page, 800, 1600);

    await clickHealingRefreshLink(page);
    const afterStats = parseStats(await getBodyText(page));
    const cooldown = typeof afterStats.cooldown === 'number' ? afterStats.cooldown : afterStats.reserveMinutes;

    if (typeof cooldown === 'number' && cooldown < 0) {
      // The cooldown value itself isn't a reliable minutes-to-wait figure (it doesn't regen
      // 1:1 per minute) — just wait a fixed 20-25 min, same as the "unparseable" fallback below.
      const waitMinutes = 20 + Math.floor(Math.random() * 6);
      await waitStationCooldown(waitMinutes, `кулдаун ушёл в минус (${cooldown})`);
    } else if (typeof cooldown !== 'number') {
      // Couldn't read the cooldown at all (e.g. header format didn't match) — rather than hammer
      // the loop with instant retries, back off a fixed 20-25 min like a normal cooldown wait.
      const waitMinutes = 20 + Math.floor(Math.random() * 6);
      await waitStationCooldown(waitMinutes, 'не удалось прочитать кулдаун');
    }
  }

  const returned = await clickByTexts(page, [V_IGRU, V_IGRU.toLowerCase()], V_IGRU);
  if (returned) {
    await pause(page, 800, 1600);
  } else {
    console.log('Последний дом: кнопка "В игру" не найдена, возвращаюсь через Стоунгард');
    await useRecovery(page);
  }
}

async function getStatsFromPage(page, label, providedText = null) {
  const text = providedText || await getBodyText(page);
  const stats = parseStats(text);
  console.log(`${label}:`, stats);
  return { text, stats };
}

async function goToLocationAndReadStats(page, label) {
  await page.goto('http://lbast.ru/location.php', {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  await pause(page, 1000, 2000);

  let text = await getBodyText(page);
  let attackHandled = await handleIncomingAttackIfAny(page, text);
  if (attackHandled) {
    return { text, stats: null, attackHandled: true };
  }

  // Death / critically low HP pages can show negative HP like "(-15705/2950)" and break stat parsing.
  // Recover immediately by moving to Chaos/Stoneguard and then re-reading stats.
  const negHpMatch = text.match(/\((-?\d+)\s*\/\s*(\d+)\)/);
  const negHpValue = negHpMatch ? Number(negHpMatch[1]) : null;
  const isNegativeHp = Number.isFinite(negHpValue) && negHpValue < 0;
  if (isNegativeHp || /Восстановите здоровье/i.test(text)) {
    const why = isNegativeHp ? `negative_hp:${negHpValue}` : 'restore_health_prompt';
    console.log(`Detected death/critical state on location.php (${why}) -> trying Chaos recovery`);
    try {
      await goToChaosByAmulet(page);
      await pause(page, 1000, 2000);
    } catch (e) {
      console.log('Chaos recovery failed: ' + e.message);
    }

    await page.goto('http://lbast.ru/location.php', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await pause(page, 1000, 2000);
    text = await getBodyText(page);
    attackHandled = await handleIncomingAttackIfAny(page, text);
    if (attackHandled) {
      return { text, stats: null, attackHandled: true };
    }

    // If HP is still critically negative after the quick Chaos Fist, do a full recovery
    // at Форпост/Последний дом instead of just sleeping it off.
    const postNeg = text.match(/\((-?\d+)\s*\/\s*(\d+)\)/);
    const postNegValue = postNeg ? Number(postNeg[1]) : null;
    if (Number.isFinite(postNegValue) && postNegValue < LAST_HOUSE_HP_THRESHOLD) {
      console.log(`HP still critical after Chaos (${postNegValue}) -> Форпост/Последний дом`);
      await runLastHouseRecovery(page);
      await page.goto('http://lbast.ru/location.php', { waitUntil: 'domcontentloaded', timeout: 60000 });
      await pause(page, 1000, 2000);
      text = await getBodyText(page);
      attackHandled = await handleIncomingAttackIfAny(page, text);
      if (attackHandled) {
        return { text, stats: null, attackHandled: true };
      }
    }
  }

  let read = await getStatsFromPage(page, label, text);

  // lbast can occasionally return a partial/transient page where stats are not present.
  // Retry once before failing the cycle.
  if (read?.stats?.hpCurrent === null || read?.stats?.cooldown === null) {
    // If we are on a fight screen, try to finish the fight and re-read stats.
    if (/\\bВ\\s+бой\\b|\\bВ\\s+бой!\\b|Ударить|Бой\\s+завершен!/i.test(text)) {
      try {
        await fightLoop(page);
        await pause(page, 800, 1600);
        text = await getBodyText(page);
        read = await getStatsFromPage(page, `${label} (post-fight)`, text);
        if (read?.stats?.hpCurrent !== null && read?.stats?.cooldown !== null) {
          return { ...read, attackHandled: false };
        }
      } catch (e) {
        // Fall back to the standard retry flow below.
      }
    }

    // Some pages no longer display cooldown/reserve in the header (e.g. "Tsunami (2759/2870) Q9 D7").
    // Fill missing cooldown via pers.php and return back to location.php.
    if (read?.stats?.cooldown === null) {
      try {
        console.log('Cooldown missing on location.php -> trying pers.php fallback');
        await pause(page, 500, 1200);
        await page.goto('http://lbast.ru/pers.php', { waitUntil: 'domcontentloaded', timeout: 60000 });
        await pause(page, 800, 1600);

        const persText = await getBodyText(page);
        const persRead = await getStatsFromPage(page, `${label} (pers.php)`, persText);

        const mergedStats = mergeStatsPreferExisting(read.stats, persRead.stats);

        await pause(page, 500, 1200);
        await page.goto('http://lbast.ru/location.php', { waitUntil: 'domcontentloaded', timeout: 60000 });
        await pause(page, 1000, 2000);

        text = await getBodyText(page);
        attackHandled = await handleIncomingAttackIfAny(page, text);
        if (attackHandled) {
          return { text, stats: null, attackHandled: true };
        }

        if (mergedStats?.hpCurrent !== null && mergedStats?.cooldown !== null) {
          return { text, stats: mergedStats, attackHandled: false };
        }

        // If fallback did not help, keep going with the legacy retry flow below.
        read = { text, stats: mergedStats };
      } catch (e) {
        if (/^hp_big_negative/.test(String(e?.message || ''))) throw e;
        console.log('pers.php fallback failed: ' + e.message);
        // Continue with the legacy retry flow below.
      }
    }

    appendDebugSnapshot('Stats parse failed (pre-retry)', { label, url: page.url(), text });
    console.log('Stats parse failed -> retry location.php once');
    await pause(page, 800, 1600);
    await page.goto('http://lbast.ru/location.php', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await pause(page, 1000, 2000);

    text = await getBodyText(page);
    attackHandled = await handleIncomingAttackIfAny(page, text);
    if (attackHandled) {
      return { text, stats: null, attackHandled: true };
    }

    read = await getStatsFromPage(page, `${label} (retry)`, text);
    if (read?.stats?.hpCurrent === null || read?.stats?.cooldown === null) {
      appendDebugSnapshot('Stats parse failed (post-retry)', { label: `${label} (retry)`, url: page.url(), text });
    }
  }

  return { ...read, attackHandled: false };
}
