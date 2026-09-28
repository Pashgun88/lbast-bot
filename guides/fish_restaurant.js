// «Рыбный ресторан» (Гретхис, тёща Кумуса) — ежедневный квест форта «Жженый лист».
//
// Почему JS, а не *.steps: маршрут не один. У квеста 27 наград, у каждой свой путь кликов, а что
// сегодня можно выбить — видно только в [Журнал наград] ВНУТРИ взятого задания. Значит ветку
// выбирает не автор файла, а сам прогон: прочитать журнал -> найти награду в таблице -> идти.
//
// Гайд: Dikaya, zhg_web.php?st_id=224300 (награды 1-14) и st_id=225290 (15-27).
// Блог ищется так: log_infa.php?mod=who&blogin=Dikaya -> её bid=20454390 -> zhg_web.php?bid=...
//
// Механика (гайд + разведка вживую 26.09.2026):
//   * журнал открывается отдельным мини-квестом («навык ведения дневника наград»), у Цунами он
//     уже есть; ссылка [Журнал наград] видна на экране NPC и после «Здравствуйте», но НЕ на go=3
//     («Работа нужна значит?»), где задание уже выдано, и не после сдачи («завтра приходи»).
//     Поэтому журнал читается ПО ХОДУ подхода, до клика «Я насчет работы» (27.09.2026: читали
//     после диалога и всегда получали «задание не взято»);
//   * каждый уникальный предмет выдаётся раз в 30 дней, иначе за ветку дают только дины — поэтому
//     в журнале обычно висит два-три пункта, а не весь список;
//   * идти НЕ по журналу бессмысленно: конец будет без награды (Паша, 27.09.2026). Поэтому ветки
//     по умолчанию здесь нет и быть не должно — если журнал не прочитался, задание снимается в
//     анкете и подход начинается заново;
//   * отказ от задания дневную попытку НЕ сжигает — она тратится только выполненным заданием
//     (Паша, 27.09.2026), поэтому снимать зависшее задание безопасно;
//   * диалог помнит шаг на сервере: повторный заход открывается с текущего места, а не с начала,
//     поэтому все шаги подхода опциональные;
//   * в инфо квеста написан Форпост «Кулак Хаоса», но конь по «К месту выполнения» ставит в форт
//     «Жженый лист» — ориентир только ссылка в локации;
//   * расход резерва за прогон: с 23 до -4, с вынужденным отдыхом 5 мин посреди сцены.
//
// Пройдено вживую 26.09.2026: ветка 27 (холмы -> вперед -> бой Пятнистый аллигатор [21] 2980 HP
// -> «Ты аллигаторов свежевать умеешь?») -> Плащ Гретхис (ледяной шторм), Ур. 21. Дин за эту
// ветку не дают вовсе: «цветов я не вижу».
const { sleep, getBodyText, goto } = require('./lib');
const { restIfBlocked } = require('./guide_run');

const MAX_SCREENS = 60;
// Сцена длиннее и дороже галереи: два-три боя в худших ветках плюс два десятка переходов.
const DEFAULT_MIN_RESERVE = 25;
const DEFAULT_MIN_HP = 1300;

