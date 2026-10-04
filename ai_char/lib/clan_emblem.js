// Клановый герб. Паша, 26.09.2026: «раз в неделю нужно взять клановый герб и одеть его... если в
// экипировке на месте клан-вещи - пусто. В замке - активный прогресс».
//
// Механика, снятая вживую 26.09.2026:
//  - замок открывается со своей локации ссылкой «Идти к замку» -> zamok.php (прямой заход работает);
//  - zamok.php -> «Активный прогресс» (mod=active_progress) -> строка «• Клановый герб - еще 5 дн.»
//    со ссылкой go=7;
//  - клик по ней: «Вы получили клановый герб», и строка становится «еще 5 дн. /активно через 7 дн./»,
//    то есть взять можно раз в неделю - ровно как сказал Паша;
//  - в сумке предмет называется по клану: «Герб Боги войны», срок 6 дн., слот «Клан-вещь»;
//  - надетый герб дал крит 772 -> 800, уворот 801 -> 819, броня 129 -> 131.
//
// Триггером служит ПУСТОЙ слот клан-вещи, а не календарь: он честнее любого таймера - герб
// истекает сам, и как только слот опустел, самое время идти за новым.
module.exports = { takeClanEmblemIfDue };

const { S } = require('./state');
const { getBodyText, pause } = require('./core');

