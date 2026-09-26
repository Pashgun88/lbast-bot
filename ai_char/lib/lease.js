// Аренда вещей (inv.php?mod=lease). Паша, 26.09.2026: «отправил письмо от твоего имени, надеюсь
// даст в аренду, у нее не дорого» - предложение аренды приходит не письмом, а во вкладку
// «Вы арендовали вещи», и пока его не подтвердить, вещь не придёт. Ждать этого руками нельзя:
// проверяем раз в 5 минут и принимаем сами.
//
// Что известно про механику (со страницы самой игры, прочитано 26.09.2026):
//  - три вкладки: «Дать вещь в аренду», «Ваши вещи в аренде», «Вы арендовали вещи»;
//  - предложение попадает в третью вкладку ПОСЛЕ того, как владелец нажал «Дать вещи в аренду»;
//  - по истечении срока вещь уходит владельцу сама, даже надетая и даже в бою;
//  - досрочно вернуть можно только при цене аренды 0 дин, и это штраф 1000 дин.
// Браслет удачи AI__ взят именно так (у Hank, 20.09.2026, бесплатно на 15 дней).
//
// НЕ надеваем принятое сами: разрыв комплекта Ордо стоит ~115 крита и ~118 уворота (замер
// 26.09.2026, см. память aichar_build_and_gear) - что надеть, решается по мф, а не по названию.
module.exports = { acceptPendingLeasesIfAny };

const { S } = require('./state');
const { getBodyText, pause } = require('./core');
const { clickByTexts } = require('./ui');
const { sendTelegram } = require('../telegram_alerts');

const LEASE_URL = 'http://lbast.ru/inv.php?mod=lease';
// Как выглядит вкладка живьём (прочитано 26.09.2026): «* Браслет удачи (перегар) [i] еще 10 дн.
// (собственник: Hank) [Вернуть]» - то есть УЖЕ взятая вещь показывает «Вернуть». Ссылку принятия
// вживую ещё не видели, поэтому ловим несколько вариантов слова, а незнакомый набор ссылок пишем
// в лог СРАЗУ: пропустить предложение из-за неугаданного слова хуже, чем лишняя строка.
const ACCEPT_TEXTS = ['Взять', 'Принять', 'Согласиться', 'Арендовать'];
const CHECK_EVERY_MS = 5 * 60 * 1000;
// Дороже этого сам не беру: Паша сказал «у нее не дорого», значит крупная цена - это не то
// предложение, о котором речь, и решать должен он.
const MAX_LEASE_PRICE = 1500;
// Незнакомый экран показываем в лог не чаще раза в час - иначе каждые 5 минут по простыне.
const SNAPSHOT_EVERY_MS = 60 * 60 * 1000;

function snapshot(text, limit = 700) {
  return String(text || '').replace(/\s+/g, ' ').trim().slice(0, limit);
}

async function openRentedTab(page) {
  await page.goto(LEASE_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await pause(page, 600, 1200);
  // Вкладка называется «Вы арендовали вещи»; если её нет - остаёмся на общей странице.
  await clickByTexts(page, ['Вы арендовали вещи'], 'Аренда: вкладка «Вы арендовали вещи»').catch(() => {});
  await pause(page, 600, 1200);
  return getBodyText(page).catch(() => '');
}

// Цена и срок стоят в строке предложения рядом с названием; из текста берём то, что найдётся.
function readOffer(text) {
  const price = Number((text.match(/[Цц]ена аренды:?\s*(\d+)/) || text.match(/за\s+(\d+)\s*дин/) || [])[1] ?? NaN);
  const days = (text.match(/(\d+)\s*(?:дн|дней|дня|д\.)/) || [])[1];
  return { price: Number.isFinite(price) ? price : null, days: days || null };
}

async function acceptPendingLeasesIfAny(page) {
  if (Date.now() - (S.lastLeaseCheckAt || 0) < CHECK_EVERY_MS) return false;
  S.lastLeaseCheckAt = Date.now();

  const text = await openRentedTab(page);
  if (!text) return false;

  // Все ссылки вкладки: по ним и решаем, есть ли предложение, и они же - подпись экрана.
  const linkTexts = await page.evaluate(() => Array.from(document.querySelectorAll('a'))
    .map((a) => (a.textContent || '').trim()).filter(Boolean)).catch(() => []);
  const accept = ACCEPT_TEXTS.find((t) => linkTexts.includes(t));
  if (!accept) {
    const signature = linkTexts.join('|');
    const changed = signature !== S.lastLeaseLinksSignature;
    if (changed || Date.now() - (S.lastLeaseSnapshotAt || 0) > SNAPSHOT_EVERY_MS) {
      S.lastLeaseLinksSignature = signature;
      S.lastLeaseSnapshotAt = Date.now();
      console.log(`Аренда: ссылки принятия нет${changed ? ' (экран ИЗМЕНИЛСЯ)' : ''}. Экран: ${snapshot(text, 400)}`);
    }
    return false;
  }

  const offer = readOffer(text);
  if (offer.price !== null && offer.price > MAX_LEASE_PRICE) {
    console.log(`Аренда: предложение дороже ${MAX_LEASE_PRICE} дин (цена ${offer.price}) - сам не беру, решает Паша. Экран: ${snapshot(text)}`);
    await sendTelegram(`аренда: пришло предложение за ${offer.price} дин${offer.days ? ` на ${offer.days} дн.` : ''} - сам не брал, жду решения`).catch(() => {});
    return false;
  }

  console.log(`Аренда: есть предложение (цена ${offer.price ?? 'не указана'}${offer.days ? `, срок ${offer.days} дн.` : ''}) -> беру. Экран: ${snapshot(text)}`);
  const ok = await clickByTexts(page, [accept], `Аренда: ${accept}`).catch(() => false);
  await pause(page, 800, 1500);
  const after = await getBodyText(page).catch(() => '');
  if (!ok) {
    console.log(`Аренда: по ссылке «${accept}» кликнуть не удалось. Экран: ${snapshot(after)}`);
    return false;
  }
  console.log(`Аренда: после «Взять»: ${snapshot(after, 400)}`);
  // Надевать не спешим - сначала мф. Паше уходит уведомление, чтобы он знал, что вещи на руках.
  await sendTelegram(`аренда принята${offer.days ? ` (срок ${offer.days} дн.)` : ''}: ${snapshot(after, 200)}`).catch(() => {});
  return true;
}
