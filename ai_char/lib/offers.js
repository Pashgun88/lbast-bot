// Приём входящих передач вещей (Паша, 23.09.2026: «будут писать письма о продаже - не забывай
// принимать в инвентаре. Тебе нужно много предметов ордо»). Объявление AI__: «Куплю ордо по 60».
// Страница: inv.php?mod=offers. Каждое предложение - блок «<Вещь> Дата ... Продавец: X Покупатель: Y
// Кол-во товара: N шт. Цена сделки: P дин. Комментарий: ...» и ссылки принять/отказаться
// (inv.php?mod=offers&go=...&offer_id=...). Свои исходящие (Продавец: AI__) не трогаем.
// Принимаем только предметы заданий Ордо и только по цене не выше 60 за штуку - как в объявлении.

module.exports = { acceptOrdoOffersIfAny, parseOffers };

const { getBodyText, pause } = require('./core');
const { SELF_NICK } = require('./state');

const OFFERS_URL = 'http://lbast.ru/inv.php?mod=offers';
// Предметы заданий Ордо экзекуторс («ордо» в разговоре): с главаря и с банды.
const ORDO_ITEM_RE = /(Медальон бандита|Костяная цепь бандита)/i;
// 23.09 Паша сказал не покупать («комплект уже собран»), а 24.09.2026 - снова покупать:
// «тебе нужно собрать 5 колец ордо, с него крафтится кольцо крутое. Так что нужно будет ещё
// покупать ордо». Предметы задания -> медали -> случайная вещь Ордо, и кольца надо набрать пять.
// 24.09.2026, колец 4/5: «останови покупку, дальше сами выбьем» - остаток добиваем заданиями Ордо.
// 24.09.2026: «останови покупку» было сказано под мой неверный доклад «колец 4-5 из 5». Колец на
// самом деле два (счётчик считал одно и то же по три раза), и Паша вернул закупку: «нет включи
// обратно. Я сказал выключить когда ты сказал что есть 5 колец». Цель по-прежнему RING_GOAL колец,
// и код сам перестанет скупать, когда их станет пять.
const ORDO_BUYING_ENABLED = true;
const MAX_PRICE_PER_ITEM = 60; // цена из объявления
// Паша 23.09.2026: «если кто-то передаст ордо - покупай сколько денег хватит пока не соберёшь
// комплект». Значит верхнего предела по количеству нет, а от денег оставляем только на эль и
// эликсиры (дневной расход), всё остальное уходит на предметы задания.
const MONEY_FLOOR = 150;
const CHECK_EVERY_MS = 10 * 60 * 1000;
let lastCheckAt = 0;

// Цель 24.09.2026 (Паша): собрать ПЯТЬ «Кольцо ордо экзекуторс» - из них крафтится сильное кольцо.
// Вещи Ордо приходят только из обмена медалей (8 медалей = СЛУЧАЙНАЯ вещь комплекта), поэтому
// предметы задания нужны без счёта, пока колец меньше пяти. Считаем и надетое, и то, что в сумке.
const RING_RE = /кольцо ордо экзекуторс/i;
const RING_GOAL = 5;
const RINGS_RECHECK_MS = 30 * 60 * 1000;
let ringsCheckedAt = 0;
let ringsOwned = 0;

// Сколько колец на руках. Паша 24.09.2026: «где 5 колец, у тебя одно в инвентаре и одно на тебе», а
// счётчик рапортовал 4 из 5. Причина: `invMod=2&cpage=2` и `cpage=3` при отсутствии второй страницы
// отдают ТУ ЖЕ первую, и одно кольцо из сумки посчиталось трижды (плюс надетое - ровно «4»).
// Теперь страницу с уже виденным набором вещей отбрасываем, а в лог пишем, где какое кольцо нашлось,
// чтобы число можно было проверить глазами.
async function countOrdoRings(page) {
  if (Date.now() - ringsCheckedAt < RINGS_RECHECK_MS) return ringsOwned;
  const back = page.url();
  let total = 0;
  const seenPages = new Set();
  const found = [];
  for (const url of ['http://lbast.ru/inv.php?mod=outfit', 'http://lbast.ru/inv.php?invMod=2',
    'http://lbast.ru/inv.php?invMod=2&cpage=2', 'http://lbast.ru/inv.php?invMod=2&cpage=3']) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      const text = await getBodyText(page);
      // Подпись страницы - только строки вещей, без часов и счётчиков шапки: они меняются каждую
      // секунду, и одинаковые страницы выглядели бы разными.
      const signature = text.split('\n').filter((l) => /\[\d+\]|Экипировать|Снять/.test(l)).join('|');
      if (signature && seenPages.has(signature)) {
        console.log(`Кольца Ордо: ${url} повторяет предыдущую страницу - дальше не считаю.`);
        break;
      }
      if (signature) seenPages.add(signature);
      for (const line of text.split('\n')) {
        if (!RING_RE.test(line)) continue;
        const n = Number((line.match(/(\d+)\s*$/) || [])[1] || 1);
        const add = Number.isFinite(n) && n > 0 && n < 50 ? n : 1;
        total += add;
        found.push(`${url.includes('outfit') ? 'на себе' : 'в сумке'} ${line.trim().slice(0, 50)} (+${add})`);
      }
    } catch (e) { /* страницы может не быть */ }
  }
  ringsOwned = total;
  ringsCheckedAt = Date.now();
  console.log(`Кольца Ордо: насчитал ${total}${found.length ? ' - ' + found.join('; ') : ''}`);
  await page.goto(back, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  return ringsOwned;
}

