// Сломанная экипировка. Паша, 25.10.2026 (прислал скрин с красной надписью):
// «когда видишь такое, нужно нажать на красную надпись и потом - выбросить поломаное.
//  И посмотреть что это, если герб - ты же знаешь что нужно новый взять».
//
// Механика, снятая вживую 25.10.2026:
//  - в шапке локации висит красная ссылка «Снимите сломанную экипировку!» -> inv.php?mod=outfit;
//  - на экране экипировки сломанное помечено словом «Поломано!» в конце строки слота
//    («Клан-вещь: Герб Боги войны [^] Поломано!»);
//  - внизу ссылка «Выбросить поломаное» (mod=dropbroken), ответ: «Все поломаные вещи удалены».
//
// Выбрасывается только то, что игра уже пометила сломанным: целой вещи этот ход не касается.
// Что именно сломалось - пишем в лог и в Telegram, иначе пропажа вещи выглядит как кража.
// Герб после этого доберёт сам lib/clan_emblem.js: его триггер - пустой слот клан-вещи.

const { S } = require('./state');
const { getBodyText, pause } = require('./core');

const OUTFIT_URL = 'http://lbast.ru/inv.php?mod=outfit';
const CHECK_EVERY_MS = 30 * 60 * 1000;

function flat(text, limit = 300) {
  return String(text || '').replace(/\s+/g, ' ').trim().slice(0, limit);
}

// Строки слотов со словом «Поломано!». Нижнее меню («Обзор оружия Выбросить поломаное ...»)
// тоже содержит слово «полом», но без восклицательного знака и без двоеточия слота - отсекаем
// по наличию «Слот: вещь».
function brokenItems(text) {
  return String(text || '')
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter((l) => /Поломано!/i.test(l) && /:/.test(l))
    .map((l) => l.replace(/\s*\[\^\]\s*/g, ' ').replace(/\s*Поломано!.*$/i, '').trim());
}

async function dropBrokenGearIfAny(page) {
  if (Date.now() - (S.brokenGearAt || 0) < CHECK_EVERY_MS) return false;
  S.brokenGearAt = Date.now();

  await page.goto(OUTFIT_URL, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  const outfit = await getBodyText(page).catch(() => '');
  const broken = brokenItems(outfit);
  if (!broken.length) return false;

  console.log(`Сломанная экипировка: ${broken.join(' ; ')} - выбрасываю.`);
  const href = await page.evaluate(() => {
    const a = Array.from(document.querySelectorAll('a')).find((x) => /Выбросить\s+полом/i.test((x.textContent || '').trim()));
    return a ? a.getAttribute('href') : null;
  }).catch(() => null);
  if (!href) {
    console.log(`ПОЛОМКА: сломано «${broken.join(' ; ')}», но ссылки «Выбросить поломаное» на экране нет. Экран: ${flat(outfit)}`);
    return false;
  }

  await page.goto(new URL(href, 'http://lbast.ru/').href, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  await pause(page, 500, 900);
  const after = await getBodyText(page).catch(() => '');
  if (!/полома\w*\s+вещи\s+удалены/i.test(after)) {
    console.log(`ПОЛОМКА: выбросить сломанное не вышло. Экран: ${flat(after)}`);
    return false;
  }
  console.log(`СЛОМАЛОСЬ И ВЫБРОШЕНО: ${broken.join(' ; ')}`);
  // Герб - расходник на неделю, новый берётся в замке. Отдельной строкой, чтобы в логе было
  // видно, что пустой слот клан-вещи - ожидаемое следствие, а не потеря.
  if (broken.some((x) => /герб/i.test(x))) {
    console.log('Сломанная экипировка: это был клановый герб - следующим шагом беру новый в замке.');
    S.lastClanEmblemCheckAt = 0;
  }
  return true;
}

module.exports = { dropBrokenGearIfAny, brokenItems, CHECK_EVERY_MS };
