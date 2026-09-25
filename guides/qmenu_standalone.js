// Меню квестов для РУЧНЫХ прогонов гайдов (node guides/guide_run.js ...), когда основной бот не
// запущен и его resetToQuestMenu/clickInfoForQuest недоступны. Нужно шагу @qinfo: он открывает
// [инфо] квеста и уезжает по «К месту выполнения» — это короткая дорога вместо поездки Конём.
// В автоматическом режиме daily_quests_piraty.js передаёт в runGuide свои собственные версии.
const { goto } = require('./lib');

async function resetToQuestMenu(page) {
  // Доска активных квестов. Осторожно: pers.php?mod=questinfo -- это КАТАЛОГ всех квестов
  // («Название [с N ур.]»), а не доска, и [инфо] там ведёт в описание, а не к выполнению.
  await goto(page, 'location.php?mod=quests');
  return true;
}

// Кликает именно ту ссылку [инфо], что стоит в одной строке с нужным квестом: на доске их
// столько же, сколько квестов, и «первая попавшаяся» увела бы не туда.
async function clickInfoForQuest(page, questName) {
  const href = await page.evaluate((name) => {
    const norm = (s) => String(s || '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
    const target = norm(name);
    const infos = Array.from(document.querySelectorAll('a'))
      .filter((a) => /инфо/i.test(a.textContent || ''));

    for (const a of infos) {
      // Строка квеста -- то, что лежит между предыдущим <br> и самой ссылкой.
      let text = '';
      let cur = a.previousSibling;
      while (cur) {
        if (cur.nodeName === 'BR') break;
        text = (cur.textContent || '') + text;
        cur = cur.previousSibling;
      }
      if (target && norm(text).includes(target)) return a.getAttribute('href');
    }
    return null;
  }, questName).catch(() => null);

  if (!href) return false;
  await goto(page, href);
  return true;
}

module.exports = { resetToQuestMenu, clickInfoForQuest };
