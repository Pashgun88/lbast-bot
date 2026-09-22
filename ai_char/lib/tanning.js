// Дубление кож в доме (Паша, 22.09.2026: «Покупка дубильный набор за 4000 дин. ты теперь можешь
// дубить шкуры», «дуби по тому же принципу что жаришь рыбу. Рыба - в приоритете. Шкуры пока не
// продавай, как прокачаешь мораль - цена будет выше», «тратит 15 резерва»).
// Живая проверка 22.09.2026: дом -> «Исп. дубильный набор» - один GET выделывает сразу пару:
// «выделанная кожа бизона сушится на веревке» и «...кожа кабана...», минус 15 резерва.
// При резерве ниже нуля набор молчит. Вызывается из fryFishWhileHealing, уже изнутри дома,
// и только когда сырой рыбы нет (рыба важнее).

module.exports = { tanHidesInHouse };

const { getBodyText, pause } = require('./core');

const TAN_RESERVE_COST = 15;
const NO_HIDES_RECHECK_MS = 3 * 60 * 60 * 1000; // сырые кожи кончились - заглянуть через 3 ч
let noHidesAt = 0;

// Стоим на странице своего дома. Дубим, пока резерв не ниже minReserve; возвращает остаток резерва.
async function tanHidesInHouse(page, reserve, minReserve) {
  if (Date.now() - noHidesAt < NO_HIDES_RECHECK_MS) return reserve;
  const href = await page.evaluate(() => {
    const a = Array.from(document.querySelectorAll('a')).find((x) => /^Исп\. дубильный набор/i.test((x.innerText || '').trim()));
    return a ? a.getAttribute('href') : null;
  }).catch(() => null);
  if (!href) {
    console.log('Дубление: в доме нет ссылки «Исп. дубильный набор».');
    return reserve;
  }
  const url = new URL(href, page.url()).href;
  let left = reserve;
  for (let n = 0; n < 3 && left >= minReserve; n++) {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    const t = await getBodyText(page);
    const bison = /кожа бизона сушится/i.test(t);
    const boar = /кожа кабана сушится/i.test(t);
    if (!bison && !boar) {
      if (/кож|шкур/i.test(t)) noHidesAt = Date.now(); // иначе, вероятно, резерв меньше нашей оценки
      console.log(`Дубление: не вышло: "${t.replace(/\s+/g, ' ').slice(0, 200)}"`);
      break;
    }
    left -= TAN_RESERVE_COST;
    console.log(`Дубление: выделал${bison ? ' бизона' : ''}${boar ? ' кабана' : ''} (резерв ~${left + TAN_RESERVE_COST} -> ~${left}).`);
    await pause(page, 600, 1200);
  }
  return left;
}