const OUTFIT_URL = 'http://lbast.ru/inv.php?mod=outfit';
// Конь, пункт «В клановый замок». Своё ожидание дороги, а не импорт из lib/assassins: lib/* связаны
// по кругу через module.js, и импорт функции оттуда приходит undefined (см. раскладку кода).
const CLAN_CASTLE_KONJ_URL = 'http://lbast.ru/location.php?mod=konj&lway=10';
async function goToClanCastle(page) {
  await page.goto(CLAN_CASTLE_KONJ_URL, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  for (let i = 0; i < 8; i++) {
    const t = await getBodyText(page).catch(() => '');
    if (!/В\s*пути/i.test(t)) break;
    await pause(page, 2000, 3000);
    await page.goto('http://lbast.ru/location.php', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  }
}
const PROGRESS_URL = 'http://lbast.ru/zamok.php?mod=active_progress';
const CHECK_EVERY_MS = 60 * 60 * 1000;
// «inv.php» без invMod - отдельный список страниц, не то же, что invMod=2/3 (на нём нашёлся
// Жертвенный кинжал, которого поиск по invMod не видел).
// Три вида инвентаря (обычный, invMod=2, invMod=3): герб может лежать в любом. Страницы внутри
// каждого вида добираются по ссылкам пагинации, а не угадываются номерами.
const INV_VIEWS = [
  'http://lbast.ru/inv.php',
  'http://lbast.ru/inv.php?invMod=2',
  'http://lbast.ru/inv.php?invMod=3',
];

function flat(text, limit = 300) {
  return String(text || '').replace(/\s+/g, ' ').trim().slice(0, limit);
}

// «Клан-вещь: Герб Боги войны [^] {6 дн.}» против «Клан-вещь:» и сразу следующего пункта меню.
function clanSlotItem(text) {
  const m = String(text || '').match(/Клан-вещь:\s*([^\n]*)/);
  if (!m) return null;
  const rest = m[1].replace(/Обзор оружия[\s\S]*$/, '').trim();
  return rest || '';
}

async function takeClanEmblemIfDue(page) {
  if (Date.now() - (S.lastClanEmblemCheckAt || 0) < CHECK_EVERY_MS) return false;
  S.lastClanEmblemCheckAt = Date.now();

  await page.goto(OUTFIT_URL, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  const outfit = await getBodyText(page).catch(() => '');
  const slot = clanSlotItem(outfit);
  if (slot === null) {
    console.log(`Клановый герб: строку «Клан-вещь» на экране экипировки не нашёл. Экран: ${flat(outfit)}`);
    return false;
  }
  if (slot) {
    console.log(`Клановый герб: уже надет (${slot}) - ничего не делаю.`);
    return false;
  }

  // Сначала смотрим в сумке: герб могли выдать раньше, а надеть не получиться. В замок за новым
  // идти бессмысленно - он выдаётся раз в неделю.
  if (await equipEmblemFromBag(page)) return true;
  console.log('Клановый герб: слот клан-вещи пуст -> иду в замок, активный прогресс.');
  // 04.10.2026, Паша: «а почему ты клановый герб не берешь в замке?» Потому что приходил в ЧУЖОЙ
  // замок. zamok.php показывает замок ТОЙ локации, где стоишь, а стоял AI__ где попало после
  // квестов - и экран честно отвечал «Вы стоите на руинах замка, некогда принадлежавшего клану
  // Лудос» (так с 11:21 и каждый круг). 26.09, когда механику снимали, персонаж случайно оказался
  // в нужном месте, и это приняли за «прямой заход работает».
  // Теперь сначала едем к СВОЕМУ замку: у коня для этого есть отдельный пункт «В клановый замок».
  await goToClanCastle(page);
  await page.goto(PROGRESS_URL, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  const progress = await getBodyText(page).catch(() => '');
  if (/руинах замка/i.test(progress)) {
    console.log(`Клановый герб: это чужой замок (${flat(progress, 120)}) - к своему не доехал, попробую в следующем круге.`);
    return false;
  }
  const href = await page.evaluate(() => {
    const a = Array.from(document.querySelectorAll('a')).find((x) => /Клановый герб/i.test((x.textContent || '').trim()));
    return a ? a.getAttribute('href') : null;
  }).catch(() => null);
  if (!href) {
    console.log(`Клановый герб: ссылки «Клановый герб» в активном прогрессе нет. Экран: ${flat(progress)}`);
    return false;
  }
  // «/активно через N дн./» - герб на этой неделе уже брали, второй раз игра не даст.
  if (/активно через/i.test(progress)) {
    console.log(`Клановый герб: на этой неделе уже брали (${flat(progress, 160)}) - жду срока.`);
    return false;
  }

  await page.goto(new URL(href, 'http://lbast.ru/').href, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  const got = await getBodyText(page).catch(() => '');
  if (!/получили клановый герб/i.test(got)) {
    console.log(`Клановый герб: не выдали. Экран: ${flat(got)}`);
    return false;
  }
  console.log('Клановый герб: получен, ищу в сумке и надеваю.');

  return await equipEmblemFromBag(page);
}

// Найти герб в сумке и надеть. Отдельно от получения: герб выдают раз в неделю, и если его уже
// выдали, а надеть не удалось (так вышло 04.10.2026), второй раз игра не даст - значит надевать
// надо из сумки, не ходя в замок.
async function equipEmblemFromBag(page) {
  // 04.10.2026: герб ВЗЯТ, но надеть не вышло - «в сумке ссылки Экипировать для герба не нашёл».
  // Причина: в INV_PAGES перебирались только cpage=2, а инвентарь разросся до 207 предметов и пяти
  // страниц. Теперь страницы берём не из списка наугад, а по ССЫЛКАМ пагинации самой игры -
  // сколько бы их ни стало.
  const pages = [];
  for (const base of INV_VIEWS) {
    const ok = await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 60000 }).then(() => true).catch(() => false);
    if (!ok) continue;
    pages.push(base);
    const nums = await page.evaluate(() => Array.from(document.querySelectorAll('a'))
      .filter((a) => /^[0-9]+$/.test((a.textContent || '').trim()))
      .map((a) => a.getAttribute('href')).filter(Boolean), []).catch(() => []);
    for (const h of nums) {
      const abs = new URL(h, 'http://lbast.ru/').href;
      if (!pages.includes(abs)) pages.push(abs);
    }
  }
  for (const url of pages) {
    const ok = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 }).then(() => true).catch(() => false);
    if (!ok) continue;
    const equipHref = await page.evaluate(() => {
      let lastName = '';
      for (const a of Array.from(document.querySelectorAll('a'))) {
        const t = (a.textContent || '').trim();
        // ВНИМАНИЕ: было /^Герб\b/ - и не работало НИКОГДА. \b в JS считает словом только
        // ASCII, поэтому между кириллической «б» и пробелом границы слова нет, и «Герб Боги войны»
        // не совпадал. Из-за этого 04.10.2026 герб лежал в сумке неодетым, а я искал причину в
        // страницах инвентаря. Тот же капкан уже ловил меня на \w в Штольнях.
        if (t === 'Экипировать') { if (/^Герб(?:\s|$)/i.test(lastName)) return a.getAttribute('href'); continue; }
        if (t && !/^\d+$/.test(t) && !/^(Использовать|Передать|Экипировать|Снять|Вернуть|Взять|\[i\])$/.test(t)) lastName = t;
      }
      return null;
    }).catch(() => null);
    if (!equipHref) continue;
    await page.goto(new URL(equipHref, 'http://lbast.ru/').href, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    const after = await getBodyText(page).catch(() => '');
    console.log(`Клановый герб: ${flat(after, 160)}`);
    await pause(page, 500, 900);
    return true;
  }
  console.log(`Клановый герб: ссылки «Экипировать» для герба в сумке нет (просмотрено страниц: ${pages.length}).`);
  return false;
}
