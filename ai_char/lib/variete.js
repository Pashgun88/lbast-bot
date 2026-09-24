// Квест «Варьете». Маршрут взят из кода Цунами (origin/main:daily_quests_piraty.js,
// progressVarieteQuest) - Паша 24.09.2026: «Варьетте есть у цунами, посмотри на гитхабе».
// Появляется в Q-меню от случая к случаю, не привязан ко дню недели: длинная линейная цепочка
// диалогов с одним обычным боем в середине.
//
// Отличия от версии Цунами, каждое - по живому сбою 24.09.2026:
//  - tryPerformStepOptional у AI__ лежит в lib/hp.js, а не в lib/ui.js;
//  - после «Выполнение» персонаж садится на коня («В пути еще N сек.») - ждём waitOutHorseTravel;
//  - бой идёт через questFightHpGate (правило AI__: гейт ДО клика в бой);
//  - и главное: вместо жёсткой цепочки кликов идём ПО ЭКРАНУ. Жёсткая цепочка после любого
//    сбоя начинала квест заново и на возобновлённой сцене падала на первом же шаге, потому что
//    диалог уже ушёл вперёд. Список реплик тот же, что у Цунами, но нажимается та из них,
//    которая сейчас на экране. Реплики матчатся по короткой уникальной подстроке без тире:
//    тире в описании квеста - маркер списка, а не часть текста кнопки.

// Экспорт только функциями: const-константы объявлены ниже, и ссылка на них здесь падала бы
// ReferenceError при загрузке модуля (уже наступали на это в offers.js и tanning.js).
module.exports = { progressVarieteQuest, varieteNeedsResume };

const { QUEST_FIGHT_HP_FLOOR } = require('./state');
const { getBodyText, pause } = require('./core');
const { waitOutHorseTravel } = require('./assassins');
const { fightLoop } = require('./fight');
const { questFightHpGate, tryPerformStepOptional } = require('./hp');
const { clickInfoForQuest } = require('./quest_menu');
const { clickByTexts, existsAnyText } = require('./ui');

const QUEST = 'Варьете';
// Порядок здесь не важен (нажимается то, что на экране), но он сохранён как у Цунами - так
// понятнее читать сценарий целиком.
const VARIETE_OPTIONS = [
  'Амулет', 'Три поросенка', 'Пройти в зал варьете',
  'занять место', 'к скамьям в конец зала',
  'когда начнется представление', 'интересно посмотреть, что это такое', 'Рад знакомству',
  'люблю посмотр', 'больше посмотреть',
  'не хочется', 'займу столик', 'сесть за столик к ашаи',
  'просто потерять', 'именно украли', 'зацепки откуда начать поиски',
  'давно вы работаете', 'да уж',
  'найти дим пупса', 'поговорить об одной из танцовщиц', 'Мара',
  'какие у тебя с ней отношения', 'догадки кто мог украсть', 'спасибо, помог',
  'поговорить с двумя наемниками', 'хотите их обсудить', 'однако он беспокоится',
  'незаметно подставить официанту подножку',
  'поговорить с брумом', 'спасибо за информацию',
  'клэр хитцу', 'присесть рядом',
  'номер был шикарен', 'не трудно выступать после танцовщиц', 'танцовщицам вы нрав',
  'хочу помочь Маре', 'очень помогли',
  'пройти в комнату к маре', 'задание завершено',
];
const FIGHT_TEXTS = ['в бой'];
const CONTINUE_TEXTS = ['продолжить квест', 'далее'];
const DONE_RE = /(Задание завершено|Задание выполнено|Квест выполнен)/i;
const MAX_SCREENS = 80;

// Взятый квест исчезает из Q-меню, поэтому одного «есть в меню» для запуска мало: начатую и
// недоведённую сцену надо продолжать. Флаг живёт в памяти процесса - этого хватает: после
// перезапуска драйвера сцена всё равно ждёт на «Продолжить квест», а квест вернётся в меню.
let varieteStarted = false;
function varieteNeedsResume() { return varieteStarted; }

