// «Галерея искусств» (лазулиты) — квест Рыбацкой деревни. Портирован из проекта AI-персонажа
// (ветка claude/lbast-character-registration-gc7bey, ai_char/lib/quests_story.js), где пройден
// вживую 14.09.2026.
//
// Почему JS, а не *.steps: половина маршрута — не клики по тексту, а прямые переходы по href с
// дописанными параметрами (&go=1 -> &go=3 у Марсиуса), плюс цикл «Искать лазулиты» со случайными
// засадами. В формате шагов это не выражается.
//
// ВАЖНО, отличие от AI-персонажа: у него квест был помечен одноразовым (флаг galleryQuestDone).
// Для Цунами это неверно — в каталоге «Все квесты» 25.09.2026 «Галерея искусств [с 2 ур.]» стоит
// в разделе МНОГОРАЗОВЫЕ КВЕСТЫ. Поэтому здесь никакого «сделано навсегда»: период решает
// вызывающий код по кулдауну из каталога.
//
// Маршрут: конь в Рыбацкую деревню (lway=7) -> Галерея искусств (&go=1, затем &go=3 — это Марсиус
// и выдача задания) -> 2 клетки на запад -> «Искать лазулиты» -> 2 клетки на восток -> снова
// Галерея (&go=1 -> &go=3) — сдача.
//
// НЕ ЗАКОНЧЕН. Разведка 25.09.2026 показала, что поиск лазулитов устроен НЕ так, как в версии
// AI-персонажа (там это был простой цикл «жать Искать лазулиты, пока не выпадет камень или
// засада»). На самом деле это ветвящаяся сценка:
//   1) «Искать лазулиты» -> «Вы бредете по побережью, высматривая синие камушки…» -> «Идти вперед»
//   2) «…надежды обогатиться тают… Впереди узкая каменистая коса… едва уловимый переливчатый
//      смех» -> ВЫБОР: «Идти по берегу» или «Свернуть на косу»
// Какая ветка ведёт к лазулиту, а какая к засаде/потере — неизвестно, гайда у kate2008 на этот
// квест нет. Поэтому цикл ниже честно упирается в развилку и выходит, а не гадает.
const { sleep, getBodyText, goto } = require('./lib');
const { travelWait, restIfBlocked } = require('./guide_run');

const FISH_VILLAGE_KONJ = 'location.php?mod=konj&lway=7';
const MAX_SEARCH_ATTEMPTS = 6;

function absUrl(href) {
  if (href.startsWith('http')) return href;
  return href.startsWith('/') ? 'http://lbast.ru' + href : 'http://lbast.ru/' + href;
}

async function findHref(page, regexSource) {
  return await page.evaluate((src) => {
    const re = new RegExp(src, 'i');
    const a = Array.from(document.querySelectorAll('a')).find((el) => re.test(el.textContent || ''));
    return a ? a.getAttribute('href') : null;
  }, regexSource).catch(() => null);
}

// Шаг по карте с учётом резерва: игра отклоняет переход, если минуты кончились, и показывает
// «Вам нужно отдохнуть еще N мин». Тогда ждём и повторяем — иначе маршрут разъедется.
async function step(page, url, label) {
  for (let attempt = 0; attempt < 4; attempt++) {
    await goto(page, url);
    if (!(await restIfBlocked(page))) return true;
    console.log(`Галерея: повторяю шаг «${label}» после отдыха`);
  }
  console.log(`Галерея: шаг «${label}» так и не прошёл из-за резерва`);
  return false;
}

// Марсиус в галерее: сначала &go=1 (войти), затем &go=3 (говорить). Так было записано живьём.
async function talkToMarsius(page, galleryHref) {
  const base = absUrl(galleryHref);
  await goto(page, `${base}&go=1`);
  await sleep(900);
  await goto(page, `${base}&go=3`);
  await sleep(600);
  return await getBodyText(page);
}