// Ветки из гайда. steps -- короткие однозначные подстроки ссылок по порядку; всё, что между ними
// (пересказ, «Далее», «Продолжить квест», экраны без выбора), проходчик кликает сам.
// manual: ветка уводит с карты (Волчьи острова, Дорожный крест) -- в цикле её не берём, пока
// маршрут переезда не проверен вживую. danger: бой, который заведомо валит в минус.
const BRANCHES = [
  { n: 1, reward: 'Без награды', skip: true, steps: [] },
  { n: 2, reward: 'Зелье привлекательности',
    steps: ['опушка леса', 'проигнорировать и молча пойти', 'погоди не ешь второй'] },
  { n: 3, reward: 'Элексир снятия усталости', alias: ['эликсир снятия усталости'],
    steps: ['на болота', 'идти направо за яшкой', 'забрать налево', 'шагнуть вперед',
      'вынуждены уйти'] },
  { n: 4, reward: 'Эльфийский эликсир восстановления', manual: true,
    steps: ['опушка леса', 'проигнорировать и молча пойти', 'дай-ка и я съем гриб',
      'встретимся на островах'] },
  { n: 5, reward: 'Амулет гнома Таргрина',
    steps: ['на болота', 'вперед', 'осмотреть еще пару островов'] },
  { n: 6, reward: 'Ярость Гретхис',
    steps: ['опушка леса', 'понюхать цветок', 'расскажешь про мамы и отца', 'вернуть на форт',
      'обратиться к оркам', 'что это за шары', 'меня там гретхис'] },
  { n: 7, reward: 'Боевой возглас',
    steps: ['по холмам', 'идти вперед', 'пошли мрамару рвать', 'идти к ресторану'] },
  { n: 8, reward: 'Настойка амарании',
    steps: ['опушка леса', 'понюхать цветок', 'расскажешь про мамы и отца', 'что это?',
      'ну поищи свой цветок'] },
  { n: 9, reward: 'Эликсир воина',
    steps: ['по холмам', 'идти вперед', 'пошли мрамару рвать', 'блеск в отдалении',
      'пойдем посмотри что это', 'не выйдет', 'вернуться в форт'] },
  { n: 10, reward: 'Вишневая настойка', alias: ['вишневая настройка'],
    steps: ['по холмам', 'правее', 'правее', 'иди рви вишню'] },
  { n: 11, reward: 'Лека на 900',
    steps: ['опушка леса', 'понюхать цветок', 'расскажешь про мамы и отца', 'вернуть на форт',
      'идти к ресторану'] },
  { n: 12, reward: 'Эликсир регенерации', danger: true,
    // Бой с Доминантным медведем (80000 HP) по гайду загоняет в минус и выкидывает в город.
    steps: ['опушка леса', 'проигнорировать и молча пойти', 'пойдем дальше'] },
  { n: 13, reward: 'Амулет Даэр Тора',
    steps: ['на болота', 'вперед', 'разделяю твое нежелание'] },
  { n: 14, reward: 'Амулет исцеления',
    steps: ['на болота', 'идти направо за яшкой', 'забрать налево', 'шагнуть вперед',
      'мы выберем то, что нам пригодится', 'идти к лианам', 'попробовать встать', 'бежать'] },
  { n: 15, reward: 'Гоблинский отвар',
    steps: ['опушка леса', 'проигнорировать и молча пойти', 'дай-ка и я съем гриб',
      'лучше я гриб съем'] },
  { n: 16, reward: 'Волчий корень',
    steps: ['по холмам', 'правее', 'правее', 'давай вместе цветы собирать'] },
  { n: 17, reward: 'Поцелуй Гретхис',
    steps: ['опушка леса', 'понюхать цветок', 'расскажешь про мамы и отца', 'вернуть на форт',
      'обратиться к оркам', 'идти к гретхис'] },
  { n: 18, reward: 'Амулет защиты Джессиель',
    steps: ['по холмам', 'идти вперед', 'пошли мрамару рвать', 'блеск в отдалении',
      'пойдем посмотри что это', 'мы идем с тобой', 'до старосты'] },
  { n: 19, reward: 'Амулет ловкости Джессиель',
    steps: ['по холмам', 'идти вперед', 'пошли мрамару рвать', 'блеск в отдалении',
      'пойдем посмотри что это', 'мы идем с тобой', 'к озеру их поищем', 'сесть отдохнуть'] },
  { n: 20, reward: 'Амулет интуиции Джессиель',
    steps: ['по холмам', 'идти вперед', 'пошли мрамару рвать', 'блеск в отдалении',
      'пойдем посмотри что это', 'мы идем с тобой', 'заночуем в трактире', 'идти в следующую',
      'открыть окно'] },
  { n: 21, reward: 'Амулет повелителя аллигаторов',
    steps: ['на болота', 'идти направо за яшкой', 'забрать налево', 'шагнуть вперед',
      'мы выберем то, что нам пригодится', 'идти к пещерам', 'идти налево'] },
  { n: 22, reward: 'Амулет праведности',
    steps: ['на болота', 'идти направо за яшкой', 'забрать налево', 'шагнуть вперед',
      'мы выберем то, что нам пригодится', 'идти к пещерам', 'идти направо', 'свернуть направо'] },
  { n: 23, reward: 'Амулет друида',
    steps: ['на болота', 'идти направо за яшкой', 'забрать налево', 'шагнуть вперед',
      'мы выберем то, что нам пригодится', 'идти к пещерам', 'идти направо', 'идти вперед'] },
  // 24) Амулет посланика хаоса -- в гайде описание есть, а путь не выписан. Пока не берём.
  { n: 24, reward: 'Амулет посланика хаоса', skip: true, steps: [] },
  { n: 25, reward: 'Кольцо Клэбо',
    steps: ['на болота', 'идти направо за яшкой', 'забрать налево', 'шагнуть вперед',
      'мы выберем то, что нам пригодится', 'идти к капищу'] },
  { n: 26, reward: 'Щит Лаиты Шааб', manual: true,
    steps: ['опушка леса', 'понюхать цветок', 'расскажешь про мамы и отца', 'вернуть на форт',
      'обратиться к оркам', 'что это за шары', 'но я в деле'] },
  { n: 27, reward: 'Плащ Гретхис',
    steps: ['по холмам', 'идти вперед', 'свежевать'] },
];

