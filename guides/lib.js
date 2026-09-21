// Общие мелочи для инструментов гайдов (look.js / guide_run.js).
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Нормализация текста ссылки для сравнения: игра рисует маркеры списка, разные кавычки и "ё".
const norm = (s) => String(s || '')
  .replace(/^[\s\-–—*•]+/, '')
  .replace(/[«»"'.,!?…:;()]/g, '')
  .replace(/ё/g, 'е')
  .replace(/\s+/g, ' ')
  .trim()
  .toLowerCase();

async function getBodyText(page) {
  return await page.locator('body').innerText().catch(() => '');
}

async function links(page) {
  return await page.evaluate(() => Array.from(document.querySelectorAll('a'))
    .map((a) => ({
      t: (a.innerText || '').trim().replace(/\s+/g, ' ').replace(/^[*•]\s*/, ''),
      h: a.getAttribute('href') || '',
    }))
    .filter((x) => x.t)).catch(() => []);
}

// Служебные ссылки шапки/подвала: они есть на каждом экране и не относятся к сцене квеста.
// "Aмулет" пишется в игре через латинскую A (см. память statue-of-glory-latin-c про такие омоглифы).
const CHROME_LINKS = /^(Обновить|Чат|В игру|Письма|Инв|Поиск|A?мулет|Конь|Форум|ЖГ|Карта|Кланы|Галерея|Кто здесь\?|Выход|Размер текста|Бои)/i;

function sceneLinks(l) {
  return l.filter((x) => !CHROME_LINKS.test(x.t));
}

// Переход по ссылке/пути. Инструменты гайдов ходят по href, а не кликают по тексту: это устойчиво
// к тому, что на экране несколько похожих строк, и не зависит от верстки.
async function goto(page, u) {
  const url = u.startsWith('http') ? u : 'http://lbast.ru/' + u.replace(/^\//, '');
  for (let attempt = 1; ; attempt++) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      break;
    } catch (e) {
      console.log('guide goto retry', attempt, String(e.message).split('\n')[0]);
      if (attempt >= 4) throw e;
      await sleep(5000);
    }
  }
  await sleep(700);
}

// У Chrome свой резолвер, и он периодически отдаёт ERR_NAME_NOT_RESOLVED на lbast.ru, когда
// curl/ping с той же машины ходят нормально (21.09.2026). Резолвим имя сами через системный
// резолвер Node и отдаём браузеру готовое соответствие -- домен в URL при этом не меняется,
// так что куки/сессия профиля остаются теми же.
async function browserLaunchArgs() {
  try {
    const dns = require('dns');
    const { address } = await dns.promises.lookup('lbast.ru', { family: 4 });
    if (address) return [`--host-resolver-rules=MAP lbast.ru ${address}`];
  } catch (e) {
    console.log('lbast.ru resolve failed, оставляю резолвер Chrome:', e.message);
  }
  return [];
}

module.exports = { sleep, norm, getBodyText, links, sceneLinks, goto, browserLaunchArgs, CHROME_LINKS };
