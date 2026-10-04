// Самогонный аппарат в доме (Паша, 04.10.2026: «поставил тебе еще самогонный апарат, там ты
// можешь делать брагу из хмеля»). Нужен не ради денег: БРАГА - входной билет в «Колодец Страха»,
// туда ходим только когда она в сумке.
//
// Живая проверка 04.10.2026: GET на flag=samogon варит СРАЗУ («Вы забодяжили неплохую брагу!»),
// как и кухня - «посмотреть» аппарат нельзя. Резерв ушёл с 2 в -8, то есть один заход стоит 10
// минут резерва И НЕ СПРАШИВАЕТ: в минус пускает молча. Поэтому гейт только наш, как у кухни.
//
// Запас держим маленький: брага нужна штуки по одной под квест, а резерв нужнее рыбе и кожам.

// Только функции: число экспортируется ПОСЛЕ объявления. Ровно на этом сорвался старт драйвера
// 04.10.2026 («Cannot access BRAGA_RESERVE_COST before initialization») - тот же капкан, что уже
// был с TAN_RESERVE_COST в lib/tanning.js.
module.exports = { brewBragaInHouse };

const { getBodyText, pause } = require('./core');

const BRAGA_RESERVE_COST = 10;
module.exports.BRAGA_RESERVE_COST = BRAGA_RESERVE_COST;
const BRAGA_KEEP = Number(process.env.AI_BRAGA_KEEP || 3); // больше в сумке держать смысла нет
const NO_HOPS_RECHECK_MS = 3 * 60 * 60 * 1000; // хмель кончился - заглянуть через 3 ч
let noHopsAt = 0;

function brewingPaused() {
  return Date.now() - noHopsAt < NO_HOPS_RECHECK_MS;
}
module.exports.brewingPaused = brewingPaused;

// Сколько таких предметов в сумке. В инвентаре одиночный предмет печатается без числа, пачка - с
// числом после названия («Хмель 13»). Пока персонаж в минусе, инвентарь не открывается вовсе
// («Восстановите здоровье») - тогда возвращаем null, и варка пропускается.
async function countInInventory(page, name) {
  await page.goto('http://lbast.ru/inv.php?pack=1', { waitUntil: 'domcontentloaded', timeout: 60000 });
  const t = await getBodyText(page);
  if (/Восстановите здоровье/i.test(t)) return null;
  const re = new RegExp(`^\s*${name}\s*(?:\[i\])?\s*(\d+)?\s*$`, 'im');
  const m = t.match(re);
  if (!m) return 0;
  return m[1] ? Number(m[1]) : 1;
}

// Стоим в доме (dom.php?mod=inhouse). Варит одну брагу, если есть хмель и браги меньше запаса.
// Возвращает остаток резерва: вызывающий ведёт учёт сам, как у кухни и дубления.
async function brewBragaInHouse(page, houseUrl, reserve, minReserve) {
  if (brewingPaused()) return reserve;
  if (reserve < minReserve) return reserve;
  const hops = await countInInventory(page, 'Хмель');
  if (hops === null) return reserve; // инвентарь закрыт (персонаж в минусе)
  if (!hops) {
    noHopsAt = Date.now();
    console.log('Самогон: хмеля нет - не варю до следующего сбора.');
    return reserve;
  }
  const braga = await countInInventory(page, 'Брага');
  if (braga !== null && braga >= BRAGA_KEEP) {
    console.log(`Самогон: браги уже ${braga} (держим ${BRAGA_KEEP}) - не варю, резерв нужнее рыбе и кожам.`);
    return reserve;
  }
  await page.goto(houseUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.goto(`${houseUrl}&flag=samogon`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  const t = await getBodyText(page);
  if (/брагу/i.test(t)) {
    const left = reserve - BRAGA_RESERVE_COST;
    console.log(`Самогон: забодяжил брагу (хмеля было ${hops}, браги ${braga === null ? '?' : braga}; резерв ~${reserve} -> ~${left}).`);
    await pause(page, 600, 1200);
    return left;
  }
  if (/хмел/i.test(t)) {
    noHopsAt = Date.now();
    console.log('Самогон: аппарат просит хмель - не варю до следующего сбора.');
    return reserve;
  }
  console.log(`Самогон: не вышло: "${t.replace(/\s+/g, ' ').slice(0, 200)}"`);
  return reserve;
}
