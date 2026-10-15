// Сбыт предметов заданий Ордо игрокам через объявления.
// 15.10.2026, Паша: «нужно копить сами предметы. Продавать их в объявлениях периодически. Цепи и
// медальойны». До этого (с 05.10) «Медальон бандита» и «Костяная цепь бандита» уходили в обычный
// магазин Стоунгарда за гроши. Теперь: в лавку не идут вовсе (PROTECTED_RE в lib/fish_sale.js),
// копятся в сумке, а раз в несколько часов в чат объявлений даётся одна строка.

// Экспорт стоит ДО require: файлы lib/ вызывают друг друга по кругу, а объявления функций
// всплывают (hoisting), поэтому к моменту любого встречного require все функции уже здесь.
module.exports = { runOrdoItemsAdIfDue, countOrdoTaskItems };

const fs = require('fs');
const path = require('path');
const { S } = require('./state');
const { getBodyText } = require('./core');

// Комната объявлений - room=50 («Объявления»), не Городская площадь и не клановый зал.
// Отправляет вкладка чата: мы только кладём запись в chat_outbox.json.
const ADS_ROOM = 50;
const OUTBOX_FILE = path.join(__dirname, '..', 'chat_outbox.json');

const MEDALLION_RE = /Медальон бандита\s+(\d+)/;
const CHAIN_RE = /Костяная цепь бандита\s+(\d+)/;

// Цена. Сам я покупал эти предметы у игроков по 60 за штуку (письмо Ericsson, объявление «Куплю ордо
// по 60») - значит 60 это рынок, и продавать нужно выше. Ставлю 70; меняется переменной окружения,
// решение о цене за Пашей.
const PRICE = Number(process.env.AI_ORDO_ITEM_PRICE || 70);
// Объявление имеет смысл, когда предметов заметное число: за тремя штуками никто не поедет.
const MIN_FOR_AD = Number(process.env.AI_ORDO_AD_MIN || 10);
// «Периодически» - раз в 6 часов. Чаще объявления в lbast удаляют как флуд.
const AD_INTERVAL_MS = 6 * 60 * 60 * 1000;

// Сколько предметов задания лежит в сумке. Инвентарь многостраничный, предметы могут быть на любой
// странице - читаем первые три, как это делает runOrdoMedalTurnIn.
async function countOrdoTaskItems(page) {
  let inv = '';
  for (const url of ['http://lbast.ru/inv.php', 'http://lbast.ru/inv.php?cpage=2', 'http://lbast.ru/inv.php?cpage=3']) {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    inv += await getBodyText(page).catch(() => '');
  }
  // Одна штука выводится без числа - поэтому отдельная проверка на само название.
  const one = (re, name) => {
    const m = inv.match(re);
    if (m) return Number(m[1]);
    return new RegExp(name).test(inv) ? 1 : 0;
  };
  const medallions = one(MEDALLION_RE, 'Медальон бандита');
  const chains = one(CHAIN_RE, 'Костяная цепь бандита');
  return { medallions, chains, total: medallions + chains };
}

function appendOutbox(text) {
  let items = [];
  try { items = JSON.parse(fs.readFileSync(OUTBOX_FILE, 'utf8')); } catch (e) { items = []; }
  if (!Array.isArray(items)) items = [];
  items.push({ room: ADS_ROOM, text });
  fs.writeFileSync(OUTBOX_FILE, JSON.stringify(items));
}

async function runOrdoItemsAdIfDue(page) {
  if (Date.now() - (S.ordoAdSentAt || 0) < AD_INTERVAL_MS) return false;
  const { medallions, chains, total } = await countOrdoTaskItems(page);
  if (total < MIN_FOR_AD) {
    // Молчим в Telegram и почти молчим в логе: это нормальное состояние, а не поломка.
    if (S.ordoAdSmallLoggedDay !== new Date().toLocaleDateString('ru-RU')) {
      S.ordoAdSmallLoggedDay = new Date().toLocaleDateString('ru-RU');
      console.log(`Объявление ордо: в сумке ${total} шт (медальонов ${medallions}, цепей ${chains}) - меньше ${MIN_FOR_AD}, копим.`);
    }
    return false;
  }
  S.ordoAdSentAt = Date.now();
  // Формат объявления - Пашино правило: одна строка по делу, без приписок и подписи, предметы
  // называются «ордо». Образец, который он одобрил: «Куплю ордо по 60».
  const text = `Продам ордо ${total} шт по ${PRICE}`;
  appendOutbox(text);
  console.log(`Объявление ордо: положил в outbox для room=${ADS_ROOM} - «${text}» (медальонов ${medallions}, цепей ${chains}).`);
  return true;
}