// Ссылки экрана без служебной обвязки сайта.
const CHROME = new Set(['обновить', 'чат', 'в игру', 'форум', 'жг', 'галерея', 'кланы', 'карта',
  'бои', 'кто здесь?', 'выход', 'размер текста', 'амулет | конь', 'конь', 'инвентарь', 'письма']);

async function screenLinks(page) {
  return page.evaluate(() => Array.from(document.querySelectorAll('a'))
    .map((a) => ({ t: (a.innerText || '').trim(), h: a.getAttribute('href') || '' }))
    .filter((x) => x.t && x.h)).catch(() => []);
}

const norm = (s) => String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();

function findOption(links, needles) {
  for (const needle of needles) {
    const n = norm(needle);
    const hit = links.find((l) => !CHROME.has(norm(l.t)) && norm(l.t).includes(n));
    if (hit) return { hit, needle };
  }
  return null;
}

async function progressVarieteQuest(page, { questCount } = {}) {
  // Свежий заход: [инфо] -> «Выполнение». Если квест уже взят и сцена на середине, в меню его
  // нет - тогда заходим через «Продолжить квест» с локации.
  if (await existsAnyText(page, [QUEST])) {
    if (!(await clickInfoForQuest(page, QUEST))) {
      console.log('Варьете: не удалось открыть инфо квеста.');
      return false;
    }
    await tryPerformStepOptional(page, {
      stepName: 'Выполнение',
      currentTexts: ['Выполнение', 'выполнение', 'К месту выполнения', 'к месту выполнения'],
      waitAfterClickMs: 3000,
    });
    await waitOutHorseTravel(page, page.url());
    await pause(page, 700, 1300);
    varieteStarted = true;
  }

  let fights = 0;
  let idle = 0;
  for (let i = 0; i < MAX_SCREENS; i++) {
    const text = await getBodyText(page);
    if (DONE_RE.test(text)) {
      console.log(`Варьете: квест завершён (боёв ${fights}).`);
      varieteStarted = false;
      await clickByTexts(page, ['В игру', 'в игру'], 'В игру (after Варьете)').catch(() => {});
      return true;
    }
    const links = await screenLinks(page);

    const option = findOption(links, VARIETE_OPTIONS);
    if (option) {
      idle = 0;
      console.log(`Варьете: ${option.hit.t.slice(0, 60)}`);
      await page.goto(new URL(option.hit.h, page.url()).href, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await waitOutHorseTravel(page, page.url());
      await pause(page, 700, 1300);
      continue;
    }

    const fight = findOption(links, FIGHT_TEXTS);
    if (fight) {
      if (!(await questFightHpGate(page, `Варьете (бой ${fights + 1})`, QUEST_FIGHT_HP_FLOOR, { waitForRecovery: true }))) {
        console.log('Варьете: мало HP перед боем - остаюсь в сцене, продолжу в следующем круге.');
        return false;
      }
      console.log(`Варьете: бой ${fights + 1}`);
      await page.goto(new URL(fight.hit.h, page.url()).href, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await fightLoop(page);
      fights += 1;
      await pause(page, 800, 1500);
      continue;
    }

    const cont = findOption(links, CONTINUE_TEXTS);
    if (cont) {
      idle = 0;
      await page.goto(new URL(cont.hit.h, page.url()).href, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await pause(page, 700, 1300);
      continue;
    }

    if (idle === 0) {
      idle = 1; // сцена могла ещё не проявиться - перечитаем локацию один раз
      await page.goto('http://lbast.ru/location.php', { waitUntil: 'domcontentloaded', timeout: 60000 });
      await pause(page, 900, 1500);
      continue;
    }
    console.log(`Варьете: на экране нет ни реплики, ни боя, ни продолжения (боёв ${fights}).`);
    console.log(`Варьете: ссылки экрана: ${links.map((l) => l.t).join(' | ').slice(0, 400)}`);
    return false;
  }
  console.log(`Варьете: ${MAX_SCREENS} экранов подряд без завершения - выхожу, продолжу в следующем круге.`);
  return false;
}
