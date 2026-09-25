// Общий «проход по экрану» для сюжетных сцен.
//
// Зачем: жёсткая цепочка шагов (performStep за performStep) ломается от любого отклонения - игра
// вставляет виньетку, после боя выкидывает на локацию, сцена ждёт на «Продолжить квест». Каждый
// шаг цепочки при этом молча пропускается, и в логе видно только начало маршрута. Так вели себя
// Варьете, Рыбный ресторан и Кораблекрушение (25.09.2026, Паша: «так кораблекрушение мы же делали
// и записывали» - квест не проходился месяцами).
//
// Как работает: на каждом круге читаем ссылки экрана и жмём ту из известных реплик, которая ЕСТЬ
// сейчас. Порядок в списке не важен, сцена подхватывается с любого места - в том числе после боя и
// после перезапуска драйвера.
//
// Уроки, встроенные в этот код (каждый оплачен живым сбоем):
//  - реплики в игре бывают с тире и точкой («- Мы выберем то, что нам пригодится.»), поэтому
//    сравнение нормализованное, а не точное;
//  - часы сайта в первой строке меняются каждую секунду, поэтому в подпись экрана они не входят,
//    иначе защита от круга не срабатывает никогда;
//  - «Продолжить квест» без единого шага сюжета между кликами - это круг, а не прогресс;
//  - пропуск виньеток жмёт первую ссылку в рамке, поэтому он идёт ПОСЛЕДНИМ, после известных
//    реплик, боёв и продолжения - иначе он уводит из диалога.

module.exports = { walkQuestScene, normalizeSceneLink };

const { getBodyText, pause } = require('./core');
const { questFightHpGate } = require('./hp');
const { fightLoop } = require('./fight');
const { QUEST_FIGHT_HP_FLOOR } = require('./state');

const DEFAULT_FIGHT_LINKS = ['В бой!', 'В бой', 'Напасть', 'Принять бой'];
const CONTINUE_LINKS = ['Продолжить квест'];
const DEFAULT_DONE_RE = /(Задание выполнено|Задание завершено|Квест выполнен)/i;

function normalizeSceneLink(x) {
  return String(x || '').toLowerCase().replace(/ё/g, 'е')
    .replace(/^[\s\-–—]+/, '').replace(/[.!?]+$/, '').replace(/\s+/g, ' ').trim();
}

async function screenLinks(page) {
  return page.evaluate(() => Array.from(document.querySelectorAll('a'))
    .map((a) => ({ t: (a.innerText || '').trim(), h: a.getAttribute('href') || '' }))
    .filter((x) => x.t && x.h)).catch(() => []);
}

async function walkQuestScene(page, {
  label,
  steps,
  fightLinks = DEFAULT_FIGHT_LINKS,
  maxFights = 3,
  maxScreens = 40,
  doneRe = DEFAULT_DONE_RE,
} = {}) {
  let fights = 0;
  let idle = 0;
  let contClicks = 0;
  let lastSignature = '';
  let sameScreenTimes = 0;

  for (let i = 0; i < maxScreens; i++) {
    const text = await getBodyText(page);
    if (doneRe.test(text)) {
      console.log(`${label}: задание выполнено (боёв ${fights}).`);
      return true;
    }
    const links = await screenLinks(page);
    const find = (names) => links.find((l) => names.some((n) => normalizeSceneLink(l.t).includes(normalizeSceneLink(n))));

    const plain = text.replace(/\d{1,2}:\d{2}(:\d{2})?/g, '').replace(/\s+/g, ' ');
    const signature = `${links.map((l) => l.t).join('|')}##${plain.slice(0, 200)}`;
    sameScreenTimes = signature === lastSignature ? sameScreenTimes + 1 : 0;
    lastSignature = signature;
    if (sameScreenTimes >= 2) {
      console.log(`${label}: один и тот же экран ${sameScreenTimes + 1} раза подряд - нужной реплики в списке нет.`);
      console.log(`${label}: ссылки экрана: ${links.map((l) => l.t).join(' | ').slice(0, 400)}`);
      console.log(`${label}: текст экрана: ${plain.slice(0, 500)}`);
      return fights > 0;
    }

    const step = find(steps);
    if (step) {
      idle = 0;
      contClicks = 0;
      console.log(`${label}: ${step.t.slice(0, 60)}`);
      await page.goto(new URL(step.h, page.url()).href, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await pause(page, 700, 1300);
      continue;
    }

    const fight = find(fightLinks);
    if (fight && fights >= maxFights) {
      console.log(`${label}: боёв уже ${fights}, предел ${maxFights} - дальше в бой не иду.`);
      console.log(`${label}: ссылки экрана: ${links.map((l) => l.t).join(' | ').slice(0, 300)}`);
      return fights > 0;
    }
    if (fight) {
      idle = 0;
      if (!(await questFightHpGate(page, `${label} (бой ${fights + 1})`, QUEST_FIGHT_HP_FLOOR, { waitForRecovery: true }))) {
        console.log(`${label}: мало HP перед боем ${fights + 1} - остаюсь в сцене, продолжу в следующем круге.`);
        return false;
      }
      console.log(`${label}: бой ${fights + 1} (${fight.t})`);
      await page.goto(new URL(fight.h, page.url()).href, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await fightLoop(page);
      fights += 1;
      await pause(page, 800, 1500);
      continue;
    }

    const cont = find(CONTINUE_LINKS);
    if (cont) {
      idle = 0;
      contClicks += 1;
      console.log(`${label}: Продолжить квест (возврат в сцену)`);
      if (contClicks > 3) {
        console.log(`${label}: «Продолжить квест» ${contClicks} раза подряд возвращает сюда же - сцена не открывается, выхожу.`);
        console.log(`${label}: ссылки экрана: ${links.map((l) => l.t).join(' | ').slice(0, 300)}`);
        return fights > 0;
      }
      await page.goto(new URL(cont.h, page.url()).href, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await pause(page, 700, 1300);
      continue;
    }

    // Виньетка: экран-флейвор с одной ссылкой в рамке. Жмём ПОСЛЕДНИМ делом - вслепую он уводит
    // из диалога (так терялась сцена Тёщи Кумуса).
    if (idle === 0) {
      idle = 1;
      const clicked = await page.evaluate(() => {
        const el = document.querySelector('.bBorder a');
        if (!el) return false;
        const label2 = (el.textContent || '').trim();
        if (/^(в\s*бой!?|напасть|атаковать|ударить|принять\s+бой)/i.test(label2)) return 'fight';
        el.click();
        return label2 || true;
      }).catch(() => false);
      if (clicked === 'fight') {
        console.log(`${label}: единственная ссылка в рамке ведёт в бой - не жму.`);
      } else if (clicked) {
        console.log(`${label}: виньетка (${String(clicked).slice(0, 40)})`);
        await pause(page, 800, 1500);
        continue;
      }
      await page.goto('http://lbast.ru/location.php', { waitUntil: 'domcontentloaded', timeout: 60000 });
      await pause(page, 900, 1500);
      continue;
    }
    console.log(`${label}: на экране нет ни реплики, ни боя, ни продолжения (боёв ${fights}).`);
    console.log(`${label}: ссылки экрана: ${links.map((l) => l.t).join(' | ').slice(0, 400)}`);
    console.log(`${label}: текст экрана: ${plain.slice(0, 400)}`);
    return fights > 0;
  }
  console.log(`${label}: ${maxScreens} экранов подряд без завершения - выхожу, продолжу в следующем круге.`);
  return false;
}
