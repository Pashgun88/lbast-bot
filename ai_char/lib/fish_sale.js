// Продажа жареной рыбы (Паша, 21.09.2026): «стоун - магазин - лавка боевых ресурсов - продать -
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
  const list = await getBodyText(page);
  const m = list.match(/Жареная рыба \[(\d+)\] - (\d+) дин/);
  if (!m) {
    console.log('Продажа рыбы: жареной рыбы в списке продажи нет - продавать нечего.');
    S.lastFishSaleAt = Date.now();
    persistDailyQuestState();
    return true;
  }
  console.log(`Продажа рыбы: ${m[1]} шт. по ${m[2]} дин.`);
  if (!(await clickLinkText(page, /^Жареная рыба/))) {
    console.log('Продажа рыбы: ссылка «Жареная рыба» не нажалась - маршрут остановился.');
    return false;
  }
  let sold = 0;
  for (let i = 0; i < MAX_SALES; i++) {
    const t = await getBodyText(page);
    // Живой прогон 21.09.2026: после последней рыбы «Еще» ведёт на «Данный товар отсутствует у вас».
    if (/товар отсутствует/i.test(t)) break;
    if (!/Продажа успешна/i.test(t)) {
      console.log(`Продажа рыбы: незнакомый ответ: ${t.replace(/\s+/g, ' ').slice(0, 200)}`);
      break;
    }
    sold += 1;
    if (!(await clickLinkText(page, /^Е[щш]е$|^Ещё$/))) break; // кнопки «Еще» нет - рыба кончилась
  }
  S.lastFishSaleAt = Date.now();
  persistDailyQuestState();
  const money = (await getBodyText(page)).match(/Деньги:\s*(\d+)/);
  console.log(`Продажа рыбы: продано ${sold} шт. (по ${m[2]} дин)${money ? `, денег теперь ${money[1]}` : ''}.`);
  await page.goto('http://lbast.ru/location.php', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  return sold > 0;
}
