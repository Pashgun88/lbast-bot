// Продажа в Лавке боевых ресурсов Стоунгарда. Начиналось с жареной рыбы (Паша, 21.09.2026): «стоун - магазин - лавка боевых ресурсов - продать -
// жареная рыба - Продажа успешна. Еще (потом жмёшь ещё, пока всю не продашь)», «раз в 3 дня так
// делай, пока не пропадёт кнопка Еще». Лавка платит 32 дин за штуку (21.09.2026).
// Прежний план - магазин в своём доме по 65-79 - Паша переиграл.

module.exports = { sellFriedFishIfDue };

const { S, persistDailyQuestState } = require('./state');
const { getBodyText, pause } = require('./core');

const FISH_SALE_INTERVAL_MS = 3 * 24 * 60 * 60 * 1000;
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
  const PROTECTED_RE = /(кожа|медальон бандита|костяная цепь|кольцо|ордо|руна|эликсир|амулет|эль\b|грамота|свиток|карась|камень|камни|кинжал|тесак|меч|щит|шлем|доспех|сапоги|броня|пояс|подсумок|набор|четки|чётки|картина|часы)/i;
  const ITEM_RE = /([^\n\[]{3,60}?)\s*\[(\d+)\]\s*-\s*(\d+)\s*дин/g;
  const list = await getBodyText(page);
  ITEM_RE.lastIndex = 0;
  const offered = [];
  let mm;
  while ((mm = ITEM_RE.exec(list)) !== null) {
    offered.push({ name: mm[1].trim(), qty: Number(mm[2]), price: Number(mm[3]) });
  }
  if (!offered.length) {
    console.log('Продажа в лавке: список продажи пуст - продавать нечего.');
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
