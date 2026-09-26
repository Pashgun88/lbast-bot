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
module.exports = { acceptPendingLeasesIfAny, readCombatStats, equipItemByNamePrefix };

const { S, NO_FIGHT_FLAG_PATH } = require('./state');
const fs = require('fs');
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
// Сколько всего готов отдать за один заход: у златы две вещи по 300, но лимит нужен от случая,
// когда кто-то выставит десяток дорогих предложений.
const MAX_LEASE_TOTAL = 5000;
const MAX_ACCEPTS = 10;
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


// Мф до и после надевания: только по этим числам видно, лучше стало или хуже. Замер 26.09.2026 с
// Маской призрака показал, что «по описанию лучше» и «в бою лучше» - разные вещи.
async function readCombatStats(page) {
  await page.goto('http://lbast.ru/pers.php', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  const t = await getBodyText(page).catch(() => '');
  const num = (re) => { const m = t.match(re); return m ? Number(m[1]) : null; };
  return {
    krit: num(/Крит:\s*(\d+)/),
    uvorot: num(/Уворот:\s*(\d+)/),
    armor: num(/Броня:\s*(\d+)/),
    hpMax: num(/\(\s*-?\d+\s*\/\s*(\d+)\s*\)/),
  };
}

function formatStats(s) {
  return `крит ${s.krit ?? '?'}, уворот ${s.uvorot ?? '?'}, броня ${s.armor ?? '?'}, HP max ${s.hpMax ?? '?'}`;
}


// «Экипировать» относим к ближайшему предыдущему названию (тот же приём, что в lib/recovery.js для
// эликсиров): в строке инвентаря имя и действие - разные ссылки, а имён на странице много.
const INV_PAGES = [
  'inv.php?invMod=2', 'inv.php?invMod=2&cpage=2', 'inv.php?invMod=2&cpage=3',
  'inv.php?invMod=3', 'inv.php?invMod=3&cpage=2',
];
async function equipItemByNamePrefix(page, name, label = 'Аренда') {
  for (const url of INV_PAGES) {
    const ok = await page.goto(`http://lbast.ru/${url}`, { waitUntil: 'domcontentloaded', timeout: 60000 })
      .then(() => true).catch(() => false);
    if (!ok) continue;
    const href = await page.evaluate((n) => {
      let lastName = '';
      for (const a of Array.from(document.querySelectorAll('a'))) {
        const t = (a.textContent || '').trim();
        if (t === 'Экипировать') { if (lastName.startsWith(n)) return a.getAttribute('href'); continue; }
        if (t && !/^\d+$/.test(t) && !/^(Использовать|Передать|Экипировать|Снять|Вернуть|Взять)$/.test(t)) lastName = t;
      }
      return null;
    }, name).catch(() => null);
    if (!href) continue;
    const full = href.startsWith('http') ? href : `http://lbast.ru/${href.replace(/^\//, '')}`;
    await page.goto(full, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    const after = await getBodyText(page).catch(() => '');
    // Игра отказывает текстом «Ваших статов нехватает для экипировки данного предмета» - это не сбой.
    if (/нехватает для экипировки/i.test(after)) {
      console.log(`${label}: «${name}» не надеть - не хватает статов: ${snapshot(after, 300)}`);
      return false;
    }
    console.log(`${label}: надел «${name}».`);
    return true;
  }
  console.log(`${label}: «${name}» в инвентаре со ссылкой «Экипировать» не нашёл (уже надета?).`);
  return false;
}

// Паша, 26.09.2026: «как только злата ответит бери шмот и одевай и продолжай фармить как обычно».
// Снятие no_fight.flag возвращает режим 'all': бои без ограничений, порог HP снова 70%, а
// TOO_STRONG_SINGLE_BOTS (Драбас, Ордо-главарь) снова разрешены.
function resumeNormalFighting(reason) {
  try {
    if (!fs.existsSync(NO_FIGHT_FLAG_PATH)) return false;
    fs.unlinkSync(NO_FIGHT_FLAG_PATH);
    console.log(`Бои снова без ограничений: ${reason} (файл no_fight.flag удалён).`);
    return true;
  } catch (e) {
    console.log(`Не смог снять no_fight.flag: ${e.message}`);
    return false;
  }
}

// Предложения на вкладке: «* Взять в аренду Дубина циклопа (камень) на 30 дн. за 300 дин. [i]»
// Уже взятое: «* Браслет удачи (перегар) [i] еще 10 дн. (собственник: Hank) [Вернуть]»
// Оба вида ищем по всему тексту, а не по началу строки: вся вкладка приходит одной строкой, и
// первая версия с якорем ^ прочитала «список не прочитался» при двух вещах на руках.
const OFFER_RE = /Взять в аренду\s+([^*\[]{3,60}?)\s+на\s+(\d+)\s*дн\.\s*за\s*(\d+)\s*дин/gi;
const RENTED_RE = /\*\s*([^*\[]{3,60}?)\s*\[i\]\s*ещ[её]\s*(\d+)\s*дн/gi;

function parseOffers(text) {
  const out = [];
  OFFER_RE.lastIndex = 0;
  let m;
  while ((m = OFFER_RE.exec(String(text || ''))) !== null) {
    out.push({ name: m[1].trim(), days: Number(m[2]), price: Number(m[3]) });
  }
  return out;
}

function parseRentedNames(text) {
  const out = [];
  RENTED_RE.lastIndex = 0;
  let m;
  while ((m = RENTED_RE.exec(String(text || ''))) !== null) {
    const name = m[1].trim();
    if (!out.includes(name)) out.push(name);
  }
  return out;
}

async function acceptPendingLeasesIfAny(page) {
  if (Date.now() - (S.lastLeaseCheckAt || 0) < CHECK_EVERY_MS) return false;
  S.lastLeaseCheckAt = Date.now();

  let text = await openRentedTab(page);
  if (!text) return false;

  let offers = parseOffers(text);
  if (!offers.length) {
    // Ссылок принятия нет - либо предложений нет, либо формат страницы сменился. Второе обязано
    // быть видно сразу: пропустить предложение дороже лишней строки в логе.
    const linkTexts = await page.evaluate(() => Array.from(document.querySelectorAll('a'))
      .map((a) => (a.textContent || '').trim()).filter(Boolean)).catch(() => []);
    const hasAcceptLink = ACCEPT_TEXTS.some((t) => linkTexts.includes(t));
    const signature = linkTexts.join('|');
    const changed = signature !== S.lastLeaseLinksSignature;
    if (hasAcceptLink) {
      console.log(`Аренда: ссылка принятия есть, а строку предложения не разобрал - смотрю глазами. Экран: ${snapshot(text, 600)}`);
    } else if (changed || Date.now() - (S.lastLeaseSnapshotAt || 0) > SNAPSHOT_EVERY_MS) {
      S.lastLeaseLinksSignature = signature;
      S.lastLeaseSnapshotAt = Date.now();
      console.log(`Аренда: предложений нет${changed ? ' (экран ИЗМЕНИЛСЯ)' : ''}. Экран: ${snapshot(text, 400)}`);
    }
    if (!hasAcceptLink) return false;
  }

  console.log(`Аренда: предложений ${offers.length}: ${offers.map((o) => `${o.name} (${o.days} дн., ${o.price} дин)`).join('; ')}`);

  // Паша, 26.09.2026: «ты взял только дубину, возьме все». Берём ВСЕ предложения по очереди:
  // каждая ссылка «Взять» относится к своей вещи, и после клика страница возвращается к списку
  // с оставшимися. Ограничения оставляем только денежные.
  const taken = [];
  let spent = 0;
  for (let i = 0; i < MAX_ACCEPTS; i++) {
    text = await openRentedTab(page);
    offers = parseOffers(text);
    if (!offers.length) break;
    const next = offers[0];
    if (next.price > MAX_LEASE_PRICE) {
      console.log(`Аренда: «${next.name}» за ${next.price} дин дороже ${MAX_LEASE_PRICE} - сам не беру, решает Паша.`);
      await sendTelegram(`аренда: «${next.name}» за ${next.price} дин - дороже порога, не брал, жду решения`).catch(() => {});
      break;
    }
    if (spent + next.price > MAX_LEASE_TOTAL) {
      console.log(`Аренда: на «${next.name}» (${next.price}) уже не хватает лимита захода (${MAX_LEASE_TOTAL} дин) - останавливаюсь.`);
      break;
    }
    const ok = await clickByTexts(page, ACCEPT_TEXTS, `Аренда: беру «${next.name}»`).catch(() => false);
    await pause(page, 800, 1500);
    const after = await getBodyText(page).catch(() => '');
    if (!ok || !/успешно взяли в аренду/i.test(after)) {
      console.log(`Аренда: «${next.name}» взять не удалось. Экран: ${snapshot(after, 300)}`);
      break;
    }
    taken.push(next);
    spent += next.price;
    console.log(`Аренда: взял «${next.name}» на ${next.days} дн. за ${next.price} дин.`);
  }

  if (!taken.length) return false;

  // Паша: «и потом одень все». Надеваем каждую вещь, что лежит арендованной, и пишем мф до/после -
  // решение принято, но цифры нужны: разрыв комплекта Ордо стоил 115 крита и 118 уворота (26.09).
  const before = await readCombatStats(page);
  const rented = parseRentedNames(await openRentedTab(page));
  console.log(`Аренда: арендованного на руках - ${rented.length ? rented.join(', ') : 'список не прочитался'}`);
  let wornCount = 0;
  for (const name of rented) {
    if (await equipItemByNamePrefix(page, name)) wornCount += 1;
    await pause(page, 500, 900);
  }
  const afterStats = await readCombatStats(page);
  console.log(`Аренда: мф было ${formatStats(before)}; стало ${formatStats(afterStats)} (надето вещей: ${wornCount} из ${rented.length}).`);

  if (wornCount > 0) resumeNormalFighting('арендованный шмот надет');
  await sendTelegram(
    `аренда: взял ${taken.map((t) => `${t.name} (${t.days} дн., ${t.price} дин)`).join('; ')} на ${spent} дин.`
    + ` Надето ${wornCount} из ${rented.length}. Мф: было ${formatStats(before)}; стало ${formatStats(afterStats)}.`
    + (wornCount > 0 ? ' Бои снова без ограничений.' : ' Надеть не удалось - бои пока ограничены.'),
  ).catch(() => {});
  return true;
}