async function runGalleryLazuliteQuest(page, deps = {}) {
  const { fightLoop, throwIfPaused } = deps;
  if (typeof fightLoop !== 'function') {
    console.log('Галерея: не передан fightLoop, без него засады не пройти');
    return false;
  }

  if (throwIfPaused) throwIfPaused('Галерея: старт');

  await goto(page, FISH_VILLAGE_KONJ);
  await travelWait(page);
  await goto(page, 'location.php');

  const galleryHref = await findHref(page, 'Галерея искусств');
  if (!galleryHref) {
    console.log('Галерея: в Рыбацкой деревне нет объекта «Галерея искусств» — маршрут сбился');
    return false;
  }

  let text = await talkToMarsius(page, galleryHref);

  // Лазулит мог остаться с прошлого незавершённого захода — тогда Марсиус сразу принимает его.
  if (/Благодарствую|Получено \d+ дин/i.test(text)) {
    console.log('Галерея: лазулит был на руках, Марсиус принял — задание завершено');
    return true;
  }
  if (!/Задание получено|лазулит/i.test(text)) {
    console.log(`Галерея: неожиданный ответ Марсиуса, прекращаю: ${text.replace(/\s+/g, ' ').slice(0, 300)}`);
    return false;
  }

  // На запад две клетки от деревни.
  await goto(page, 'location.php');
  for (let i = 0; i < 2; i++) {
    if (throwIfPaused) throwIfPaused(`Галерея: запад ${i + 1}/2`);
    const west = await findHref(page, 'На запад|Идти на запад');
    if (!west) {
      console.log(`Галерея: не нашёл «на запад» на шаге ${i + 1} из 2`);
      return false;
    }
    if (!(await step(page, absUrl(west), `на запад ${i + 1}/2`))) return false;
  }

  // Поиск: засада либо находка. С заряженного экрана боя уйти нельзя, поэтому дерёмся, а не
  // отказываемся -- отказ оставил бы висеть "В бой!" и его потом подобрал бы обработчик атак.
  let found = false;
  for (let attempt = 1; attempt <= MAX_SEARCH_ATTEMPTS && !found; attempt++) {
    if (throwIfPaused) throwIfPaused(`Галерея: поиск ${attempt}`);
    // Ссылка «Искать лазулиты» живёт на клетке (location.php), а сам поиск уводит на экран-
    // виньетку, где её уже нет. Поэтому перед каждой попыткой возвращаемся на клетку.
    await goto(page, 'location.php');
    const search = await findHref(page, 'Искать лазулиты');
    if (!search) {
      console.log('Галерея: на клетке нет «Искать лазулиты» — маршрут сбился');
      return false;
    }
    if (!(await step(page, absUrl(search), `искать лазулиты (${attempt})`))) return false;

    // Поиск -- не один экран, а цепочка: «Искать лазулиты» даёт виньетку про побережье, дальше
    // «Идти вперед» и так несколько раз, пока не выпадет находка или засада. Проверять текст на
    // слово "лазулит" нельзя -- оно есть и в описании побережья; факт находки игра помечает
    // скобками "[Получен ...]", как и в других квестах.
    for (let screen = 0; screen < 10; screen++) {
      text = await getBodyText(page);
      console.log(`Галерея: поиск ${attempt}.${screen} >>> ${text.replace(/\s+/g, ' ').slice(0, 220)}`);

      if (/В бой!/i.test(text)) {
        console.log(`Галерея: засада на поиске (попытка ${attempt}), дерусь`);
        await fightLoop(page);
        break;
      }
      if (/\[\s*Получен/i.test(text)) {
        console.log(`Галерея: лазулит найден (попытка ${attempt})`);
        found = true;
        break;
      }

      const next = await findHref(page, 'Идти вперед|Искать дальше|Далее');
      if (!next) {
        console.log(`Галерея: попытка ${attempt} кончилась без находки`);
        break;
      }
      if (!(await step(page, absUrl(next), `поиск ${attempt}.${screen}`))) return false;
    }
    await sleep(1200);
  }

  if (!found) {
    console.log(`Галерея: за ${MAX_SEARCH_ATTEMPTS} попыток лазулит не нашёлся`);
    return false;
  }

  // Обратно две клетки на восток и сдача.
  await goto(page, 'location.php');
  for (let i = 0; i < 2; i++) {
    if (throwIfPaused) throwIfPaused(`Галерея: восток ${i + 1}/2`);
    const east = await findHref(page, 'На восток|Идти на восток');
    if (!east) {
      console.log(`Галерея: не нашёл «на восток» на шаге ${i + 1} из 2`);
      return false;
    }
    if (!(await step(page, absUrl(east), `на восток ${i + 1}/2`))) return false;
  }

  const galleryBack = await findHref(page, 'Галерея искусств');
  if (!galleryBack) {
    console.log('Галерея: на обратном пути не нашёл галерею для сдачи');
    return false;
  }

  text = await talkToMarsius(page, galleryBack);
  console.log(`Галерея: экран сдачи целиком >>> ${text.replace(/\s+/g, ' ')}`);
  if (/Благодарствую|Получено \d+ дин/i.test(text)) {
    console.log(`Галерея: лазулит сдан Марсиусу — ${text.replace(/\s+/g, ' ').slice(0, 200)}`);
    return true;
  }

  console.log(`Галерея: сдача не подтвердилась: ${text.replace(/\s+/g, ' ').slice(0, 300)}`);
  return false;
}

module.exports = { runGalleryLazuliteQuest };

// Разовый прогон в своём окне браузера (сценарий при этом должен быть остановлен -- один профиль).
if (require.main === module) {
  const path = require('path');
  const { chromium } = require('playwright');
  const { browserLaunchArgs } = require('./lib');
  (async () => {
    const ctx = await chromium.launchPersistentContext(path.join(__dirname, '..', 'chrome-profile'), {
      headless: false,
      viewport: null,
      args: await browserLaunchArgs(),
    });
    const page = ctx.pages()[0] || (await ctx.newPage());
    const { fightLoop } = require('./fight_standalone');
    const ok = await runGalleryLazuliteQuest(page, { fightLoop });
    console.log('RESULT', ok);
    await ctx.close();
  })();
}
