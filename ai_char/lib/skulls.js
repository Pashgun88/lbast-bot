// Черепа - в казну клана. Паша, 04.10.2026: «передай все черепа в казну клана по 70 дин
// Bogi_vojny», затем «отправляй раз в 2 дня», и 09.10.2026, увидев в логе передач пять
// отдельных посылок подряд (3+2+4+3+2 шт. в одну минуту): «вот так не делай, раз в 2 дня
// все черепа». Череп падает с Молега в половине боёв, в магазине стоит 2 дина.
//
// ЧТО СЛОМАЛОСЬ 09.10.2026 - две причины разом, и они усиливали друг друга:
//
//  1) Успех определялся по тексту ответа («предложение передачи товаров отправлено»), а игра
//     вернула почти пустую страницу - в журнале осталось «передача не ушла: "09:45:27, Пт."».
//     Передача при этом УХОДИЛА. Раз успех не засчитан, S.skullsSentAt остался с 04.10, и
//     двухдневный замок не защёлкнулся.
//  2) Счётчик попыток жил только в памяти процесса. Я вчера много раз перезапускал драйвер
//     (разведка, правки), и каждый свежий процесс начинал с чистого листа: замок открыт,
//     час не выждан - новая посылка.
//
// Отсюда правила:
//  - УСПЕХ ПРОВЕРЯЕМ ПО ИГРЕ, а не по тексту ответа: перечитываем сумку и смотрим, исчезли ли
//    черепа. Это то же правило, что и с Q-меню: игра - источник истины, не наша запись;
//  - отметка о ПОПЫТКЕ персистится (S.skullsTriedAt), поэтому перезапуск драйвера больше не
//    открывает дверь заново;
//  - за один заход отправляем ВСЕ пачки, а не первую. Черепа лежат в сумке несколькими
//    строками, и старый код брал только верхнюю - отсюда и растянутая на дни капель;
//  - цена в форме - ОБЩАЯ сумма за пачку, не за штуку (обжигался 21.09.2026);
//  - сделку принимает человек на той стороне; пока не принял, черепа остаются предложением.

module.exports = { sendSkullsIfDue };

const { S, persistDailyQuestState } = require('./state');
const { getBodyText, pause } = require('./core');

const NICK = process.env.AI_SKULL_NICK || 'Bogi_vojny';
const PRICE_PER_ITEM = Number(process.env.AI_SKULL_PRICE || 70);
const EVERY_MS = 2 * 24 * 60 * 60 * 1000;
const RETRY_MS = 60 * 60 * 1000;   // неудачная попытка не повторяется чаще раза в час
const MAX_STACKS = 10;             // предохранитель от бесконечного цикла

const BAG_URL = `http://lbast.ru/inv.php?lgn=${NICK}`;

// Все строки «Череп» в сумке: сколько штук и ссылка «Передать».
async function readSkullStacks(page) {
  return page.evaluate(() => {
    const all = Array.from(document.querySelectorAll('a'));
    const res = [];
    for (let i = 0; i < all.length; i++) {
      if (!/^Череп$/i.test((all[i].textContent || '').trim())) continue;
      let count = null;
      let pered = null;
      for (let k = i + 1; k < Math.min(i + 5, all.length); k++) {
        const t = (all[k].textContent || '').trim();
        if (/^\d+$/.test(t) && count === null) count = Number(t);
        if (t === 'Передать' && !pered) pered = all[k].getAttribute('href');
      }
      if (pered) res.push({ count: count || 1, pered }); // одиночный предмет печатается без числа
    }
    return res;
  }).catch(() => []);
}

async function sendOneStack(page, stack) {
  const total = stack.count * PRICE_PER_ITEM;
  await page.goto(new URL(stack.pered, 'http://lbast.ru/').href, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.locator('input[name="kol"]').fill(String(stack.count));
  await page.locator('input[name="price"]').fill(String(total));
  await page.locator('input[name="cmnp"]').fill(`черепа с молега в казну клана, ${PRICE_PER_ITEM} за штуку`).catch(() => {});
  await Promise.all([
    page.waitForLoadState('domcontentloaded'),
    page.locator('input[type="submit"]').first().click(),
  ]);
  await pause(page, 500, 900);
  return total;
}

async function sendSkullsIfDue(page) {
  const now = Date.now();
  if (now - (S.skullsSentAt || 0) < EVERY_MS) return false;
  if (now - (S.skullsTriedAt || 0) < RETRY_MS) return false;
  S.skullsTriedAt = now;
  persistDailyQuestState(); // отметка о попытке переживает перезапуск - см. шапку файла

  await page.goto(BAG_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  if (/Восстановите здоровье/i.test(await getBodyText(page).catch(() => ''))) return false; // в минусе сумка не открывается

  let stacks = await readSkullStacks(page);
  if (!stacks.length) return false; // черепов нет - таймер отправки не двигаем

  const before = stacks.reduce((a, s) => a + s.count, 0);
  let sent = 0;
  let money = 0;
  for (let i = 0; i < MAX_STACKS && stacks.length; i++) {
    const stack = stacks[0];
    money += await sendOneStack(page, stack);
    sent += stack.count;
    await page.goto(BAG_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    stacks = await readSkullStacks(page);
  }

  const left = stacks.reduce((a, s) => a + s.count, 0);
  if (left === 0) {
    S.skullsSentAt = Date.now();
    persistDailyQuestState();
    console.log(`Черепа: отправил все ${sent} шт в казну клана (${NICK}) за ${money} дин, по ${PRICE_PER_ITEM}. Следующий раз через 2 дня.`);
    return true;
  }
  console.log(`Черепа: было ${before}, отправил ${sent}, в сумке осталось ${left} - попробую через час.`);
  return sent > 0;
}
