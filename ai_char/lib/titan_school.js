// Школа «Титан» — ежедневная тренировка боевых умений. Паша, 12.10.2026: «сделай еще квест -
// школа титан, я забываю тебя водить туда, ходи сам».
//
// ГДЕ: сектор №43 карты, Горы Дарии (нашёл поиском по карте: map.php?mv=0&go=search, поле look -
// ТОЛЬКО через отправку формы, GET-запросом с look= в адресе поиск всегда отвечает «Ничего не
// найдено»; на этом я потерял час, прочёсывая города вручную).
// Дорога (разведана живьём 12.10.2026):
//   Конь → Горы Дарии → Горное плато --запад--> Кровавый пик --юг--> Горы --запад--> Ущелье
//   призраков --юг--> Горы (видно школу) --юг--> Школа «Титан» → ссылка «В школу».
// Первые четыре шага — тот же путь, что к каменоломне в lib/citizen_work.js, дальше ещё два юга.
//
// ЧТО ТАМ: платное дерево умений, две ветки («Выучить навыки атаки» / «Выучить навыки защиты»),
// по 21 умению в каждой, цена и срок растут с уровнем: [4] 100 дин и 2 дн. ... [24] 42000 дин и
// 5 дн. Умение учится не мгновенно: «День тренировок N из M», и день засчитывается за ЗАХОД в
// школу. Пропуск дня виден строкой «Вы пропустили день тренировок и ваш прогресс замедлился» -
// именно её Паша и просил больше не допускать. Поэтому заходим раз в сутки, молча.
//
// ЧЕГО НЕ ДЕЛАЕМ: не покупаем новое умение. Выбор ветки и трата дин - решение Паши (общее правило:
// без него не покупаем). Когда учить нечего, шаг пишет «ШКОЛА ТИТАН: ЖДЁТ РЕШЕНИЯ» - это уходит
// в Telegram, и Паша говорит, что брать. Клик по умению в списке (go=3&next=N) и есть покупка,
// поэтому в коде таких ссылок нет вовсе.

module.exports = { runTitanSchoolIfDue };

const { S, getDayKeyNow, persistDailyQuestState } = require('./state');
const { getBodyText, pause } = require('./core');
const { beat } = require('./self_restart');

const SCHOOL_LINK_RE = /^В школу$/;
const DARII_HORSE_RE = /Горы Дарии/i;

async function links(page) {
  return page.evaluate(() => Array.from(document.querySelectorAll('a'))
    .map((a) => ({ t: (a.innerText || '').trim(), h: a.getAttribute('href') || '' }))
    .filter((x) => x.t && x.h)).catch(() => []);
}

async function goLink(page, re, label, waitMs = 1000) {
  const all = await links(page);
  const hit = all.find((l) => re.test(l.t));
  if (!hit) {
    console.log(`Школа Титан: не нашёл «${label}». Экран: ${all.map((l) => l.t).join(' | ').slice(0, 300)}`);
    return false;
  }
  await page.goto(new URL(hit.h, page.url()).href, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(waitMs);
  beat();
  return true;
}

// Доехать до ворот школы и войти внутрь.
async function enterSchool(page) {
  await page.goto('http://lbast.ru/location.php', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await pause(page, 500, 900);
  // Уже у ворот? Проверяем по ССЫЛКЕ, а не по тексту: в описании СОСЕДНЕЙ локации «Горы» тоже
  // сказано про школу («тренируются бойцы школы "Титан"») - на таком тексте проверка у
  // каменоломни однажды застряла на целый день.
  const here = await links(page);
  if (!here.some((l) => SCHOOL_LINK_RE.test(l.t))) {
    if (!(await goLink(page, /^Конь$|^конь$/, 'Конь'))) return null;
    if (!(await goLink(page, DARII_HORSE_RE, 'Горы Дарии', 9000))) return null;
    await page.goto('http://lbast.ru/location.php', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await pause(page, 600, 1000);
    if (!(await goLink(page, /^Идти на запад$/, 'Идти на запад (Кровавый пик)'))) return null;
    if (!(await goLink(page, /^Идти на юг$/, 'Идти на юг (Горы)'))) return null;
    if (!(await goLink(page, /^Идти на запад$/, 'Идти на запад (Ущелье призраков)'))) return null;
    if (!(await goLink(page, /^Идти на юг$/, 'Идти на юг (Горы, видно школу)'))) return null;
    if (!(await goLink(page, /^Идти на юг$/, 'Идти на юг (ворота школы)'))) return null;
  }
  if (!(await goLink(page, SCHOOL_LINK_RE, 'В школу'))) return null;
  return (await getBodyText(page)) || '';
}

// Какие умения доступны на нашем уровне - нужно только для доклада Паше, когда учить нечего.
async function readCandidates(page, branch) {
  await page.goto(`http://lbast.ru/loc.php?obj=5198&go=${branch}`, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => null);
  await pause(page, 500, 900);
  const text = (await getBodyText(page).catch(() => '')) || '';
  const level = Number(S.charLevel) || 0;
  const out = [];
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*•\s*(.+?)\s*\[(\d+)\]\s*-\s*изучение за\s*(\d+)\s*дин и\s*(\d+)\s*дн/);
    if (!m) continue;
    const need = Number(m[2]);
    if (level && need > level) continue;
    out.push(`${m[1]} [${need} ур.] - ${m[3]} дин, ${m[4]} дн.`);
  }
  // Сильнейшее доступное умение - последнее в списке: он отсортирован по уровню.
  return out.slice(-3);
}

async function runTitanSchoolIfDue(page) {
  const day = getDayKeyNow();
  if (S.titanSchoolDayKey === day) return false;

  const text = await enterSchool(page);
  if (text === null) return false; // не доехали - попробуем в следующем круге

  const flat = text.replace(/\s+/g, ' ');
  const learning = flat.match(/Вы изучаете новое умение\s+([^.]+?)\s*\./);
  const dayOf = flat.match(/День тренировок\s+(\d+)\s+из\s+(\d+)/);
  const current = flat.match(/Текущее умение:\s*([^•\n]+?)\s*(?:•|Вы изучаете|День тренировок|$)/);
  const missed = /Вы пропустили день тренировок/.test(flat);

  if (learning) {
    console.log(`Школа Титан: тренировка зачтена - учу «${learning[1]}»`
      + (dayOf ? `, день ${dayOf[1]} из ${dayOf[2]}` : '')
      + (current ? `; выучено: ${current[1]}` : '')
      + (missed ? ' (игра отметила пропущенный день - прогресс замедлен)' : ''));
  } else {
    // Учить нечего: умение доучено, а новое - это трата дин, то есть решение Паши.
    const atk = await readCandidates(page, 1);
    const def = await readCandidates(page, 2);
    console.log(`ШКОЛА ТИТАН: ЖДЁТ РЕШЕНИЯ - учить нечего${current ? `, выучено «${current[1]}»` : ''}.`
      + ` Атака: ${atk.join('; ') || '-'}. Защита: ${def.join('; ') || '-'}.`
      + ' Что брать - реши, Паша: покупку я сам не делаю.');
  }

  S.titanSchoolDayKey = day;
  persistDailyQuestState();
  return true;
}
