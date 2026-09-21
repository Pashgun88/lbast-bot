// Премия Ордена Тригмагистров: 7 грамот Тригмагистрата -> 700 дин (Паша, 21.09.2026: «Орден
// Тригмагистров - за 7 грамот можно получить премию»). Проверено вживую 21.09.2026 09:19:
// Амулет -> Дорожный крест -> Цитадель Ордена Тригмагистров -> Получить премию ->
// «Получено 700 динар! Орден выражает вам благодарность за службу!». Грамоты списались все.
// Грамоты приходят с Демона озера и других заданий Ордена - по одной. Паша: «можно раз в день».

module.exports = { claimTrigPremiumIfReady };

const { getBodyText, pause } = require('./core');
const { clickByTexts, existsAnyText } = require('./ui');

const PREMIUM_GRAMOTY = 7;
const { getDayKeyNow } = require('./state');
let checkedDayKey = '';

// В инвентаре строка вида «Грамота Тригмагистрата  7»; одна штука - без числа.
function countGramoty(invText) {
  const m = String(invText).match(/Грамота Тригмагистрата[ \t]*(\d+)?/);
  if (!m) return 0;
  return m[1] ? Number(m[1]) : 1;
}

async function claimTrigPremiumIfReady(page) {
  if (checkedDayKey === getDayKeyNow()) return false;
  checkedDayKey = getDayKeyNow();

  await page.goto('http://lbast.ru/inv.php', { waitUntil: 'domcontentloaded', timeout: 60000 });
  const n = countGramoty(await getBodyText(page));
  if (n < PREMIUM_GRAMOTY) {
    await page.goto('http://lbast.ru/location.php', { waitUntil: 'domcontentloaded', timeout: 60000 });
    return false;
  }

  console.log(`Премия Ордена: грамот ${n} (нужно ${PREMIUM_GRAMOTY}) - иду в Цитадель.`);
  await page.goto('http://lbast.ru/location.php', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await clickByTexts(page, ['Амулет', 'Aмулет'], 'Премия: Амулет');
  await pause(page, 800, 1200);
  await clickByTexts(page, ['Дорожный крест'], 'Премия: Дорожный крест');
  await pause(page, 1500, 2500);
  if (!(await clickByTexts(page, ['Цитадель Ордена Тригмагистров'], 'Премия: Цитадель'))) {
    console.log('Премия Ордена: Цитадель не найдена у Дорожного креста - маршрут остановился.');
    return false;
  }
  await pause(page, 800, 1200);
  if (!(await clickByTexts(page, ['Получить премию'], 'Премия: Получить премию'))) {
    console.log('Премия Ордена: нет ссылки «Получить премию» - маршрут остановился.');
    return false;
  }
  await pause(page, 800, 1200);
  const text = await getBodyText(page);
  const got = text.match(/Получено\s+(\d+)\s+динар/);
  console.log(got ? `Премия Ордена: получено ${got[1]} дин за грамоты.` : `Премия Ордена: незнакомый ответ: ${text.replace(/\s+/g, ' ').slice(0, 200)}`);
  if (await existsAnyText(page, ['В игру'])) await clickByTexts(page, ['В игру'], 'Премия: В игру');
  return Boolean(got);
}
