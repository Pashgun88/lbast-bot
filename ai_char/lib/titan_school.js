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

// Паша, 13.10.2026: «они по очереди изучаются, нужно все сделать». То есть выбор ветки - не
// развилка, а порядок: учим следующее умение ПОСЛЕ текущего в той же ветке. Текущее умение игра
// пишет сама («Текущее умение: Удар по глазам»), поэтому гадать не нужно - следующее за ним в
// списке и есть очередное. Выученные умения в списке ничем не помечены, цены видны у всех.
//
// Сам покупаю только дешёвое: до 9 уровня умения стоят 100-1500 дин, а дальше цена растёт до 42
// тысяч - такие траты решает Паша. Порог ниже.
const MAX_SKILL_PRICE = 3000;

// Разбор списка ветки: название, требуемый уровень, цена, срок и ссылка покупки (go=3&next=N).
async function readSkillList(page, branch) {
  await page.goto(`http://lbast.ru/loc.php?obj=5198&go=${branch}`, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => null);
  await pause(page, 500, 900);
  const rows = await page.evaluate(() => Array.from(document.querySelectorAll('a'))
    .filter((a) => /next=/.test(a.getAttribute('href') || ''))
    .map((a) => ({ text: (a.innerText || '').replace(/\s+/g, ' ').trim(), href: a.getAttribute('href') || '' }))).catch(() => []);
  const out = [];
  for (const r of rows) {
    const m = r.text.match(/^•?\s*(.+?)\s*\[(\d+)\]\s*-\s*изучение за\s*(\d+)\s*дин и\s*(\d+)\s*дн/);
    if (!m) continue;
    out.push({ name: m[1].trim(), need: Number(m[2]), price: Number(m[3]), days: Number(m[4]), href: r.href });
  }
  return out;
}

// Следующее умение по очереди: то, что стоит в списке СРАЗУ ПОСЛЕ текущего. Если текущего в ветке
// нет (например, оно из другой ветки) - берём первое доступное по уровню.
function nextSkillAfter(list, currentName, level) {
  const norm = (x) => String(x || '').toLowerCase().replace(/ё/g, 'е').trim();
  const idx = list.findIndex((x) => norm(x.name) === norm(currentName));
  const tail = idx >= 0 ? list.slice(idx + 1) : list;
  return tail.find((x) => !level || x.need <= level) || null;
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
    // Учить нечего: прошлое умение доучено. Берём следующее по очереди и платим сами, пока дёшево.
    const level = await require('./levelup').readCharLevelFromProfile(page).catch(() => 0);
    const currentName = current ? current[1] : '';
    const atk = await readSkillList(page, 1);
    const def = await readSkillList(page, 2);
    const inAttack = atk.some((x) => String(x.name).toLowerCase() === String(currentName).toLowerCase());
    const list = inAttack || !def.length ? atk : (def.some((x) => String(x.name).toLowerCase() === String(currentName).toLowerCase()) ? def : atk);
    const next = nextSkillAfter(list, currentName, level);
    if (!next) {
      console.log(`ШКОЛА ТИТАН: ЖДЁТ РЕШЕНИЯ - на ${level || '?'} уровне учить больше нечего`
        + `${currentName ? `, выучено «${currentName}»` : ''}. Следующее - уже выше нашего уровня.`);
    } else if (next.price > MAX_SKILL_PRICE) {
      console.log(`ШКОЛА ТИТАН: ЖДЁТ РЕШЕНИЯ - следующее по очереди «${next.name}» стоит ${next.price} дин`
        + ` (дороже ${MAX_SKILL_PRICE}), сам не покупаю. Реши, Паша.`);
    } else {
      await page.goto(new URL(next.href, 'http://lbast.ru/').href, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => null);
      await pause(page, 600, 1000);
      const after = (await getBodyText(page).catch(() => '')) || '';
      // Ответ игры на покупку (замер 13.10.2026): «Вы начали процесс обучения новому умению.
      // Приходите завтра, чтобы продолжить. Пропускать занятия мастер очень не рекомендует.»
      // Первый раз я его не предусмотрел, и успешная покупка попала в лог как «ответ непонятный».
      const started = /начали процесс обучения|День тренировок|Вы изучаете/i.test(after);
      console.log(`Школа Титан: ${started ? 'начал учить' : 'ответ непонятный на попытке выучить'} «${next.name}»`
        + ` (${next.price} дин, ${next.days} дн.)${started ? '' : `: ${after.replace(/\s+/g, ' ').slice(0, 200)}`}`);
    }
  }

  S.titanSchoolDayKey = day;
  persistDailyQuestState();
  return true;
}