// Приоритет наград (Паша, 26.09.2026: «пусть пока так и будет»): сначала резервные эликсиры --
// они окупают сам прогон; потом шмот; потом боевые амулеты; потом расходники.
const PRIORITY = [
  3, 4,
  27, 26, 25,
  18, 19, 20, 21, 22, 23, 13, 5, 14,
  6, 17, 16, 8, 11, 15, 2, 10, 7, 9, 12,
];

// Знаки препинания выбрасываем: в гайде и в игре они расходятся, и из-за этого ключ шага не
// совпадал с текстом ссылки. 27.09.2026 ветка 2 встала на «погоди не ешь второй», а на экране было
// «- Погоди, не ешь второй, натру им себе кожу.» -- вся разница в одной запятой. Ключей 27 веток
// слишком много, чтобы выверять пунктуацию в каждом, поэтому сравниваем без неё.
const norm = (s) => String(s || '')
  .replace(/ /g, ' ').replace(/ё/gi, 'е')
  .replace(/[.,!?;:«»"'()\[\]\-–—]/g, ' ')
  .replace(/\s+/g, ' ').trim().toLowerCase();
const SHORT = (t) => String(t || '').replace(/\s+/g, ' ').trim();

// Служебная обвязка страницы -- всё, что не относится к сцене.
const CHROME = ['Обновить', 'Чат', 'В игру', 'Письма', 'Инв', 'Поиск', 'Амулет', 'Конь', 'Форум',
  'ЖГ', 'Карта', 'Кланы', 'Выход', 'Размер текста', 'Настройка', 'Кто здесь?', 'Бои', 'Tsunami',
  'Турнир рыболовов', 'Рынок', 'Голд-Рынок', 'Нести караул', 'Игровой клуб Кумуса', 'Рыбалка',
  'Цейхгауз', 'Памятник', 'Идти на юг'];

async function linksOf(page) {
  return await page.evaluate(() => Array.from(document.querySelectorAll('a'))
    .map((a) => ({ t: (a.textContent || '').replace(/\s+/g, ' ').trim(), h: a.getAttribute('href') }))
    .filter((x) => x.t && x.h));
}

function findLink(links, needle) {
  const n = norm(needle);
  return links.find((x) => norm(x.t).includes(n)) || null;
}

async function click(page, href) {
  await goto(page, href);
  await restIfBlocked(page);
  await sleep(900);
}

// Журнал наград: список того, что ещё можно выбить (остальное на 30-дневном откате).
// Читается только внутри активного квеста, поэтому вызывается после подхода к Гретхис.
async function readJournal(page) {
  const links = await linksOf(page);
  let href = (findLink(links, 'журнал наград') || {}).h || null;

  // Ссылки на экране может не быть: экран диалога сервер помнит отдельно от задания, и повторный
  // заход открывается там, где мы остановились (28.09.2026: задание снималось в анкете -- в логе
  // шесть «OK: Отказаться» -- а диалог всё равно открывался на «Работа нужна значит?», где ссылки
  // журнала нет). Сам журнал при этом живёт по своему адресу: obj=5230 + mod=lootjournal, и от
  // места в диалоге не зависит -- собираем его из текущего URL.
  if (!href) {
    const cur = page.url();
    if (/obj=5230/.test(cur)) {
      href = cur.replace(/[?&]go=\d*/g, '').replace(/[?&]mod=[^&]*/g, '') + '&go=&mod=lootjournal';
      console.log('Ресторан: ссылки [Журнал наград] на экране нет, читаю журнал по прямому адресу');
    } else {
      return null;
    }
  }

  await click(page, href);
  const text = SHORT(await getBodyText(page));
  const m = text.match(/Доступно:(.*?)(?:Гретхис|Фонд великих цитат|Назад|$)/i);
  const body = m ? m[1] : '';
  const items = body.split('•').map((s) => s.trim()).filter(Boolean);
  const back = findLink(await linksOf(page), 'назад');
  if (back) await click(page, back.h);
  return items;
}

function pickBranch(available) {
  const has = (b) => available.some((a) => {
    const an = norm(a);
    if (an.includes(norm(b.reward)) || norm(b.reward).includes(an)) return true;
    return (b.alias || []).some((x) => an.includes(norm(x)));
  });
  for (const n of PRIORITY) {
    const b = BRANCHES.find((x) => x.n === n);
    if (!b || b.skip || b.manual || b.danger) continue;
    if (has(b)) return b;
  }
  return null;
}

// Подход: квест берётся у Гретхис в ресторане. Все шаги опциональные -- диалог помнит место,
// и при повторном заходе часть экранов уже пройдена.
async function approachGretkhis(page, deps) {
  const { resetToQuestMenu, clickInfoForQuest } = deps;
  if (typeof resetToQuestMenu === 'function' && typeof clickInfoForQuest === 'function') {
    await resetToQuestMenu(page);
    if (await clickInfoForQuest(page, 'Рыбный ресторан')) {
      const go = findLink(await linksOf(page), 'к месту выполнения');
      if (go) {
        await click(page, go.h);
        // Конь едет ~8 секунд; пока едем, локация показывает «В пути».
        for (let i = 0; i < 12; i++) {
          if (!/В пути/i.test(await getBodyText(page))) break;
          await sleep(3000);
          await goto(page, 'location.php');
        }
      }
    }
  }

  await goto(page, 'location.php');
  const rest = findLink(await linksOf(page), 'рыбный ресторан');
  if (!rest) {
    console.log('Ресторан: в локации нет «Рыбный ресторан» — маршрут сбился');
    return { ok: false, journal: null };
  }
  await click(page, rest.h);

  const npc = findLink(await linksOf(page), 'кумуса');
  if (!npc) {
    console.log('Ресторан: в зале нет тёщи Кумуса');
    return { ok: false, journal: null };
  }
  await click(page, npc.h);

  // Журнал читаем ПО ХОДУ диалога, а не после него: ссылка [Журнал наград] видна на экране NPC и
  // после "Здравствуйте", но на go=3 ("Работа нужна значит?"), где задание уже выдано, её уже нет.
  // 27.09.2026 бот проходил диалог до конца и только потом искал журнал -- и каждый раз получал
  // "задание не взято", хотя задание как раз было взято.
  let journal = null;
  for (const step of ['здравствуйте', 'насчет работы']) {
    if (!journal) journal = await readJournal(page);
    const l = findLink(await linksOf(page), step);
    if (!l) break;
    await click(page, l.h);
  }
  if (!journal) journal = await readJournal(page);
  return { ok: true, journal };
}

// Проходчик сцены: идёт по steps ветки, а промежуточные экраны (пересказ, «Далее», «Продолжить
// квест») проходит сам. Бои отдаёт fightLoop. Возврат true -- дошли до конца квеста.
async function walkBranch(page, branch, deps) {
  const { fightLoop, throwIfPaused } = deps;
  let i = 0;
  let fillerStreak = 0;

  for (let screen = 0; screen < MAX_SCREENS; screen++) {
    if (throwIfPaused) throwIfPaused(`Ресторан: ${branch.reward} ${screen}`);
    await restIfBlocked(page);
    const text = await getBodyText(page);
    console.log(`Ресторан[${branch.n}] ${screen}: ${SHORT(text).slice(0, 160)}`);

    if (/Ударить/.test(text) && /VS\./.test(text)) {
      await fightLoop(page);
      await sleep(1500);
      continue;
    }

    const links = await linksOf(page);

    // Ожидаемый шаг ветки важнее любых «Далее»: на развилке видны оба.
    if (i < branch.steps.length) {
      const want = findLink(links, branch.steps[i]);
      if (want) {
        console.log(`Ресторан[${branch.n}]: шаг ${i + 1}/${branch.steps.length} «${want.t}»`);
        await click(page, want.h);
        i += 1;
        fillerStreak = 0;
        continue;
      }
    }

    // "Скоро вернусь" -- выход из диалога выдачи задания; после него надо снова зайти в ресторан
    // и к Гретхис, там уже ждёт Яшка с выбором места (27.09.2026: маршрут вставал на go=3 с
    // ссылками ["- Скоро вернусь.","Уйти"], потому что шаги ветки начинаются только с выбора).
    const filler = ['в бой', 'продолжить квест', 'далее', 'вернуться',
      // "теща", а не "кумуса": «Игровой клуб Кумуса» стоит на той же клетке форта, и филлер по
      // "кумуса" уводил бы в игорный дом вместо Гретхис.
      'скоро вернусь', 'рыбный ресторан', 'теща'];
    const next = filler.map((f) => findLink(links, f)).find(Boolean);
    if (next) {
      fillerStreak += 1;
      if (fillerStreak > 8) {
        console.log(`Ресторан[${branch.n}]: хожу по кругу, не доходя до шага «${branch.steps[i]}»`);
        return false;
      }
      await click(page, next.h);
      continue;
    }

    // Единственная сюжетная ссылка на экране -- это пересказ, а не выбор: идём по ней.
    // Отбираем по ТЕКСТУ, а не по адресу: часть ссылок сцены ведёт на location.php, и прежний
    // фильтр по "loc.php" их просто не видел.
    const scene = links.filter((x) => !CHROME.some((c) => norm(x.t).startsWith(norm(c)))
      && !/журнал наград/i.test(x.t) && norm(x.t) !== 'уйти');
    if (scene.length === 1) { await click(page, scene[0].h); continue; }

    if (i >= branch.steps.length) {
      console.log(`Ресторан[${branch.n}]: ветка пройдена (${branch.reward})`);
      return true;
    }
    console.log(`Ресторан[${branch.n}]: не нашёл шаг «${branch.steps[i]}»; на экране ${JSON.stringify(links.map((x) => x.t))}`);
    return false;
  }
  console.log(`Ресторан[${branch.n}]: сцена не кончилась за ${MAX_SCREENS} экранов`);
  return false;
}

async function runFishRestaurantQuest(page, deps = {}) {
  const {
    fightLoop, throwIfPaused, hpCurrent = null, reserveMinutes = null,
    minHp = DEFAULT_MIN_HP, minReserveMinutes = DEFAULT_MIN_RESERVE,
    declineCurrentTask,
  } = deps;

  if (typeof fightLoop !== 'function') {
    console.log('Ресторан: не передан fightLoop');
    return false;
  }
  if (minReserveMinutes && (typeof reserveMinutes !== 'number' || reserveMinutes < minReserveMinutes)) {
    console.log(`Ресторан: пропускаю (нужно >=${minReserveMinutes} резервных минут, есть=${reserveMinutes ?? 'n/a'})`);
    return false;
  }
  if (minHp && (typeof hpCurrent !== 'number' || hpCurrent < minHp)) {
    console.log(`Ресторан: пропускаю (нужно >=${minHp} HP, есть=${hpCurrent ?? 'n/a'})`);
    return false;
  }

  if (throwIfPaused) throwIfPaused('Ресторан: старт');
  const approach = await approachGretkhis(page, deps);
  if (!approach.ok) return false;

  // Слот "Текущее задание" занят другим квестом (Ордо, Харчевня, Штольни, школа преторианцев) --
  // Гретхис тогда задание не выдаёт, а без взятого задания нет и ссылки [Журнал наград].
  // 27.09.2026 ресторан из-за этого простоял полдня, а в логе стояло невнятное "либо уже сдано,
  // либо не взято" -- настоящая причина была в анкете (Паша: "было задание в анкете").
  const screen = await getBodyText(page);
  if (/не\s+выполнили\s+другое\s+задание|откажитесь\s+от\s+текущего/i.test(String(screen))) {
    console.log('Ресторан: занят слот «Текущее задание» — сначала нужно закрыть или снять текущий квест в анкете');
    return false;
  }

  let available = approach.journal;

  // Журнал не прочитался -- значит задание уже было взято раньше (диалог помнит место, и ссылки
  // журнала на том экране больше нет). Ветку при этом выбирать НЕ по чему: идти "веткой по
  // умолчанию" нельзя -- ветка должна определяться журналом (Паша, 27.09.2026). Поэтому снимаем
  // зависшее задание в анкете и заходим заново, уже с начала диалога, где журнал виден.
  // Снимать безопасно именно здесь: если бы слот держал ЧУЖОЙ квест (Харчевня/Штольни/Ордо),
  // Гретхис не выдала бы своё задание, и мы вышли бы выше по тексту "откажитесь от текущего".
  if (!available) {
    if (typeof declineCurrentTask !== 'function') {
      console.log(`Ресторан: журнал недоступен (задание уже взято), снять его нечем -- пропускаю. Экран: ${SHORT(screen).slice(0, 200)}`);
      return false;
    }
    console.log('Ресторан: журнал недоступен -- задание уже взято; снимаю его в анкете и захожу заново, чтобы выбрать ветку по журналу');
    await declineCurrentTask(page, 'Рыбный ресторан');
    const retry = await approachGretkhis(page, deps);
    if (!retry.ok) return false;
    available = retry.journal;
    if (!available) {
      console.log('Ресторан: журнал не читается и после отказа -- пропускаю цикл, чтобы не ходить по кругу');
      return false;
    }
  }

  console.log(`Ресторан: в журнале доступно: ${available.join(', ') || '(пусто)'}`);
  const branch = pickBranch(available);
  if (!branch) {
    console.log('Ресторан: ни одна доступная награда не описана в таблице веток, пропускаю');
    return false;
  }
  console.log(`Ресторан: иду за наградой «${branch.reward}» (ветка ${branch.n})`);

  const ok = await walkBranch(page, branch, deps);
  await goto(page, 'location.php');
  return ok;
}

module.exports = { runFishRestaurantQuest, BRANCHES, PRIORITY, pickBranch };

// Разовый прогон в своём окне браузера (сценарий при этом должен быть остановлен -- один профиль).
if (require.main === module) {
  const path = require('path');
  const { chromium } = require('playwright');
  const { browserLaunchArgs } = require('./lib');
  const { resetToQuestMenu, clickInfoForQuest } = require('./qmenu_standalone');
  (async () => {
    const ctx = await chromium.launchPersistentContext(path.join(__dirname, '..', 'chrome-profile'), {
      headless: false,
      viewport: null,
      args: await browserLaunchArgs(),
    });
    const page = ctx.pages()[0] || (await ctx.newPage());
    const { fightLoop } = require('./fight_standalone');
    try {
      const ok = await runFishRestaurantQuest(page, {
        fightLoop, resetToQuestMenu, clickInfoForQuest, minHp: 0, minReserveMinutes: 0,
      });
      console.log('RESULT', ok);
    } catch (e) {
      console.log('RESULT error', String(e.message).split('\n')[0]);
    } finally {
      await ctx.close();
    }
  })();
}
