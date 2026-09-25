// «Галерея искусств» (лазулиты) — квест Рыбацкой деревни.
//
// Почему JS, а не *.steps: половина маршрута — не клики по тексту, а прямые переходы по href с
// дописанными параметрами (&go=1 -> &go=3 у Марсиуса), плюс сценка поиска с двумя боями.
//
// Маршрут (подъезд перенесён из ai_char/lib/quests_story.js, сценка поиска продиктована Пашей
// 25.09.2026 и уточнена разведкой того же дня):
//   конь в Рыбацкую деревню (lway=7) -> Галерея искусств: &go=1 «Подняться в галерею»,
//   &go=3 «Идти в каморку художника» — там Марсиус выдаёт задание
//   -> 2 клетки на запад, на побережье
//   -> «Искать лазулиты» -> «Свернуть на косу» -> несколько экранов «Идти вперед»/«Далее»
//      -> «Ударить их мечом» -> ДВА боя подряд -> «Продолжить квест» -> «Уйти»
//   -> 2 клетки на восток -> снова Галерея (&go=1 -> &go=3): доложить о выполнении ТАМ ЖЕ,
//      где брали задание.
//
// Две ловушки, на которых спотыкалась версия AI-персонажа (обе исправлены здесь):
//   1) там поиск был простым циклом «жать Искать лазулиты, пока не выпадет камень», а это
//      ветвящаяся сценка: на развилке «Идти по берегу» / «Свернуть на косу» нужна именно коса;
//   2) находку там определяли по слову «лазулит», а оно есть и в описании побережья — то есть
//      «находка» засчитывалась там, где камня не было, и Марсиус потом выдавал задание заново.
//
// Квест МНОГОРАЗОВЫЙ (Паша, 25.09.2026: «это многоразовый квест и у меня и у него») — в каталоге
// «Все квесты» он стоит в разделе МНОГОРАЗОВЫЕ, у Цунами после сдачи встало «через 6 дн.».
// В версии AI-персонажа он помечен одноразовым (флаг galleryQuestDone: сдал один раз — диспетчер
// больше никогда не ходит к Марсиусу). Это баг ТАМ, а не разница между персонажами: у AI-чара
// квест тоже повторяется. Здесь гейт по периоду, никакого «сделано навсегда».
const { sleep, getBodyText, goto } = require('./lib');
const { travelWait, restIfBlocked } = require('./guide_run');

const FISH_VILLAGE_KONJ = 'location.php?mod=konj&lway=7';
// Потолки на всякий случай: сценка конечная, но зацикливаться на ней мы не хотим.
const MAX_SEARCH_ROUNDS = 4;
const MAX_SCENE_SCREENS = 24;
// Порог HP перед выездом. Это НЕ правило Паши (он его для этого квеста не задавал), а осторожный
// дефолт: в сценке два боя подряд. Переопределяется через deps.minHp.
const DEFAULT_MIN_HP = 1300;

// Порядок = приоритет: на одном экране бывает несколько ссылок, берём первую из списка.
// «Идти по берегу» сюда не входит НАМЕРЕННО — это вторая половина развилки, и она уводит мимо.
const SCENE_STEPS = [
  'Свернуть на косу',
  'Ударить их мечом',
  'Идти вперед',
  'Продолжить квест',
  'Далее',
];

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

// Марсиус: &go=1 — «Подняться в галерею», &go=3 — «Идти в каморку художника». Один и тот же
// адрес и выдаёт задание, и принимает выполненное — зависит от того, с чем мы пришли.
async function talkToMarsius(page, galleryHref) {
  const base = absUrl(galleryHref);
  await goto(page, `${base}&go=1`);
  await sleep(900);
  await goto(page, `${base}&go=3`);
  await sleep(600);
  return await getBodyText(page);
}

const SHORT = (t) => String(t || '').replace(/\s+/g, ' ').trim();

