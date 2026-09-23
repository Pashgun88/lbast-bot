// «Сила крепости» в Древней крепости Грандин (Паша, 23.09.2026: «сходи на грандин, там дадут
// усиление и дин немного», «иногда в клан зале в событиях или в клан пишут что крепость принадлежит
// богам войны - тогда на след день можно взять такой бонус»).
// Маршрут, пройден вживую 23.09.2026: Амулет -> Девтаун -> «На юг, в городские предместья» ->
// «На юг, покинуть город» -> «Идти на юг» -> «Идти на восток - Древняя крепость» -> «Идти в крепость»
// -> «Сила крепости». Внутри: Владелец, Аукцион, Сила крепости, История боев, О крепости.
// Бонус суточный: взятый показывает «Увеличение силы еще действует. Осталось N мин».
// Берём только если владелец - наш клан «Боги войны»; чужая крепость бонуса не даст.
// Владелец меняется, поэтому ходим проверять каждый день (Паша: «лучше ходи каждый день проверяй»).

module.exports = { runFortressPowerIfDue };

const { S, persistDailyQuestState } = require('./state');
const { getBodyText, pause } = require('./core');
const { clickByTexts } = require('./ui');

const DEVTOWN_FASTWAY = 'http://lbast.ru/location.php?mod=fastway&lway=8';
const OUR_CLAN = 'Боги войны';
const RETRY_MS = 60 * 60 * 1000; // маршрут сбился - через час
// Крепость не всегда наша, но Паша (23.09.2026): «лучше ходи каждый день проверяй».
// Поэтому чужую крепость не откладываем на полсутки, а заглядываем каждые 3 часа.
const NOT_OURS_RETRY_MS = 3 * 60 * 60 * 1000;

async function runFortressPowerIfDue(page) {
  if (S.fortressPowerUntil && Date.now() < S.fortressPowerUntil) return false;

  await page.goto(DEVTOWN_FASTWAY, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(7000); // перелёт амулетом
  await page.goto('http://lbast.ru/location.php', { waitUntil: 'domcontentloaded', timeout: 60000 });
  const steps = ['На юг, в городские предместья', 'На юг, покинуть город', 'Идти на юг',
    'Идти на восток - Древняя крепость', 'Идти в крепость'];
  for (const step of steps) {
    if (!(await clickByTexts(page, [step], `Грандин: ${step}`))) {
      S.fortressPowerUntil = Date.now() + RETRY_MS;
      persistDailyQuestState();
      console.log(`Сила крепости: маршрут остановился на шаге «${step}».`);
      return false;
    }
    await pause(page, 500, 900);
  }
  const inside = await getBodyText(page);
  if (!inside.includes(OUR_CLAN)) {
    S.fortressPowerUntil = Date.now() + NOT_OURS_RETRY_MS; // не наша - заглянем через 3 часа
    persistDailyQuestState();
    const owner = (inside.match(/Владелец:\s*([^\n]+)/) || [])[1] || 'неизвестен';
    console.log(`Сила крепости: крепость сейчас не наша (владелец: ${owner.trim()}) - бонуса нет.`);
    await page.goto('http://lbast.ru/location.php', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    return false;
  }
  await clickByTexts(page, ['Сила крепости'], 'Грандин: Сила крепости');
  await pause(page, 700, 1200);
  const text = (await getBodyText(page)).replace(/\s+/g, ' ');
  const left = text.match(/Осталось\s+(\d+)\s*мин/i);
  if (left) {
    S.fortressPowerUntil = Date.now() + (Number(left[1]) + 2) * 60000;
    console.log(`Сила крепости: усиление уже действует, осталось ${left[1]} мин.`);
  } else {
    S.fortressPowerUntil = Date.now() + 23 * 60 * 60 * 1000;
    console.log(`Сила крепости: взял усиление - ${text.slice(0, 200)}`);
  }
  persistDailyQuestState();
  await page.goto('http://lbast.ru/location.php', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  return !left;
}
