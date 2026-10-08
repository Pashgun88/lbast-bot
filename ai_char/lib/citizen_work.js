// Работа гражданина — камнетёс. Паша 08.10.2026: «Ты горожанин и у тебя есть ежедневный квест,
// спроси в чате что это и что тебе вообще делать, я сам не знаю». Спросил в клановом зале,
// подсказал Tsunami: «Ты камнетес», «Ущелье призраков … Каменоломня», «сдавать задание - стоун -
// север - север - магистратура - ратуша». Остальное разведано живьём 08.10.2026.
//
// Признак невыполненной работы виден на ЛЮБОЙ локации строкой «Вы гражданин и работа еще не
// выполнена» — это обычный текст, а не ссылка, поэтому искать её в ссылках бесполезно.
//
// Работа из двух частей:
//   1) набрать камни: Конь → Горы Дарии → «Идти на восток» → «Идти на запад» (Ущелье призраков)
//      → «Каменоломня» → «Поверхностные выработки». Ответ: «Вы набрали полный рюкзак камней,
//      надо отнести их в город».
//      ⚠ В каменоломне есть ещё «Глубинные выработки» — НЕ ТРОГАЕМ, пока Паша не решит: ущелье
//      описано как опасное (призраки), а что именно там внизу, мы не знаем.
//   2) сдать: амулет → Стоунгард → «Северные ворота» → «Идти на север - выйти из города»
//      → «Магистратура Империи» → «Ратуша». Казначей: «Вы хорошо поработали, вот ваши 210
//      динар, приходите завтра еще».
//      Ссылка севера называется «Идти на север - выйти из города», а не «Идти на север» —
//      точное сравнение тут не работает (на этом заход 08.10.2026 и сорвался первый раз).
//
// Камни в инвентарь НЕ попадают: это состояние персонажа, искать предмет бесполезно.

module.exports = { runCitizenWorkIfDue, citizenWorkPending };

const { S, getDayKeyNow, persistDailyQuestState } = require('./state');
const { getBodyText, pause } = require('./core');
const { beat } = require('./self_restart');

const STONEGARD_FASTWAY_URL = 'http://lbast.ru/location.php?mod=fastway&lway=2';
const DARII_HORSE_RE = /Горы Дарии/i;
const PENDING_RE = /Вы гражданин и работа еще не выполнена/i;
const PAID_RE = /хорошо поработали/i;

function citizenWorkPending(text) {
  return PENDING_RE.test(String(text || ''));
}

async function links(page) {
  return page.evaluate(() => Array.from(document.querySelectorAll('a'))
    .map((a) => ({ t: (a.innerText || '').trim(), h: a.getAttribute('href') || '' }))
    .filter((x) => x.t && x.h)).catch(() => []);
}

async function goLink(page, re, label, waitMs = 1000) {
  const hit = (await links(page)).find((l) => re.test(l.t));
  if (!hit) {
    console.log(`Работа гражданина: не нашёл «${label}» - прерываю, доделаю в следующем круге.`);
    return false;
  }
  await page.goto(new URL(hit.h, page.url()).href, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(waitMs);
  beat();
  return true;
}

// Набрать камни в каменоломне.
async function collectStones(page) {
  await page.goto('http://lbast.ru/location.php', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await pause(page, 500, 900);
  // Уже в ущелье? Тогда не ехать заново.
  if (!/Ущелье призраков/i.test(await getBodyText(page))) {
    if (!(await goLink(page, /^Конь$|^конь$/, 'Конь'))) return false;
    if (!(await goLink(page, DARII_HORSE_RE, 'Горы Дарии', 9000))) return false;
    await page.goto('http://lbast.ru/location.php', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await pause(page, 600, 1000);
    if (!(await goLink(page, /^Идти на восток$/, 'Идти на восток'))) return false;
    if (!(await goLink(page, /^Идти на запад$/, 'Идти на запад'))) return false;
  }
  if (!(await goLink(page, /^Каменоломня$/, 'Каменоломня'))) return false;
  if (!(await goLink(page, /Поверхностные выработки/, 'Поверхностные выработки'))) return false;
  const text = await getBodyText(page);
  if (/полный рюкзак камней/i.test(text)) {
    console.log('Работа гражданина: набрал полный рюкзак камней.');
    return true;
  }
  console.log(`Работа гражданина: в выработках ответ непонятный: ${text.replace(/\s+/g, ' ').slice(0, 200)}`);
  return false;
}

// Сдать камни в ратуше Стоунгарда.
async function deliverStones(page) {
  await page.goto(STONEGARD_FASTWAY_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(6500);
  beat();
  await page.goto('http://lbast.ru/location.php', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await pause(page, 600, 1000);
  if (!(await goLink(page, /Северные ворота/, 'Северные ворота'))) return false;
  if (!(await goLink(page, /^Идти на север/, 'Идти на север - выйти из города'))) return false;
  if (!(await goLink(page, /Магистратура/, 'Магистратура Империи'))) return false;
  if (!(await goLink(page, /^Ратуша$/, 'Ратуша'))) return false;
  const text = await getBodyText(page);
  const paid = text.match(/вот ваши\s+(\d+)\s*динар/i);
  if (PAID_RE.test(text)) {
    console.log(`Работа гражданина: сдал камни, получил ${paid ? paid[1] : '?'} дин.`);
    return true;
  }
  console.log(`Работа гражданина: в ратуше ответ непонятный: ${text.replace(/\s+/g, ' ').slice(0, 200)}`);
  return false;
}

async function runCitizenWorkIfDue(page) {
  const day = getDayKeyNow();
  if (S.citizenWorkDayKey === day) return false;

  // Источник истины - сама игра, а не наш флаг: отметка висит на каждой локации.
  await page.goto('http://lbast.ru/location.php', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  await pause(page, 400, 800);
  if (!citizenWorkPending(await getBodyText(page))) {
    // Работы нет - значит, на сегодня она закрыта (или гражданства нет). Отмечаем день.
    S.citizenWorkDayKey = day;
    persistDailyQuestState();
    return false;
  }

  console.log('Работа гражданина: не выполнена - иду в каменоломню.');
  if (!(await collectStones(page))) return false;
  if (!(await deliverStones(page))) return false;

  S.citizenWorkDayKey = day;
  persistDailyQuestState();
  return true;
}
