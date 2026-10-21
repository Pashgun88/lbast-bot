// Дозор за бунгало (о.Дауэрти): «скребётся» и «шлёпает» - в клановый зал.
//
// Паша, 20.10.2026: «Есть определенные квесты в бунгало на острове дауэрти. Когда появляется
// задание что скребется или шлепает - проверяй каждые 8 часов и когда появляется сразу пиши в
// клан зале - скребется или шлепает или и то и то как сейчас. Когда появляется - пиши каждые
// 12 часов пока не пропадет».
//
// Два срока и зачем они разные:
//  - НЕТ задания: заглядываем раз в 8 часов. Дорога до «Событий» - это конь, корабль и несколько
//    переходов, то есть не бесплатно; чаще смысла нет, задания появляются раз в дни.
//  - ЕСТЬ задание: напоминаем в зал раз в 12 часов, и тем же заходом проверяем, не пропало ли.
//    Пропало - пишем об этом в лог и возвращаемся к восьмичасовому шагу.
// Смена состава (был только «скребётся», появился ещё и «шлёпает») - повод написать сразу, не
// дожидаясь 12 часов: в зал идёт именно то, что сейчас висит.
//
// Отправляем не напрямую, а через chat_outbox.json - как объявления (lib/ordo_ads.js): чат живёт
// в своей вкладке, и писать в него из цикла нельзя.

module.exports = { watchBungaloTasksIfDue };

const fs = require('fs');
const path = require('path');
const m = require('../module');
const { S, persistDailyQuestState } = require('../lib/state');
const { runGuide } = require('./guide_run');

const GO_FILE = path.join(__dirname, 'bungalo_go.steps');
const OUTBOX_FILE = path.join(__dirname, '..', 'chat_outbox.json');
const CLAN_HALL_ROOM = 12;
const CHECK_EVERY_MS = 8 * 60 * 60 * 1000;
const REMIND_EVERY_MS = 12 * 60 * 60 * 1000;

// Слово в сообщении - в той форме, в какой его говорит Паша: в зале поймут с полуслова.
const BUNGALO_WATCHED = [
  { key: 'скребётся', re: /скреб[её]тся/i },
  { key: 'шлёпает', re: /шл[её]па/i },
];

function appendOutbox(text) {
  let items = [];
  try { items = JSON.parse(fs.readFileSync(OUTBOX_FILE, 'utf8')); } catch (e) { /* файла нет */ }
  if (!Array.isArray(items)) items = [];
  items.push({ room: CLAN_HALL_ROOM, text });
  fs.writeFileSync(OUTBOX_FILE, JSON.stringify(items));
}

// Что сейчас предлагают в «Событиях». Разбор тот же, что в bungalo.js: i-я ссылка «Взять задание»
// относится к i-му куску текста, описание - последний пункт «* ...» в куске.
async function readOffers(page) {
  const hrefs = await page.evaluate(() => Array.from(document.querySelectorAll('a'))
    .filter((a) => (a.textContent || '').trim() === 'Взять задание')
    .map((a) => a.getAttribute('href'))).catch(() => []);
  const parts = (await m.getBodyText(page)).split('Взять задание');
  return hrefs.map((href, i) => {
    const chunk = parts[i] || '';
    return { href, text: chunk.slice(chunk.lastIndexOf('*') + 1).replace(/\s+/g, ' ').trim() };
  });
}

function phrase(keys) {
  if (keys.length === 1) return `В бунгало на Дауэрти ${keys[0]}`;
  return `В бунгало на Дауэрти ${keys.slice(0, -1).join(', ')} и ${keys[keys.length - 1]}`;
}

async function watchBungaloTasksIfDue(page) {
  const now = Date.now();
  const had = String(S.bungaloWatchKinds || '');
  const due = had
    ? now - (S.bungaloWatchPostedAt || 0) >= REMIND_EVERY_MS
    : now - (S.bungaloWatchCheckedAt || 0) >= CHECK_EVERY_MS;
  if (!due) return false;

  try { fs.unlinkSync(`${GO_FILE}.progress`); } catch (e) { /* нет */ }
  const go = await runGuide(page, GO_FILE, 0, { quietDone: true });
  if (go.status !== 'done') {
    // Дорогу не прошли - срок не двигаем, попробуем в следующем круге.
    console.log(`Бунгало-дозор: до «Событий» не дошёл (${go.status}, шаг ${go.index}).`);
    return false;
  }

  S.bungaloWatchCheckedAt = now;
  // Ищем по ВСЕМУ тексту «Событий», а не только по строкам с кнопкой «Взять задание»: 21.10.2026
  // в списке висела строка «Из бамбуковой рощи вновь слышны шорохи» вообще без кнопки, то есть
  // событие может быть видно раньше, чем его дают взять. Дозор обязан замечать его в любом виде.
  const pageText = await m.getBodyText(page).catch(() => '');
  const offers = await readOffers(page);
  const keys = BUNGALO_WATCHED.filter((w) => w.re.test(pageText)).map((w) => w.key);
  if (!keys.length && offers.length) {
    console.log(`Бунгало-дозор: в «Событиях» ${offers.length} задани(я) и ни «скребётся», ни «шлёпает» среди них нет.`);
  }
  await page.goto('http://lbast.ru/location.php', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});

  if (!keys.length) {
    if (had) console.log(`Бунгало-дозор: «${had}» больше нет в «Событиях» - дозор возвращается к проверке раз в 8 ч.`);
    S.bungaloWatchKinds = '';
    S.bungaloWatchPostedAt = 0;
    persistDailyQuestState();
    return false;
  }

  const kinds = keys.join(' и ');
  const changed = kinds !== had;
  S.bungaloWatchKinds = kinds;
  S.bungaloWatchPostedAt = now;
  persistDailyQuestState();
  const text = phrase(keys);
  appendOutbox(text);
  console.log(`Бунгало-дозор: ${changed ? 'появилось' : 'напоминаю'} «${kinds}» - в клановый зал (room=${CLAN_HALL_ROOM}): «${text}».`);
  return true;
}

// Константу экспортируем в конце: const не всплывает, в шапке это TDZ-ошибка.
module.exports.BUNGALO_WATCHED = BUNGALO_WATCHED;