// Разбор страницы передач. Первая версия поднималась от ссылки «Принять» по родителям, пока в
// тексте не встретится «Цена сделки» - и на живой странице 23.09.2026 доползла до контейнера со
// ВСЕЙ страницей: в лог ушло «название» из скриптов шапки на полторы тысячи знаков. Пока покупка
// была выключена, это было просто некрасиво; с включённой покупкой так недолго заплатить за не то.
// Поэтому разбираем текст страницы по описанию предложения, а ссылки сопоставляем по порядку,
// и всё, что распарсилось подозрительно, не принимаем.
// Регулярка ЛИТЕРАЛОМ, а не строкой: в строке '\s' превращается в 's', и первый вариант молча
// искал буквы s, S, d вместо классов - ни одно предложение не распозналось бы.
const OFFER_RE = /([^\n]{2,60}?)\s*Дата:[\s\S]{0,200}?Продавец:\s*(\S+)[\s\S]{0,300}?Кол-во товара:\s*(\d+)[\s\S]{0,200}?Цена сделки:\s*(\d+)/g;
const MAX_QTY = 20;

// Ссылки «Принять» в порядке документа - в том же порядке, что и описания предложений.
async function readAcceptLinks(page) {
  return page.evaluate(() => Array.from(document.querySelectorAll('a'))
    .filter((a) => /mod=offers&go=/.test(a.getAttribute('href') || ''))
    .filter((a) => /^(Принять|Купить|Согласиться|Подтвердить)/i.test((a.textContent || '').trim()))
    .map((a) => ({ href: a.getAttribute('href'), label: (a.textContent || '').trim() }))).catch(() => []);
}

function parseOffers(pageText) {
  const out = [];
  OFFER_RE.lastIndex = 0;
  let m;
  while ((m = OFFER_RE.exec(pageText)) !== null) {
    out.push({
      name: m[1].trim(), seller: m[2].trim(), qty: Number(m[3]), price: Number(m[4]),
    });
  }
  return out;
}

// 25.09.2026, Паша: «письмо системное ты мне переслал но предметы не принял почемуто». Принимали
// РОВНО ОДНО предложение за проход (после приёма список сдвигается, и сопоставление описаний с
// кнопками ломается), а проход - раз в 10 минут. Galla выставила медальоны и цепи: медальоны ушли в
// 10:36, цепи только в 10:48. Теперь забираем всё за один заход: после каждого приёма перечитываем
// страницу заново и берём следующее, пока есть что брать и хватает денег.
async function acceptOrdoOffersIfAny(page) {
  if (Date.now() - lastCheckAt < CHECK_EVERY_MS) return false;
  lastCheckAt = Date.now();
  let acceptedTotal = 0;
  let spentTotal = 0;
  for (let round = 0; round < MAX_ACCEPTS_PER_PASS; round++) {
    const r = await acceptOneOrdoOffer(page);
    if (!r.accepted) break;
    acceptedTotal += 1;
    spentTotal += r.price;
  }
  if (acceptedTotal > 1) {
    console.log(`Передачи: за этот заход принято ${acceptedTotal} предложений на ${spentTotal} дин.`);
  }
  return acceptedTotal > 0;
}

const MAX_ACCEPTS_PER_PASS = 10;

