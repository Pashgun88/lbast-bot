// Продажа в Лавке боевых ресурсов Стоунгарда. Начиналось с жареной рыбы (Паша, 21.09.2026): «стоун - магазин - лавка боевых ресурсов - продать -
// жареная рыба - Продажа успешна. Еще (потом жмёшь ещё, пока всю не продашь)», «раз в 3 дня так
// делай, пока не пропадёт кнопка Еще». Лавка платит 32 дин за штуку (21.09.2026).
// Прежний план - магазин в своём доме по 65-79 - Паша переиграл.

module.exports = { sellFriedFishIfDue, sellHidesInGeneralShop };

const { S, persistDailyQuestState } = require('./state');
const { getBodyText, pause } = require('./core');

// 26.09.2026, Паша: «я сейчас зашел в лавку боевых ресурсов и продал все что было, всегда в этой
// лавке все продавай». Раз в 3 дня - это не «всегда»: правило «продавать всё» было заведено 25.09,
// но ни разу не отработало, потому что кулдаун держал продажу до 27-го, и Паша пошёл продавать руками.
// Час - достаточно часто, чтобы сумка не копилась, и достаточно редко, чтобы не мотаться зря.
const FISH_SALE_INTERVAL_MS = 60 * 60 * 1000;
const STONEGUARD_FASTWAY = 'http://lbast.ru/location.php?mod=fastway&lway=2';
const MAX_SALES = 200; // предохранитель от бесконечного «Еще»

