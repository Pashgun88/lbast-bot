// Покупка Праздничного эля в Лавке боевых ресурсов Стоунгарда (Паша, 21.09.2026: «включи штольни,
// но с условием что должен быть эль. 1 купи»). 50 дин за штуку, покупка - один переход
// loc.php?obj=5117&mod=buy&go=1030 (одна штука за клик). Товар в лавке не всегда: числа в скобках -
// это остаток, его наполняют игроки. При остатке 0 экран отвечает «Товар отсутствует».
// Держим в запасе ровно один эль: он нужен на Штольни, а деньги копятся на дубильный станок.

module.exports = { buyFestiveAleIfNeeded };

const { getBodyText, pause } = require('./core');

const CHECK_EVERY_MS = 30 * 60 * 1000;
const MAX_PRICE = 100; // дороже 50 не ждём, но подорожание на десяток не повод отказываться
const ALE = 'Праздничный эль';
let lastCheckAt = 0;

async function goLinkByExactText(page, text) {
  const href = await page.evaluate((t) => {
    const a = Array.from(document.querySelectorAll('a')).find((x) => (x.innerText || '').trim() === t);
    return a ? a.getAttribute('href') : null;
  }, text).catch(() => null);
  if (!href) return false;
  await page.goto(new URL(href, page.url()).href, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await pause(page, 500, 900);
  return true;
}

async function buyFestiveAleIfNeeded(page) {
  if (Date.now() - lastCheckAt < CHECK_EVERY_MS) return false;
  lastCheckAt = Date.now();

  await page.goto('http://lbast.ru/inv.php', { waitUntil: 'domcontentloaded', timeout: 60000 });
  if (new RegExp(ALE, 'i').test(await getBodyText(page))) return false; // эль уже есть

  await page.goto('http://lbast.ru/location.php?mod=fastway&lway=2', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(6000); // перелёт
  await page.goto('http://lbast.ru/location.php', { waitUntil: 'domcontentloaded', timeout: 60000 });
  if (!(await goLinkByExactText(page, 'Магазин')) || !(await goLinkByExactText(page, 'Лавка боевых ресурсов'))) {
    console.log('Покупка эля: не нашёл Лавку боевых ресурсов - маршрут остановился.');
    return false;
  }
  const m = (await getBodyText(page)).match(/Праздничный эль\s*\[(\d+)\]\s*-\s*(\d+)\s*дин/i);
  if (!m) {
    console.log('Покупка эля: строки с Праздничным элем в лавке нет.');
    return false;
  }
  const stock = Number(m[1]);
  const price = Number(m[2]);
  if (!stock || price > MAX_PRICE) {
    console.log(`Покупка эля: в лавке ${stock} шт. по ${price} дин -> не беру (нет товара или дорого).`);
    return false;
  }
  if (!(await goLinkByExactText(page, ALE))) {
    console.log('Покупка эля: ссылка покупки не нажалась.');
    return false;
  }
  const after = await getBodyText(page);
  if (/Товар отсутствует/i.test(after)) {
    console.log('Покупка эля: товар кончился между чтением и покупкой.');
    return false;
  }
  console.log(`Покупка эля: взял 1 Праздничный эль за ${price} дин (для Штолен).`);
  await page.goto('http://lbast.ru/location.php', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  return true;
}