async function acceptOneOrdoOffer(page) {
  await page.goto(OFFERS_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  const pageText = await getBodyText(page);
  if (!/Цена сделки/.test(pageText)) return { accepted: false, price: 0 };
  const money = Number((pageText.match(/У вас\s+(\d+)\s+дин/) || [])[1] || 0);

  const links = await readAcceptLinks(page);
  const offers = parseOffers(pageText);
  if (!links.length || !offers.length) return { accepted: false, price: 0 };
  if (links.length !== offers.length) {
    console.log(`Передачи: ${offers.length} описаний и ${links.length} кнопок «Принять» - не берусь сопоставлять, ничего не принимаю.`);
    return { accepted: false, price: 0 };
  }
  if (!ORDO_BUYING_ENABLED) {
    for (const o of offers) console.log(`Передачи: лежит «${o.name}» x${o.qty} от ${o.seller} за ${o.price} дин - по приказу Паши ничего не принимаю.`);
    return { accepted: false, price: 0 };
  }
  const hasOrdo = offers.some((o) => ORDO_ITEM_RE.test(o.name) && o.seller !== SELF_NICK);
  if (!hasOrdo) {
    for (const o of offers) {
      if (o.seller === SELF_NICK) continue; // своё исходящее предложение
      console.log(`Передачи: «${o.name}» от ${o.seller} за ${o.price} дин - это не ордо, не принимаю (жду тебя).`);
    }
    return { accepted: false, price: 0 };
  }
  const rings = await countOrdoRings(page);
  if (rings >= RING_GOAL) {
    console.log(`Передачи: колец Ордо уже ${rings} из ${RING_GOAL} - на крафт хватает, больше не скупаю.`);
    return { accepted: false, price: 0 };
  }
  console.log(`Передачи: колец Ордо ${rings}/${RING_GOAL} - беру предметы задания, пока хватает денег.`);

  let accepted = 0;
  let spent = 0;
  for (let i = 0; i < offers.length; i++) {
    const { name, seller, qty, price } = offers[i];
    if (seller === SELF_NICK) continue; // своё исходящее - не трогаем
    if (!ORDO_ITEM_RE.test(name)) {
      console.log(`Передачи: «${name}» от ${seller} за ${price} дин - это не ордо, не принимаю (жду тебя).`);
      continue;
    }
    if (!(qty > 0 && qty <= MAX_QTY) || !(price >= 0)) {
      console.log(`Передачи: «${name}» разобралось странно (кол-во ${qty}, цена ${price}) - не принимаю.`);
      continue;
    }
    const per = price / qty;
    if (per > MAX_PRICE_PER_ITEM) {
      console.log(`Передачи: «${name}» от ${seller} по ${Math.round(per)} дин за штуку - дороже объявленных ${MAX_PRICE_PER_ITEM}, не принимаю.`);
      continue;
    }
    if (money - spent - price < MONEY_FLOOR) {
      console.log(`Передачи: «${name}» за ${price} дин не осилил - на руках ${money - spent} дин, ниже ${MONEY_FLOOR} не опускаюсь (эль и эликсиры).`);
      continue;
    }
    await page.goto(new URL(links[i].href, OFFERS_URL).href, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await pause(page, 700, 1300);
    let after = (await getBodyText(page)).replace(/\s+/g, ' ');
    // 24.09.2026: игра спрашивает «Вы уверены что хотите...» - подтверждения в коде не было, и
    // сделка так и висела на вопросе (в логе это выглядело как удачный приём). Жмём подтверждение
    // и только потом считаем передачу принятой.
    // Кнопка подтверждения на этой странице называется «Купить» (живьём 24.09.2026: ссылки были
    // «Передачи | Купить | Вернуться», где «Вернуться» - отказ).
    if (/Вы уверены/i.test(after)) {
      const confirms = await page.evaluate(() => Array.from(document.querySelectorAll('a'))
        .map((a) => ({ href: a.getAttribute('href') || '', label: (a.textContent || '').trim() }))
        .filter((x) => /mod=offers/.test(x.href))).catch(() => []);
      const pick = confirms.find((c) => /^(Да|Подтвердить|Принять|Купить|Согласен|Согласиться)/i.test(c.label));
      if (!pick) {
        console.log(`Передачи: «${name}» спросило подтверждение, а кнопки не нашлось. Ссылки: ${confirms.map((c) => c.label).join(' | ').slice(0, 200)}`);
        continue;
      }
      console.log(`Передачи: подтверждаю «${name}» кнопкой «${pick.label}».`);
      await page.goto(new URL(pick.href, OFFERS_URL).href, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await pause(page, 700, 1300);
      after = (await getBodyText(page)).replace(/\s+/g, ' ');
      if (/Вы уверены/i.test(after)) {
        console.log(`Передачи: «${name}» так и осталось на подтверждении -> ${after.slice(0, 160)}`);
        continue;
      }
    }
    console.log(`Передачи: принял «${name}» x${qty} от ${seller} за ${price} дин -> ${after.slice(0, 160)}`);
    accepted += 1;
    spent += price;
    ringsCheckedAt = 0; // следующая проверка колец - заново
    // Список после принятия сдвигается, поэтому дальше в этом заходе не идём: остальное возьмём
    // в следующей проверке через 10 минут, уже по свежей странице.
    break;
  }
  if (accepted) console.log(`Передачи: принято ${accepted} предложение(й) на ${spent} дин.`);
  return { accepted: accepted > 0, price: spent };
}
