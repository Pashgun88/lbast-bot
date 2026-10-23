// Гильдия травников: варка эликсиров из собранных трав. Паша, 13.10.2026: «Вари все».
//
// ГДЕ: объект loc.php?obj=5134 на Центральном тракте, сектор карты №159. Короткий путь подсказал
// Паша: Амулет → «Дорожный крест» → юг → юг → ссылка «Гильдия травников». Телепорт только по URL
// (location.php?mod=fastway&lway=9) - по ссылке из меню амулета он в коде уже подводил.
// Номер объекта, как всегда, локальный: loc.php?obj=5134 из любого другого места отдаёт пустую
// страницу без списка рецептов, поэтому сначала ноги, потом объект.
//
// ЧТО ТАМ: AI__ уже член гильдии (членство 25000 дин кто-то оплатил до меня; выход стоит 10000 -
// ссылку go=3 не трогаем). Членство даёт варку без квест-запрета, продажу эликсиров через
// инвентарь и очки мастерства, от которых растёт шанс найти за сбор сразу ДВЕ травы. Поэтому
// варим всё, что собирается: это не только товар, но и ускорение самого сбора.
//
// Клик по рецепту (go=5&el_id=N) и есть варка. Ответ успеха: «Эликсир создан! Сварить еще один».
// Любой другой ответ считаем концом: трав на этот рецепт больше нет.

module.exports = { runHerbGuildIfDue };

const { S, getDayKeyNow, persistDailyQuestState } = require('./state');
const { getBodyText, pause } = require('./core');
const { beat } = require('./self_restart');

const CROSS_URL = 'http://lbast.ru/location.php?mod=fastway&lway=9';
const GUILD_LINK_RE = /^Гильдия травников$/;
const MADE_RE = /Эликсир создан/i;
// Нормальный конец рецепта (замер 13.10.2026): «Не хватает ингредиентов». Такое молчим.
const NOT_ENOUGH_RE = /Не хватает ингредиентов/i;
const MAX_PER_RECIPE = 40;  // предохранитель от бесконечного цикла, а не ограничение запаса
const MAX_TOTAL = 150;

// 23.10.2026, Паша: «И леки на 480 не варишь». Варка работала, но стояла на суточном ключе и
// заходила в гильдию около 05:00 - а травы собираются ПОЗЖЕ по кругу. Молодица, из которой
// (и только из неё) делается эликсир исцеления на 480, появлялась в сумке после варки и ждала
// сутки. Поэтому теперь варим раз в 6 часов: травы к этому времени уже в сумке.
const BREW_EVERY_MS = 6 * 60 * 60 * 1000;

async function links(page) {
  return page.evaluate(() => Array.from(document.querySelectorAll('a'))
    .map((a) => ({ t: (a.innerText || '').trim(), h: a.getAttribute('href') || '' }))
    .filter((x) => x.t && x.h)).catch(() => []);
}

async function goLink(page, re, label, waitMs = 900) {
  const all = await links(page);
  const hit = all.find((l) => re.test(l.t));
  if (!hit) {
    console.log(`Гильдия травников: не нашёл «${label}». Экран: ${all.map((l) => l.t).join(' | ').slice(0, 300)}`);
    return false;
  }
  await page.goto(new URL(hit.h, page.url()).href, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(waitMs);
  beat();
  return true;
}

async function enterGuild(page) {
  await page.goto('http://lbast.ru/location.php', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await pause(page, 500, 900);
  const here = await links(page);
  if (!here.some((l) => GUILD_LINK_RE.test(l.t))) {
    await page.goto(CROSS_URL, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => null);
    await pause(page, 1200, 1800);
    let arrived = false;
    for (let i = 0; i < 5; i++) {
      await page.goto('http://lbast.ru/location.php', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => null);
      await pause(page, 600, 900);
      if (/Дорожный крест/.test((await getBodyText(page).catch(() => '')) || '')) { arrived = true; break; }
      await pause(page, 900, 1400);
    }
    if (!arrived) { console.log('Гильдия травников: амулет не привёл на Дорожный крест - попробую в следующем круге.'); return false; }
    if (!(await goLink(page, /^Идти на юг$/, 'Идти на юг (тракт)'))) return false;
    if (!(await goLink(page, /^Идти на юг$/, 'Идти на юг (к гильдии)'))) return false;
  }
  return goLink(page, GUILD_LINK_RE, 'Гильдия травников');
}

// Список рецептов читаем с экрана, а не из кода: состав рецептов игра может менять, а новые
// эликсиры в гильдии появляются («существующие, а также новые эликсиры» - из справки go=1).
async function readRecipes(page) {
  await page.goto('http://lbast.ru/loc.php?obj=5134&go=5', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => null);
  await pause(page, 500, 900);
  return page.evaluate(() => Array.from(document.querySelectorAll('a'))
    .filter((a) => /el_id=\d+/.test(a.getAttribute('href') || ''))
    .map((a) => ({ name: (a.innerText || '').replace(/\s+/g, ' ').trim(), href: a.getAttribute('href') || '' }))).catch(() => []);
}

async function runHerbGuildIfDue(page) {
  const day = getDayKeyNow();
  if (Date.now() - (S.herbGuildAt || 0) < BREW_EVERY_MS) return false;

  if (!(await enterGuild(page))) return false;
  const recipes = await readRecipes(page);
  if (!recipes.length) {
    console.log('Гильдия травников: список рецептов пуст - в гильдию не зашёл или объект не отвечает.');
    return false;
  }

  const made = [];
  let total = 0;
  for (const r of recipes) {
    let n = 0;
    let href = r.href;
    while (n < MAX_PER_RECIPE && total < MAX_TOTAL) {
      await page.goto(new URL(href, 'http://lbast.ru/').href, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => null);
      await pause(page, 700, 1100);
      beat();
      const after = ((await getBodyText(page).catch(() => '')) || '').replace(/\s+/g, ' ');
      if (!MADE_RE.test(after)) {
        // Нечего варить - это норма, молчим. В лог идёт только НЕПОНЯТНЫЙ ответ: его стоит увидеть.
        if (!NOT_ENOUGH_RE.test(after)) console.log(`Гильдия травников: «${r.name}» - ответ непонятный: ${after.slice(0, 160)}`);
        break;
      }
      n += 1; total += 1;
      const again = (await links(page)).find((l) => /^Сварить еще один$/.test(l.t));
      if (again) href = again.h;
    }
    if (n) made.push(`${r.name} x${n}`);
  }

  S.herbGuildDayKey = day;
  S.herbGuildAt = Date.now();
  if (made.length) {
    persistDailyQuestState();
    console.log(`Гильдия травников: сварено ${made.join(', ')}`);
    return true;
  }
  // «Нечего варить» теперь случается до четырёх раз в сутки - в лог пишем об этом раз в день,
  // чтобы заход раз в 6 часов не превратился в шум.
  if (S.herbGuildEmptyDay !== day) {
    S.herbGuildEmptyDay = day;
    console.log('Гильдия травников: варить было нечего');
  }
  persistDailyQuestState();
  return true;
}
