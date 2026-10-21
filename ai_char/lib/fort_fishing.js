// Рыбалка в форте Жжёного листа (берег реки Журма) - НЕ та, что у кланового замка.
// Паша, 21.10.2026: «Есть рыбалка в форте жженого листа... исследовал ее и сказал как поймать как
// можно больше рыбы. Могу сказать что скорее всего зависит от того как часто нажимать на кнопки,
// но это не точно».
//
// Что это. Мини-игра Кумуса: loc.php?obj=5229 -> «Рыбачить» (go=1) -> «Ловить рыбу» (go=2).
// Десять попыток в сутки, каждая по 10 дин. Победителю дня - Поножи мастера-рыболова (срок 3 дня)
// и 1500 дин, топ-5 - жареный сом. Есть «Лидеры дня» (go=3), «История игр» (go=4), «Top-20» (go=5),
// правила у Кумуса (go=10).
//
// Как устроено (замерено 21.10.2026, 11 попыток). Внутри попытки две ссылки:
//   «Поклевка» (action=1) - продлить поклёвку на один шаг,
//   «Подсекать» (action=2) - вытащить то, что сейчас на крючке.
// Чем больше шагов, тем крупнее рыба, но тем выше шанс, что она сойдёт. На экране виден номер шага
// и «Шанс поклевки» - он и есть счётчик риска:
//   шаги 0-4  - очень высокий
//   шаги 5-7  - высокий
//   шаги 8-9  - средний
//   шаги 10-11 - невысокий
// Замеры: шаг 2 -> карась 0.32, шаг 5 -> окунь 0.48, шаг 7 -> окунь 0.46, шаг 11 -> плотва 0.83.
// Глубже 13 шагов сошли ВСЕ шесть попыток, причём и при быстрых нажатиях (0.15 с), и при медленных
// (1.3 с). Значит догадка про частоту нажатий не подтвердилась: риск растёт от ЧИСЛА шагов, а не от
// скорости. Скорость важна по другой причине: при 0.15 с игра дважды ответила «Ошибка записи
// данных», и такая попытка не засчитывается - поэтому пауза между нажатиями не меньше PRESS_GAP_MS.
// Сошедшая рыба не оставляет ни с чем: вместо неё дают рака на 0.11-0.19 кг.
//
// Отсюда стратегия по умолчанию: тянуть до шага STOP_STEP (10) и подсекать. Это около 0.8 кг за
// попытку, то есть ~8 кг в день при 10 попытках; лидеры дня берут 10-13 кг, так что запас есть, но
// он добывается риском на шагах 11-15. Каждая попытка пишется в fish_fort_log.jsonl - по этому
// журналу и будем уточнять, где именно выгодно останавливаться, вместо догадок.

module.exports = { runFortFishingIfDue, playOneCast };

const fs = require('fs');
const path = require('path');
const { S, persistDailyQuestState } = require('./state');
const { getBodyText, pause } = require('./core');

const SPOT_URL = 'http://lbast.ru/loc.php?obj=5229';
const LOG_FILE = path.join(__dirname, '..', 'fish_fort_log.jsonl');
const STOP_STEP = Number(process.env.AI_FORT_FISH_STOP || 10);
const PRESS_GAP_MS = Number(process.env.AI_FORT_FISH_GAP || 700);
const MAX_PRESSES = 30; // предохранитель: игра сама кончает попытку раньше

const dayKey = () => new Date().toLocaleDateString('ru-RU');

async function readState(page) {
  const t = (await getBodyText(page).catch(() => '')).replace(/[ \t]+/g, ' ');
  const m = t.match(/(\d+)\.\s*Шанс поклевки:\s*([^\n]+)/);
  const links = await page.$$eval('a', (as) => as.map((a) => ({
    t: (a.innerText || '').trim(), h: a.getAttribute('href'),
  }))).catch(() => []);
  return {
    text: t,
    step: m ? Number(m[1]) : null,
    chance: m ? m[2].trim() : null,
    bite: (links.find((l) => /^Поклевка$/i.test(l.t)) || {}).h || null,
    pull: (links.find((l) => /^Подсекать$/i.test(l.t)) || {}).h || null,
  };
}

async function open(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await pause(page, 250, 450);
}

