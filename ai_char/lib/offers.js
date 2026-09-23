// Приём входящих передач вещей (Паша, 23.09.2026: «будут писать письма о продаже - не забывай
// принимать в инвентаре. Тебе нужно много предметов ордо»). Объявление AI__: «Куплю ордо по 60».
// Страница: inv.php?mod=offers. Каждое предложение - блок «<Вещь> Дата ... Продавец: X Покупатель: Y
// Кол-во товара: N шт. Цена сделки: P дин. Комментарий: ...» и ссылки принять/отказаться
// (inv.php?mod=offers&go=...&offer_id=...). Свои исходящие (Продавец: AI__) не трогаем.
// Принимаем только предметы заданий Ордо и только по цене не выше 60 за штуку - как в объявлении.

module.exports = { acceptOrdoOffersIfAny };

const { getBodyText, pause } = require('./core');

const OFFERS_URL = 'http://lbast.ru/inv.php?mod=offers';
// Предметы заданий Ордо экзекуторс («ордо» в разговоре): с главаря и с банды.
const ORDO_ITEM_RE = /(Медальон бандита|Костяная цепь бандита)/i;
const MAX_PRICE_PER_ITEM = 60; // цена из объявления
const MONEY_FLOOR = 200; // столько дин оставляем на расходы
const CHECK_EVERY_MS = 10 * 60 * 1000;
let lastCheckAt = 0;

// Разбирает страницу передач: для каждой ссылки «принять» берёт текст её блока.
async function readOffers(page) {
  return page.evaluate(() => {
    const out = [];
    for (const a of Array.from(document.querySelectorAll('a'))) {
      const href = a.getAttribute('href') || '';
      const text = (a.textContent || '').trim();
      if (!/mod=offers&go=/.test(href)) continue;
      if (!/^(Принять|Купить|Согласиться|Подтвердить)/i.test(text)) continue;
      // Блок предложения: поднимаемся, пока в нём не появится «Цена сделки».
      let el = a.parentElement;
      for (let i = 0; i < 6 && el && !/Цена сделки/.test(el.textContent || ''); i++) el = el.parentElement;
      out.push({ href, label: text, block: (el ? el.textContent : '').replace(/\s+/g, ' ').trim() });
    }
    return out;
  }).catch(() => []);
}

function parseBlock(block) {
  const name = (block.match(/^(.*?)\s*Дата:/) || [])[1] || '';
  const seller = (block.match(/Продавец:\s*(\S+)/) || [])[1] || '';
  const qty = Number((block.match(/Кол-во товара:\s*(\d+)/) || [])[1] || 1);
  const price = Number((block.match(/Цена сделки:\s*(\d+)/) || [])[1] || 0);
  return { name, seller, qty, price };
}

async function acceptOrdoOffersIfAny(page) {
  if (Date.now() - lastCheckAt < CHECK_EVERY_MS) return false;
  lastCheckAt = Date.now();
  await page.goto(OFFERS_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  const pageText = await getBodyText(page);
  if (!/Цена сделки/.test(pageText)) return false;
  const money = Number((pageText.match(/У вас\s+(\d+)\s+дин/) || [])[1] || 0);

  let offers = await readOffers(page);
  if (offers.length === 0) return false;
  let accepted = 0;
  let spent = 0;
  for (const offer of offers) {
    const { name, seller, qty, price } = parseBlock(offer.block);
    if (!ORDO_ITEM_RE.test(name)) {
      console.log(`Передачи: «${name}» от ${seller} за ${price} дин - это не ордо, не принимаю (жду тебя).`);
      continue;
    }
    const per = qty > 0 ? price / qty : price;
    if (per > MAX_PRICE_PER_ITEM) {
      console.log(`Передачи: «${name}» от ${seller} по ${Math.round(per)} дин за штуку - дороже объявленных ${MAX_PRICE_PER_ITEM}, не принимаю.`);
      continue;
    }
    if (money - spent - price < MONEY_FLOOR) {
      console.log(`Передачи: «${name}» за ${price} дин - денег мало (${money - spent}), оставляю на потом.`);
      continue;
    }
    await page.goto(new URL(offer.href, OFFERS_URL).href, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await pause(page, 700, 1300);
    const after = (await getBodyText(page)).replace(/\s+/g, ' ');
    console.log(`Передачи: принял «${name}» x${qty} от ${seller} за ${price} дин -> ${after.slice(0, 160)}`);
    accepted += 1;
    spent += price;
    await page.goto(OFFERS_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    offers = await readOffers(page); // список сдвинулся - перечитываем, но идём по своей копии дальше
  }
  if (accepted) console.log(`Передачи: принято ${accepted} предложение(й) на ${spent} дин.`);
  return accepted > 0;
}
