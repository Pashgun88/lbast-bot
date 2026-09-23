// Слежение за уровнем. Паша 23.09.2026: «до 8го уровня, потом нужно будет разобраться что оденем
// тебе». Значит момент взятия уровня нельзя проспать: сам драйвер статы и шмотки не трогает
// (см. чек-лист уровня - статы, руна, шмотки, тату разбираются с Пашей), но обязан громко
// доложить. Признак нового уровня - появившиеся нераспределённые статы в анкете; после перекидки
// 23.09.2026 свободных статов 0, так что любое их появление = новый уровень.
// Опыт в анкете печатается с точками как разделителем тысяч: «Опыт: 121.000 (осталось 79.000)».

module.exports = { checkLevelUpIfDue };

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
