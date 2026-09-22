// Дубление кож в доме (Паша, 22.09.2026: «Покупка дубильный набор за 4000 дин. ты теперь можешь
// дубить шкуры»). Живая проверка 22.09.2026: дом -> «Исп. дубильный набор» - один GET выделывает
// сразу пару: «выделанная кожа бизона сушится на веревке» и «...кожа кабана...». Резерв не тратит,
// перерыва между нажатиями нет. Сырьё - «Кожа дикого бизона/кабана» с фермы.
// Как с кухней: в дом пускают только из Форпоста, ссылку жмём по href, а не наугад.

module.exports = { tanHidesIfDue };

const { getBodyText, pause } = require('./core');

const HOUSE_ID = 34309;
const CHAOS_FASTWAY = 'http://lbast.ru/location.php?mod=fastway&lway=4';
const TAN_INTERVAL_MS = 3 * 60 * 60 * 1000; // новые кожи с фермы копятся медленно
const MAX_TANS = 100; // предохранитель
let lastTanAt = 0;

async function hrefByText(page, re) {
  return page.evaluate((src) => {
    const r = new RegExp(src, 'i');
    const a = Array.from(document.querySelectorAll('a')).find((x) => r.test((x.innerText || '').trim()));
    return a ? a.getAttribute('href') : null;
  }, re.source).catch(() => null);
}

async function tanHidesIfDue(page) {
  if (Date.now() - lastTanAt < TAN_INTERVAL_MS) return false;
  lastTanAt = Date.now();

  await page.goto(CHAOS_FASTWAY, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(6000); // перелёт амулетом
  await page.goto('http://lbast.ru/location.php', { waitUntil: 'domcontentloaded', timeout: 60000 });
  const fort = await hrefByText(page, /^Форпост$/);
  if (!fort) {
    console.log('Дубление: нет ссылки «Форпост» - не в Кулаке Хаоса, пропускаю.');
    return false;
  }
  await page.goto(`http://lbast.ru/dom.php?mod=inhouse&dom_id=${HOUSE_ID}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  const tanHref = await hrefByText(page, /^Исп\. дубильный набор/);
  if (!tanHref) {
    console.log(`Дубление: в доме нет «Исп. дубильный набор»: ${(await getBodyText(page)).replace(/\s+/g, ' ').slice(0, 200)}`);
    return false;
  }
  const tanUrl = new URL(tanHref, page.url()).href;
  let bison = 0;
  let boar = 0;
  for (let i = 0; i < MAX_TANS; i++) {
    await page.goto(tanUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    const t = await getBodyText(page);
    const b1 = /кожа бизона сушится/i.test(t);
    const b2 = /кожа кабана сушится/i.test(t);
    if (!b1 && !b2) {
      if (i === 0) console.log(`Дубление: набор не сработал: ${t.replace(/\s+/g, ' ').slice(0, 200)}`);
      break;
    }
    if (b1) bison += 1;
    if (b2) boar += 1;
    await pause(page, 500, 900);
  }
  if (bison || boar) console.log(`Дубление: выделано кож бизона ${bison}, кабана ${boar}.`);
  await page.goto('http://lbast.ru/location.php', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  return bison + boar > 0;
}
