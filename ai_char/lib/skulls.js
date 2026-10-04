// Черепа - в казну клана. Паша, 04.10.2026: «передай все черепа в казну клана по 70 дин
// Bogi_vojny», затем «отправляй раз в 2 дня». Череп падает с Молега в половине боёв
// (lib/farm.js, Гора Вейлия), в магазине стоит 2 дина - в казну уходит в 35 раз дороже.
//
// Правила, по которым это можно делать само:
//  - получатель и цена заданы Пашей и в коде не угадываются;
//  - срок 2 суток считается от УСПЕШНОЙ отправки: если черепов нет, таймер не сдвигается,
//    иначе пустой заход съедал бы двухдневное окно;
//  - цена в форме - ОБЩАЯ сумма за всю пачку, не за штуку (на этом я уже обжигался 21.09.2026);
//  - сделку принимает человек на той стороне; пока не принял, черепа остаются предложением.

module.exports = { sendSkullsIfDue };

const { S, persistDailyQuestState } = require('./state');
const { getBodyText, pause } = require('./core');

const NICK = process.env.AI_SKULL_NICK || 'Bogi_vojny';
const PRICE_PER_ITEM = Number(process.env.AI_SKULL_PRICE || 70);
const EVERY_MS = 2 * 24 * 60 * 60 * 1000;
const CHECK_EVERY_MS = 60 * 60 * 1000; // чаще страницу передачи не открываем
let lastCheckAt = 0;

async function sendSkullsIfDue(page) {
  if (Date.now() - lastCheckAt < CHECK_EVERY_MS) return false;
  if (Date.now() - (S.skullsSentAt || 0) < EVERY_MS) return false;
  lastCheckAt = Date.now();

  await page.goto(`http://lbast.ru/inv.php?lgn=${NICK}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  const page0 = await getBodyText(page).catch(() => '');
  if (/Восстановите здоровье/i.test(page0)) return false; // в минусе сумка не открывается
  const info = await page.evaluate(() => {
    const all = Array.from(document.querySelectorAll('a'));
    for (let i = 0; i < all.length; i++) {
      if (!/^Череп$/i.test((all[i].textContent || '').trim())) continue;
      let count = null;
      let pered = null;
      for (let k = i + 1; k < Math.min(i + 5, all.length); k++) {
        const t = (all[k].textContent || '').trim();
        if (/^\d+$/.test(t) && count === null) count = Number(t);
        if (t === 'Передать' && !pered) pered = all[k].getAttribute('href');
      }
      return { count, pered };
    }
    return null;
  }).catch(() => null);

  if (!info || !info.pered) return false; // черепов нет - таймер не двигаем, посмотрим через час
  const kol = info.count || 1; // одиночный предмет печатается без числа
  const total = kol * PRICE_PER_ITEM;

  await page.goto(new URL(info.pered, 'http://lbast.ru/').href, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.locator('input[name="kol"]').fill(String(kol));
  await page.locator('input[name="price"]').fill(String(total));
  await page.locator('input[name="cmnp"]').fill(`черепа с молега в казну клана, ${PRICE_PER_ITEM} за штуку`).catch(() => {});
  await Promise.all([
    page.waitForLoadState('domcontentloaded'),
    page.locator('input[type="submit"]').first().click(),
  ]);
  const got = await getBodyText(page).catch(() => '');
  if (/предложение передачи товаров отправлено/i.test(got)) {
    S.skullsSentAt = Date.now();
    persistDailyQuestState();
    console.log(`Черепа: отправил ${kol} шт в казну клана (${NICK}) за ${total} дин, по ${PRICE_PER_ITEM}. Следующий раз через 2 дня.`);
    await pause(page, 500, 900);
    return true;
  }
  console.log(`Черепа: передача не ушла: "${got.replace(/\s+/g, ' ').slice(0, 200)}"`);
  return false;
}
