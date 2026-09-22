// «Задание в бунгало» (о.Дауэрти): раз в 4-6 дней в «Событиях» бунгало появляются задания случайного
// типа (келпи, бестия, термиты, пираты...). Паша, 22.09.2026: «делай» - встроить в цикл драйвера.
// Берём только задания с маршрутом, пройденным вживую (BUNGALO_ROUTES); незнакомый тип - только в лог,
// его сначала проходят вручную и дописывают сюда. Кнопки «Взять задание» у всех одинаковые, поэтому
// ссылку берём из той же строки, где текст задания, а не первую попавшуюся.
const fs = require('fs');
const path = require('path');
const m = require('../module');
const { runGuide } = require('./guide_run');

const BUNGALO_QUEST = 'Задание в бунгало';
const GO_FILE = path.join(__dirname, 'bungalo_go.steps');
const BUNGALO_ROUTES = [
  { re: /келпи/i, file: 'bungalo_kelpi.steps', label: 'келпи' },
  { re: /болотная бестия/i, file: 'bungalo_bestia.steps', label: 'болотная бестия' },
  // Маршрут после двери не проверен вживую (задания ещё не было) - первый прогон может встать.
  { re: /скреб[её]тся/i, file: 'bungalo_skreb.steps', label: 'кто-то скребётся' },
];
const RETRY_MS = 60 * 60 * 1000;
let suppressedUntil = 0;
const unknownLogged = new Set();

function clearProgress(file) {
  try { fs.unlinkSync(`${file}.progress`); } catch { /* нет */ }
}

async function runBungaloTaskIfAvailable(page) {
  if (Date.now() < suppressedUntil) return false;
  if (!(await m.resetToQuestMenu(page))) return false;
  if (!(await m.getBodyText(page)).includes(BUNGALO_QUEST)) return false;
  suppressedUntil = Date.now() + RETRY_MS; // любой исход - не чаще раза в час

  await page.goto('http://lbast.ru/pers.php', { waitUntil: 'domcontentloaded', timeout: 60000 });
  if (/Текущее задание:[^\n]*отказаться/i.test(await m.getBodyText(page))) {
    suppressedUntil = Date.now() + 20 * 60000;
    console.log('Бунгало: слот задания занят другим квестом -> проверю через 20 мин.');
    return false;
  }

  clearProgress(GO_FILE);
  const go = await runGuide(page, GO_FILE, 0, { quietDone: true });
  if (go.status !== 'done') {
    console.log(`Бунгало: дорога до «Событий» не пройдена (${go.status}, шаг ${go.index}) - маршрут остановился.`);
    return false;
  }
  // i-я ссылка «Взять задание» относится к i-му куску текста страницы, разрезанного по этим словам;
  // описание задания - последний пункт «* ...» в куске.
  const hrefs = await page.evaluate(() => Array.from(document.querySelectorAll('a'))
    .filter((a) => (a.textContent || '').trim() === 'Взять задание')
    .map((a) => a.getAttribute('href'))).catch(() => []);
  const parts = (await m.getBodyText(page)).split('Взять задание');
  const offers = hrefs.map((href, i) => {
    const chunk = parts[i] || '';
    const text = chunk.slice(chunk.lastIndexOf('*') + 1).replace(/\s+/g, ' ').trim();
    return { href, text };
  });
  if (hrefs.length !== parts.length - 1) {
    console.log(`Бунгало: ссылок «Взять задание» ${hrefs.length}, а в тексте ${parts.length - 1} - не рискую.`);
    return false;
  }

  let pick = null;
  for (const o of offers) {
    const route = BUNGALO_ROUTES.find((r) => r.re.test(o.text));
    if (route) { pick = { ...o, route }; break; }
    const key = o.text.slice(0, 80);
    if (!unknownLogged.has(key)) {
      unknownLogged.add(key);
      console.log(`Бунгало: задание без проверенного маршрута, пропускаю: «${o.text.slice(0, 200)}»`);
    }
  }
  if (!pick) {
    if (!offers.length) console.log('Бунгало: в «Событиях» нет заданий.');
    await page.goto('http://lbast.ru/location.php', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    suppressedUntil = Date.now() + 6 * RETRY_MS; // новые задания появляются раз в дни, не часы
    return false;
  }

  await page.goto(new URL(pick.href, page.url()).href, { waitUntil: 'domcontentloaded', timeout: 60000 });
  const took = await m.getBodyText(page);
  if (!/Задание получено/i.test(took)) {
    console.log(`Бунгало: задание «${pick.route.label}» не выдали: ${took.replace(/\s+/g, ' ').slice(0, 200)}`);
    return false;
  }
  console.log(`Бунгало: взял задание «${pick.route.label}», иду по маршруту ${pick.route.file}.`);
  const file = path.join(__dirname, pick.route.file);
  clearProgress(file);
  const r = await runGuide(page, file, 0, { quietDone: true });
  if (r.status === 'done') {
    console.log(`Бунгало: задание «${pick.route.label}» выполнено.`);
    suppressedUntil = Date.now() + 10 * 60000; // вдруг в «Событиях» было второе
  } else {
    // Маршрут записан в .progress: следующий заход продолжит с того же шага через resume ниже.
    console.log(`Бунгало: маршрут «${pick.route.label}» остановился (${r.status}) на шаге ${r.index}.`);
    pendingRoute = { file, label: pick.route.label };
  }
  return true;
}

// Если бой проигран или маршрут прервался - задание уже взято, продолжаем тот же файл.
let pendingRoute = null;
async function resumeBungaloIfPending(page) {
  if (!pendingRoute || Date.now() < suppressedUntil) return false;
  const { file, label } = pendingRoute;
  const r = await runGuide(page, file, undefined, { quietDone: true });
  if (r.status === 'done') {
    console.log(`Бунгало: задание «${label}» выполнено (со второго захода).`);
    pendingRoute = null;
  } else {
    console.log(`Бунгало: маршрут «${label}» снова остановился (${r.status}) на шаге ${r.index}.`);
    suppressedUntil = Date.now() + 30 * 60000;
  }
  return true;
}

async function runBungaloIfDue(page) {
  if (pendingRoute) return resumeBungaloIfPending(page);
  return runBungaloTaskIfAvailable(page);
}

module.exports = { runBungaloIfDue, BUNGALO_ROUTES };