// Одна попытка: тянем до stopStep, потом подсекаем. Возвращает, что получилось.
async function playOneCast(page, stopStep = STOP_STEP) {
  await open(page, `${SPOT_URL}&go=2`);
  let s = await readState(page);
  let lastChance = s.chance;
  let escaped = false;
  for (let i = 0; i < MAX_PRESSES; i += 1) {
    if (s.step !== null && s.step >= stopStep) break;
    if (!s.bite) { escaped = true; break; }
    await open(page, new URL(s.bite, SPOT_URL).href);
    await new Promise((r) => setTimeout(r, PRESS_GAP_MS));
    s = await readState(page);
    if (s.step === null) { escaped = true; break; } // рыба сошла, экран сменился
    lastChance = s.chance;
  }
  if (!escaped && s.pull) {
    await open(page, new URL(s.pull, SPOT_URL).href);
    s = await readState(page);
  }
  const tail = (s.text.split('ЖУРМА')[1] || s.text).replace(/\s+/g, ' ').trim();
  const kg = Number((tail.match(/Улов:\s*([\d.]+)\s*кг/) || [])[1]);
  const fish = (tail.match(/вытягиваете\s+([а-яё]+)/i) || tail.match(/вытащили на берег[^.]*?([а-яё]+)\./i) || [])[1] || null;
  const writeError = /Ошибка записи данных/i.test(tail);
  const row = {
    ts: new Date().toISOString(), stopStep, gapMs: PRESS_GAP_MS,
    escaped: escaped || /сорвалась рыба/i.test(tail),
    fish, kg: Number.isFinite(kg) ? kg : null, chance: lastChance, writeError,
  };
  try { fs.appendFileSync(LOG_FILE, JSON.stringify(row) + '\n'); } catch (e) { /* журнал не критичен */ }
  return row;
}

// Дорога до берега: Конь -> «Жженого листа» (в пути несколько секунд) -> ссылка «Рыбалка».
// Проверять «мы на месте» надо по ссылке, а не по названию локации: у форта несколько клеток.
async function goToFortBank(page) {
  await open(page, 'http://lbast.ru/location.php');
  const click = async (re) => {
    const href = await page.evaluate((src) => {
      const r = new RegExp(src, 'i');
      const el = Array.from(document.querySelectorAll('a')).find((x) => r.test((x.innerText || '').trim()));
      return el ? el.getAttribute('href') : null;
    }, re.source).catch(() => null);
    if (!href) return false;
    await open(page, new URL(href, 'http://lbast.ru/').href);
    return true;
  };
  if (await click(/^Рыбалка$/)) return true;            // уже стоим на берегу
  if (!(await click(/^Конь$/))) return false;
  if (!(await click(/Жженого листа/))) return false;
  for (let i = 0; i < 15; i += 1) {
    const t = await getBodyText(page).catch(() => '');
    if (!/В пути/i.test(t)) break;
    await new Promise((r) => setTimeout(r, 3000));
    await open(page, 'http://lbast.ru/location.php');
  }
  return click(/^Рыбалка$/);
}

// Сколько попыток уже сделано сегодня - по самой игре, а не по нашей записи.
async function readUsed(page) {
  await open(page, `${SPOT_URL}&go=1`);
  const t = (await getBodyText(page).catch(() => '')).replace(/[ \t]+/g, ' ');
  const m = t.match(/Рыбалка:\s*(\d+)\s*из\s*(\d+)/);
  const total = t.match(/Общий улов:\s*([\d.]+)\s*кг/);
  return { used: m ? Number(m[1]) : null, limit: m ? Number(m[2]) : null, totalKg: total ? Number(total[1]) : null };
}

async function runFortFishingIfDue(page) {
  if (S.fortFishDayKey === dayKey()) return false;
  if (!(await goToFortBank(page))) {
    console.log('Рыбалка в форте: до берега Журмы не добрался (нет ссылки «Конь», «Жженого листа» или «Рыбалка»).');
    return false;
  }
  const { used, limit, totalKg } = await readUsed(page);
  if (used === null) {
    console.log('Рыбалка в форте: страница не похожа на рыбалку - мы не на берегу Журмы.');
    return false;
  }
  if (used >= limit) {
    S.fortFishDayKey = dayKey();
    persistDailyQuestState();
    console.log(`Рыбалка в форте: попытки на сегодня кончились (${used} из ${limit}), улов ${totalKg} кг.`);
    return true;
  }

  const caught = [];
  for (let i = used; i < limit; i += 1) {
    const row = await playOneCast(page);
    caught.push(row);
    console.log(`Рыбалка в форте: попытка ${i + 1}/${limit} - ${row.escaped ? 'сошла, остался рак' : row.fish || 'улов'} ${row.kg ?? '?'} кг${row.writeError ? ' (игра ответила «Ошибка записи данных» - попытка могла не засчитаться)' : ''}.`);
  }
  const after = await readUsed(page);
  S.fortFishDayKey = dayKey();
  persistDailyQuestState();
  const sum = caught.reduce((a, r) => a + (r.kg || 0), 0);
  console.log(`Рыбалка в форте: сделал ${caught.length} попыт(ок), вытащил ${sum.toFixed(2)} кг; по игре ${after.used} из ${after.limit}, улов дня ${after.totalKg} кг. Шаг остановки ${STOP_STEP}.`);
  return true;
}

// Константу экспортируем в конце: const не всплывает, в шапке это TDZ-ошибка.
module.exports.STOP_STEP = STOP_STEP;