// Один заход в сценку: «Искать лазулиты» и дальше до конца (два боя и выход).
// true — дошли до боёв (камень наш), false — коса не выпала, стоит повторить, null — сбой.
async function runSearchScene(page, { fightLoop, throwIfPaused, round }) {
  // Ссылка «Искать лазулиты» живёт на клетке (location.php), а сценка уводит на свои экраны,
  // где её уже нет. Поэтому каждый заход начинаем с возврата на клетку.
  await goto(page, 'location.php');
  const search = await findHref(page, 'Искать лазулиты');
  if (!search) {
    console.log('Галерея: на клетке нет «Искать лазулиты» — маршрут сбился');
    return null;
  }
  if (!(await step(page, absUrl(search), `искать лазулиты (заход ${round})`))) return null;

  let fights = 0;
  for (let screen = 0; screen < MAX_SCENE_SCREENS; screen++) {
    if (throwIfPaused) throwIfPaused(`Галерея: сценка ${round}.${screen}`);
    const text = await getBodyText(page);
    console.log(`Галерея: сценка ${round}.${screen} >>> ${SHORT(text).slice(0, 200)}`);

    if (/Ударить/i.test(text)) {
      await fightLoop(page);
      fights += 1;
      console.log(`Галерея: бой ${fights} пройден`);
      await sleep(1200);
      continue;
    }

    const toFight = await findHref(page, 'В бой!');
    if (toFight) {
      if (!(await step(page, absUrl(toFight), `в бой (${fights + 1})`))) return null;
      continue;
    }

    let next = null;
    for (const name of SCENE_STEPS) {
      const href = await findHref(page, name);
      if (href) { next = { name, href }; break; }
    }

    if (next) {
      if (!(await step(page, absUrl(next.href), next.name))) return null;
      continue;
    }

    // Ссылок сценки не осталось. После боёв это конец — выходим «Уйти». До боёв это значит, что
    // заход не вывел на косу (сценка случайная), и надо пробовать ещё раз.
    const out = await findHref(page, 'Уйти');
    if (out) await step(page, absUrl(out), 'Уйти');
    if (fights > 0) return true;
    console.log(`Галерея: заход ${round} кончился без боёв — коса не выпала, пробую снова`);
    return false;
  }

  console.log(`Галерея: сценка ${round} не кончилась за ${MAX_SCENE_SCREENS} экранов`);
  return fights > 0;
}

async function runGalleryLazuliteQuest(page, deps = {}) {
  const { fightLoop, throwIfPaused, hpCurrent = null, minHp = DEFAULT_MIN_HP } = deps;
  if (typeof fightLoop !== 'function') {
    console.log('Галерея: не передан fightLoop, без него сценку не пройти');
    return false;
  }
  if (minHp && typeof hpCurrent === 'number' && hpCurrent < minHp) {
    console.log(`Галерея: пропускаю (нужно >=${minHp} HP на два боя подряд, есть=${hpCurrent})`);
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
  if (/Благодарствую|Получено \d+ дин|Задание выполнено/i.test(text)) {
    console.log('Галерея: лазулит был на руках, Марсиус принял — задание завершено');
    return true;
  }
  if (!/Задание получено/i.test(text)) {
    console.log(`Галерея: Марсиус не выдал задание, прекращаю: ${SHORT(text).slice(0, 300)}`);
    return false;
  }

  // На запад две клетки от деревни, на побережье.
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

  let done = false;
  for (let round = 1; round <= MAX_SEARCH_ROUNDS && !done; round++) {
    const r = await runSearchScene(page, { fightLoop, throwIfPaused, round });
    if (r === null) return false;
    done = r;
  }
  if (!done) {
    console.log(`Галерея: за ${MAX_SEARCH_ROUNDS} заходов сценка с косой так и не выпала`);
    return false;
  }

  // Обратно две клетки на восток и доложить там же, где брали.
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
  console.log(`Галерея: экран сдачи >>> ${SHORT(text).slice(0, 500)}`);
  if (/Благодарствую|Получено \d+ дин|Задание выполнено/i.test(text)) {
    console.log('Галерея: доложено Марсиусу, задание завершено');
    return true;
  }

  console.log('Галерея: сдача не подтвердилась (см. экран выше)');
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
    try {
      const ok = await runGalleryLazuliteQuest(page, { fightLoop });
      console.log('RESULT', ok);
    } catch (e) {
      // Иначе упавший прогон (сеть, DNS) оставлял браузер висеть на профиле, и следующий запуск
      // не мог его занять.
      console.log('RESULT error', String(e.message).split('\n')[0]);
    } finally {
      await ctx.close();
    }
  })();
}
