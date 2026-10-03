// Слежение за уровнем. Паша 23.09.2026: «до 8го уровня, потом нужно будет разобраться что оденем
// тебе». Значит момент взятия уровня нельзя проспать: сам драйвер статы и шмотки не трогает
// (см. чек-лист уровня - статы, руна, шмотки, тату разбираются с Пашей), но обязан громко
// доложить. Признак нового уровня - появившиеся нераспределённые статы в анкете; после перекидки
// 23.09.2026 свободных статов 0, так что любое их появление = новый уровень.
// Опыт в анкете печатается с точками как разделителем тысяч: «Опыт: 121.000 (осталось 79.000)».

module.exports = { checkLevelUpIfDue, readHealRateHere };

const { S, persistDailyQuestState } = require('./state');
const { getBodyText } = require('./core');

const PERS_URL = 'http://lbast.ru/pers.php';
const CHECK_EVERY_MS = 15 * 60 * 1000;
const EXP_LOG_EVERY_MS = 60 * 60 * 1000;
let lastCheckAt = 0;
let lastExpLogAt = 0;

async function checkLevelUpIfDue(page) {
  if (Date.now() - lastCheckAt < CHECK_EVERY_MS) return false;
  lastCheckAt = Date.now();
  const back = page.url();
  try {
    await page.goto(PERS_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    const text = await getBodyText(page);
    const m = text.match(/Опыт:\s*([\d.]+)\s*\(осталось\s*([\d.]+)\)/);
    const num = (v) => Number(String(v || '').replace(/[^\d]/g, ''));
    const exp = m ? num(m[1]) : null;
    const left = m ? num(m[2]) : null;
    const freeStats = /Свободные статы/i.test(text);
    noteLevelAndHealRate(text);

    if (freeStats && !S.levelUpReported) {
      // Одна строка, которую telegram_alerts отправляет Паше: дальше решение за ним.
      console.log('ВЗЯТ УРОВЕНЬ: есть нераспределённые статы. Паша, надо разобрать статы, руну, шмотки и тату.');
      S.levelUpReported = true;
      persistDailyQuestState();
    } else if (!freeStats && S.levelUpReported) {
      S.levelUpReported = false; // статы распределили - ждём следующего уровня
      persistDailyQuestState();
    }
    if (exp !== null && Date.now() - lastExpLogAt > EXP_LOG_EVERY_MS) {
      lastExpLogAt = Date.now();
      console.log(`Опыт: ${exp}, до уровня осталось ${left}.`);
    }
    return freeStats;
  } catch (e) {
    console.log(`Уровень: не смог прочитать анкету - ${e.message.slice(0, 80)}`);
    return false;
  } finally {
    await page.goto(back, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  }
}

// Уровень и скорость лечения из анкеты. Уровень раньше жил только словами в chat_memory/affairs.txt
// и устарел молча: 03.10.2026 Паша сказал «ты всё ещё упоминаешь что ты 7 уровень, но ты 8-й уже
// давно». Скорость лечения стояла константой 16, хотя зависит от места - в Кулаке Хаоса с
// максимальным домом она выше («лечение смотри в Кулаке Хаоса в профиле»).
function noteLevelAndHealRate(text) {
  const lv = String(text || '').match(/Уровень:\s*(\d+)/i);
  if (lv) {
    const n = Number(lv[1]);
    if (n > 0 && n !== S.charLevel) {
      console.log(`Уровень персонажа: ${n}${S.charLevel ? ` (было ${S.charLevel})` : ''}.`);
      S.charLevel = n;
      persistDailyQuestState();
    }
  }
  const hr = String(text || '').match(/Лечение:\s*(\d+)\s*hp/i);
  if (hr) {
    const n = Number(hr[1]);
    if (n > 0 && (n !== S.healRatePerMin || Date.now() - S.healRateAt > 60 * 60 * 1000)) {
      if (n !== S.healRatePerMin) console.log(`Скорость лечения: ${n} hp/мин${S.healRatePerMin ? ` (было ${S.healRatePerMin})` : ''}.`);
      S.healRatePerMin = n;
      S.healRateAt = Date.now();
      persistDailyQuestState();
    }
  }
}

// Прочитать скорость лечения ТАМ, ГДЕ СТОИМ (Паша: смотреть в Кулаке Хаоса, дом максимальный).
// Зовётся из путей лечения не чаще раза в час; возвращает hp/мин или 0.
async function readHealRateHere(page) {
  if (Date.now() - S.healRateAt < 60 * 60 * 1000) return S.healRatePerMin;
  const back = page.url();
  try {
    await page.goto(PERS_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    noteLevelAndHealRate(await getBodyText(page));
  } catch (e) {
    console.log('Скорость лечения: не прочитал анкету:', e.message);
  }
  try { if (back && /lbast\.ru/.test(back)) await page.goto(back, { waitUntil: 'domcontentloaded', timeout: 60000 }); } catch (e) { /* вернёмся сами */ }
  return S.healRatePerMin;
}