async function clickLinkText(page, re) {
  const href = await page.evaluate((src) => {
    const r = new RegExp(src, 'i');
    const a = Array.from(document.querySelectorAll('a')).find((x) => r.test((x.innerText || '').trim()));
    return a ? a.getAttribute('href') : null;
  }, re.source).catch(() => null);
  if (!href) return false;
  await page.goto(new URL(href, page.url()).href, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await pause(page, 600, 1100);
  return true;
}

// Клик по ссылке, чьё название начинается с заданной строки. Без регулярок: названия вещей
// содержат кавычки и скобки, и собирать из них выражение - лишний риск.
async function clickByLinkPrefix(page, prefix) {
  const href = await page.evaluate((p) => {
    const norm = (x) => (x || '').replace(/\s+/g, ' ').trim().toLowerCase();
    const a = Array.from(document.querySelectorAll('a')).find((x) => norm(x.innerText).startsWith(norm(p)));
    return a ? a.getAttribute('href') : null;
  }, prefix).catch(() => null);
  if (!href) return false;
  await page.goto(new URL(href, page.url()).href, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await pause(page, 600, 1100);
  return true;
}

async function sellFriedFishIfDue(page) {
  if (Date.now() - S.lastFishSaleAt < FISH_SALE_INTERVAL_MS) return false;

  console.log('Продажа рыбы: раз в 3 дня - Стоунгард -> Магазин -> Лавка боевых ресурсов -> Продать.');
  await page.goto(STONEGUARD_FASTWAY, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(6000); // перелёт амулетом
  await page.goto('http://lbast.ru/location.php', { waitUntil: 'domcontentloaded', timeout: 60000 });
  for (const [re, label] of [[/^Магазин$/, 'Магазин'], [/^Лавка боевых ресурсов$/, 'Лавка боевых ресурсов'], [/^Продать$/, 'Продать']]) {
    if (!(await clickLinkText(page, re))) {
      console.log(`Продажа рыбы: нет ссылки «${label}» - маршрут остановился.`);
      return false;
    }
  }
  // 25.09.2026, Паша: «в лавку куда рыбу продавать продавай всегда все что можно». Раньше здесь
  // продавалась только жареная рыба, а всё прочее копилось в сумке мёртвым грузом. Теперь продаём
  // каждую позицию из списка лавки, КРОМЕ защищённых: кожи (их дубим, Паша: «кожи не продавать»),
  // предметы заданий Ордо (из них медали и кольца), карась (сырьё для кухни), снаряжение, руны,
  // эликсиры, эль, амулеты, грамоты и свитки.
  // 26.09.2026: кожи из списка защищённых УБРАНЫ. Прежнее правило («шкуры пока не продавай, как
  // прокачаешь мораль - цена будет выше») своё отработало: мораль уже 339, и Паша сам продал в этой
  // лавке всё, что было. Защищаем только то, что прямо велено держать: предметы заданий Ордо (из них
  // медали и кольца), расходники, карася (сырьё кухни) и снаряжение.
  // ВНИМАНИЕ (сказано Паше): сырые кожи теперь тоже уходят, а они - сырьё дубления (пара за 15
  // резерва, выделанная стоит 60 против 2 за сырую). Если дубление важнее продажи - вернуть «кожа дикого».
  const PROTECTED_RE = /(медальон бандита|костяная цепь|кольцо|ордо|руна|эликсир|амулет|эль\b|грамота|свиток|карась|камень|камни|кинжал|тесак|меч|щит|шлем|доспех|сапоги|броня|пояс|подсумок|набор|четки|чётки|картина|часы)/i;
  const ITEM_RE = /([^\n\[]{3,60}?)\s*\[(\d+)\]\s*-\s*(\d+)\s*дин/g;
  // Паша, 28.09.2026: «выделаные кожи не забывай тоже продавать». Они и не продавались: список лавки
  // РАЗБИТ НА СТРАНИЦЫ (shop.php?mod=prodat&cpage=N), а читалась только первая - всё, что не попало
  // на неё, лежало в сумке мёртвым грузом. Теперь обходим страницы, пока находятся новые позиции.
  const saleUrl = page.url();
  const offered = [];
  const seenNames = new Set();
  for (let cpage = 1; cpage <= 8; cpage += 1) {
    if (cpage > 1) {
      const u = new URL(saleUrl);
      u.searchParams.set('cpage', String(cpage));
      await page.goto(u.href, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
      await pause(page, 500, 900);
    }
    const pageText = await getBodyText(page);
    ITEM_RE.lastIndex = 0;
    let found = 0;
    let mm2;
    while ((mm2 = ITEM_RE.exec(pageText)) !== null) {
      const nm = mm2[1].trim();
      if (seenNames.has(nm)) continue;
      seenNames.add(nm);
      offered.push({ name: nm, qty: Number(mm2[2]), price: Number(mm2[3]) });
      found += 1;
    }
    if (!found) break;
    console.log('Продажа в лавке: страница ' + cpage + ' - позиций ' + found + '.');
  }
  const list = await getBodyText(page);
  if (!offered.length) {
    // «Пусто» бывает двух видов: продавать действительно нечего - и разбор строк не подошёл к
    // формату страницы. Второе молчит точно так же, как первое, и способно тихо выключить продажу
    // навсегда (ровно так уже прятались пустой разбор Q-меню и шаг Рыбьего глаза). Поэтому вместе
    // с «пусто» всегда показываем сам экран - по нему видно, какой формат у строк на самом деле.
    console.log(`Продажа в лавке: список продажи пуст - продавать нечего. Экран: ${list.replace(/\s+/g, ' ').slice(0, 500)}`);
    S.lastFishSaleAt = Date.now();
    persistDailyQuestState();
    return true;
  }
  const toSell = offered.filter((it) => !PROTECTED_RE.test(it.name));
  const kept = offered.filter((it) => PROTECTED_RE.test(it.name));
  if (kept.length) {
    console.log(`Продажа в лавке: не продаю (нужны нам): ${kept.map((k) => `${k.name} x${k.qty}`).join(', ').slice(0, 200)}`);
  }
  if (!toSell.length) {
    console.log('Продажа в лавке: продавать нечего - в списке только нужные нам вещи.');
    S.lastFishSaleAt = Date.now();
    persistDailyQuestState();
    return true;
  }
  console.log(`Продажа в лавке: продаю ${toSell.map((it) => `${it.name} x${it.qty} по ${it.price}`).join('; ').slice(0, 300)}`);

  let sold = 0;
  let earned = 0;
  for (const item of toSell) {
    // Название в ссылке - без «[N] - X дин», поэтому жмём по началу названия.
    const head = item.name.slice(0, 24);
    if (!(await clickByLinkPrefix(page, head))) {
      console.log(`Продажа в лавке: ссылка «${item.name}» не нажалась - пропускаю.`);
      // Возвращаемся в список продажи, иначе следующая позиция не найдётся.
      await page.goto('http://lbast.ru/location.php', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
      for (const re of [/^Магазин$/, /^Лавка боевых ресурсов$/, /^Продать$/]) await clickLinkText(page, re);
      continue;
    }
    let n = 0;
    for (let i = 0; i < MAX_SALES; i++) {
      const t = await getBodyText(page);
      if (/товар отсутствует/i.test(t)) break;
      if (!/Продажа успешна/i.test(t)) {
        console.log(`Продажа в лавке: незнакомый ответ на «${item.name}»: ${t.replace(/\s+/g, ' ').slice(0, 160)}`);
        break;
      }
      n += 1;
      if (!(await clickLinkText(page, /^Е[щш]е$|^Ещё$/))) break;
    }
    sold += n;
    earned += n * item.price;
    console.log(`Продажа в лавке: ${item.name} - продано ${n} шт. по ${item.price} дин.`);
    // После «товар отсутствует» мы уже не в списке - возвращаемся к нему для следующей позиции.
    await page.goto('http://lbast.ru/location.php', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    for (const re of [/^Магазин$/, /^Лавка боевых ресурсов$/, /^Продать$/]) await clickLinkText(page, re);
  }
  S.lastFishSaleAt = Date.now();
  persistDailyQuestState();
  const money = (await getBodyText(page)).match(/Деньги:\s*(\d+)/);
  console.log(`Продажа в лавке: итого ${sold} шт. примерно на ${earned} дин${money ? `, денег теперь ${money[1]}` : ''}.`);
  await page.goto('http://lbast.ru/location.php', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  return sold > 0;
}


// ПРОДАЖА КОЖ В ОБЫЧНОМ МАГАЗИНЕ. Паша, 28.09.2026: «выделаные кожи не забывай тоже продавать» и
// «кожи продаются в обычном магазине». Лавка боевых ресурсов их не берёт вовсе - на её странице
// продажи было «На продажу ничего», пока в сумке лежали 23 выделанных кожи кабана и 23 бизона
// (по ~60 дин штука, то есть почти три тысячи мёртвым грузом).
//
// Сырые кожи НЕ продаём: они сырьё дубления, где цена вырастает с 2 до 60 за штуку. Если понадобится
// продавать и их - добавить сюда же «кожа дикого».
const TANNED_HIDE_RE = /выделанн[аоы][яе]\s+кожа/i;
const HIDE_SALE_INTERVAL_MS = 60 * 60 * 1000;
let lastHideSaleAt = 0;
// Сбросить таймер вручную: нужен, когда правишь маршрут и хочешь увидеть продажу сразу.
if (process.env.AI_HIDE_SALE_NOW === '1') lastHideSaleAt = 0;

async function sellHidesInGeneralShop(page) {
  if (Date.now() - lastHideSaleAt < HIDE_SALE_INTERVAL_MS) return false;
  lastHideSaleAt = Date.now();
  await page.goto(STONEGUARD_FASTWAY, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(6000);
  await page.goto('http://lbast.ru/location.php', { waitUntil: 'domcontentloaded', timeout: 60000 });
  // Паша, 28.09.2026: «стоун - магазин - продать вещи. Там кожи продаются». Именно «Продать вещи»:
  // «Продать» есть только внутри лавки боевых ресурсов, а она кожи не берёт.
  for (const [re, label] of [[/^Магазин$/, 'Магазин'], [/^Продать вещи$/, 'Продать вещи']]) {
    if (!(await clickLinkText(page, re))) {
      console.log(`Продажа кож: нет ссылки «${label}» в обычном магазине - выхожу.`);
      return false;
    }
  }
  // Формат страницы (снят живьём 28.09.2026): «Инвентарь: 1-20 из 266», позиции строками
  // «Выделанная Кожа кабана - 23 дин [i]», внизу номера страниц «1 2 3 … 14». Количества в строке
  // НЕТ - каждая вещь отдельной строкой, поэтому просто жмём по названию и потом «Ещё», как в лавке.
  const baseUrl = page.url();
  let soldTotal = 0;
  let earned = 0;
  // 46 выделанных кож в сумке 28.09.2026, продаются по одной с подтверждением - проходов нужно много.
  for (let pass = 1; pass <= 150; pass += 1) {
    let found = null;
    for (let cpage = 1; cpage <= 14; cpage += 1) {
      if (cpage > 1) {
        const u = new URL(baseUrl);
        u.searchParams.set('cpage', String(cpage));
        await page.goto(u.href, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
        await pause(page, 400, 800);
      } else if (pass > 1) {
        await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
        await pause(page, 400, 800);
      }
      const text = await getBodyText(page);
      if (!/Инвентарь:/i.test(text)) break;
      const rows = text.split(String.fromCharCode(10)).map((x) => x.trim());
      const line = rows.find((x) => TANNED_HIDE_RE.test(x) && new RegExp(String.raw`-\s*\d+\s*дин`).test(x));
      if (line) {
        const mm = line.match(new RegExp(String.raw`^(.*?)\s*-\s*(\d+)\s*дин`));
        found = { name: (mm ? mm[1] : line).trim(), price: mm ? Number(mm[2]) : 0, cpage };
        break;
      }
    }
    if (!found) break;
    if (!(await clickByLinkPrefix(page, found.name.slice(0, 24)))) {
      console.log(`Продажа кож: ссылка «${found.name}» не нажалась - выхожу.`);
      break;
    }
    let n = 0;
    for (let k = 0; k < 60; k += 1) {
      let t = await getBodyText(page);
      // Обычный магазин переспрашивает: «Вы точно хотите продать 1 шт. …? - Да - Нет» (снято живьём
      // 28.09.2026). Лавка боевых ресурсов такого не делает, поэтому подтверждения в коде не было.
      if (/Вы точно хотите продать/i.test(t)) {
        if (!(await clickLinkText(page, /^-?\s*Да$/))) {
          console.log('Продажа кож: не нашёл «Да» в подтверждении.');
          break;
        }
        t = await getBodyText(page);
      }
      if (/товар отсутствует|не найдено/i.test(t)) break;
      if (!/Продажа успешна|Вы продали/i.test(t)) {
        if (k === 0) console.log(`Продажа кож: незнакомый ответ на «${found.name}»: ${t.replace(/\s+/g, ' ').slice(0, 160)}`);
        break;
      }
      n += 1;
      if (!(await clickLinkText(page, /^Е[щш]е$|^Ещё$/))) break;
    }
    soldTotal += n;
    earned += n * found.price;
    console.log(`Продажа кож: «${found.name}» по ${found.price} дин - продано ${n} шт. (страница ${found.cpage}).`);
    if (!n) break;
    await page.goto('http://lbast.ru/location.php', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    for (const re of [/^Магазин$/, /^Продать вещи$/]) await clickLinkText(page, re);
  }
  if (soldTotal) {
    const money = (await getBodyText(page)).match(/Деньги:\s*(\d+)/);
    console.log(`Продажа кож: итого ${soldTotal} шт. примерно на ${earned} дин${money ? `, денег теперь ${money[1]}` : ''}.`);
  } else {
    console.log('Продажа кож: выделанных кож в списке магазина нет.');
  }
  await page.goto('http://lbast.ru/location.php', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  return soldTotal > 0;
}
