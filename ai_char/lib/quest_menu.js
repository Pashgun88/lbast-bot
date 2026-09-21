// Q-меню квестов: открыть, "Информация" по квесту, текущее задание/отказ, разбор списка квестов.
// Выделено из ai_char/module.js (там только сборка экспорта). Изменяемое состояние - S из ./state.

// Экспорт стоит ДО require: файлы lib/ вызывают друг друга по кругу, а объявления функций
// всплывают (hoisting), поэтому к моменту любого встречного require все функции уже здесь.
module.exports = {
  openQuestsMenu, resetToQuestMenu, clickInfoForQuest, hasAlreadyHasQuestText,
  readCurrentAssignment, dropCurrentAssignment, parseQuestNamesFromQMenuText, normalizeQuestName,
  isQuestInMenu, clickLinkNextToQuest,
};

const { getBodyText, pause, snapshotText } = require('./core');
const { clickByTexts } = require('./ui');

async function openQuestsMenu(page, questCount) {
  // If a previous dispatcher (Demon Lake, Shipwreck, ...) already left us on the quest
  // board, the nav header's numeric "Q13" badge is gone from this page, so a fresh
  // click search fails even though we don't need to click anything. Detect that case
  // first instead of assuming the caller navigated back to location.php beforehand.
  if (/mod=quests\b/i.test(page.url())) {
    return true;
  }

  // IMPORTANT: do NOT fall back to a generic "\u041a\u0432\u0435\u0441\u0442\u044b"/"\u043a\u0432\u0435\u0441\u0442\u044b" text match here.
  // `a:has-text("\u043a\u0432\u0435\u0441\u0442\u044b")` is a case-insensitive SUBSTRING match, and pers.php's
  // account menu has a "\u0414\u043e\u0441\u0442\u0443\u043f\u043d\u044b\u0435 \u043a\u0432\u0435\u0441\u0442\u044b" link that also contains "\u043a\u0432\u0435\u0441\u0442\u044b" \u2014 that
  // link leads to the quest CATALOG (pers.php?mod=questinfo, format "Name [\u0441 N \u0443\u0440.]"),
  // not the active quest board (location.php?mod=quests, format "\u2022 Name [\u0438\u043d\u0444\u043e]").
  // Discovered 14.09.2026 when parseQuestNamesFromQMenuText kept returning [] because
  // openQuestsMenu had silently landed on the catalog page instead.
  const variants = [];
  if (Number.isFinite(questCount) && questCount > 0) {
    variants.push(`Q${questCount}`);
  }
  variants.push('Q');

  let ok = await clickByTexts(page, variants, 'open quests menu');
  if (!ok) {
    // The caller may have left `page` on some intermediate view (e.g. a Podvaly
    // "Осмотреть подвалы" result screen) that doesn't render the top-nav "Q" badge
    // at all. One retry from a known-good page fixes this instead of failing the
    // whole daily-quests cycle. Found 14.09.2026 right after a Podvaly round ran
    // out of monsters to attack mid-cycle.
    await page.goto('http://lbast.ru/location.php', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    await pause(page, 500, 1000);
    ok = await clickByTexts(page, variants, 'open quests menu (retry after reset)');
    if (!ok) {
      return false;
    }
  }

  await pause(page, 800, 1600);
  return true;
}



async function resetToQuestMenu(page, questCount) {
  try {
    await page.goto('http://lbast.ru/location.php', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await pause(page, 800, 1600);
    return await openQuestsMenu(page, questCount);
  } catch (e) {
    console.log('Could not reset to quests menu: ' + e.message);
    return false;
  }
}

async function clickInfoForQuest(page, questName) {
  // IMPORTANT: click the [инфо] link that is on the same line as the quest name.
  // Some pages / encodings may display it as mojibake ("èíôî"), so we support both.
  const links = page.locator(
    'a:has-text("инфо"), a:has-text("Инфо"), a:has-text("èíôî"), a:has-text("Èíôî")'
  );
  const total = await links.count().catch(() => 0);
  const target = String(questName || '').toLowerCase();

  for (let i = 0; i < total; i++) {
    const link = links.nth(i);

    const lineText = await link.evaluate((el) => {
      const normalize = (s) => String(s || '').replace(/\u00A0/g, ' ').replace(/\s+/g, ' ').trim();

      // Walk up until we find an ancestor that contains only one "инфо" link.
      let node = el;
      while (node && node.parentElement) {
        const p = node.parentElement;
        const infos = Array.from(p.querySelectorAll('a')).filter((a) => {
          const t = a.textContent || '';
          return /инфо/i.test(t) || /èíôî/i.test(t);
        });
        if (infos.length <= 1) {
          return normalize(p.textContent);
        }
        node = p;
      }

      // Fallback: take nearby siblings until <br> boundaries.
      let text = '';
      const parent = el.parentNode;
      if (!parent) return '';

      // Collect preceding siblings.
      let cur = el.previousSibling;
      while (cur) {
        if (cur.nodeName === 'BR') break;
        text = (cur.textContent || '') + text;
        cur = cur.previousSibling;
      }

      // Also include some following siblings.
      cur = el.nextSibling;
      while (cur) {
        if (cur.nodeName === 'BR') break;
        text = text + (cur.textContent || '');
        cur = cur.nextSibling;
      }

      return normalize(text);
    }).catch(() => '');

    if (!lineText) continue;

    if (lineText.toLowerCase().includes(target)) {
      try {
        await link.click({ timeout: 8000, noWaitAfter: true });
        // The click normally navigates to questinfo; don't hang if it doesn't.
        await page.waitForURL(/mod=questinfo/i, { timeout: 8000 }).catch(() => {});
        console.log(`OK: ${questName} -> info`);
        await pause(page, 800, 1600);
        return true;
      } catch (e) {
        console.log(`Could not click info for ${questName}: ${e.message}`);
      }
    }
  }

  console.log(`Info link not found next to quest: ${questName}`);
  return false;
}


// Анкета (pers.php) показывает строку "Текущее задание: <текст> - отказаться", и отказ ведёт
// на /pers.php?r=NNNN&mod=dropquest. Разобрано вживую 17.09.2026 после жалобы Паши: игра
// пишет "у вас уже есть задание", и новое задание не берётся, пока старое висит.
// ВАЖНО: r= меняется при каждой загрузке страницы, поэтому href НЕ хардкодим - берём ссылку
// на анкету с текущей страницы и кликаем по тексту "отказаться".
function hasAlreadyHasQuestText(text) {
  return /у\s*вас\s*уже\s*есть\s*задание/i.test(String(text || ''));
}

async function readCurrentAssignment(page) {
  const persHref = await page
    .$eval('a[href^="pers.php"]', (a) => a.getAttribute('href'))
    .catch(() => null);
  if (!persHref) return null;

  await page.goto(`http://lbast.ru/${persHref.replace(/^\//, '')}`, {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  await pause(page, 400, 800);

  const text = await getBodyText(page);
  const m = text.match(/Текущее задание:\s*([\s\S]*?)\s*-\s*отказаться/i);
  return { text, assignment: m ? m[1].trim() : null };
}

// Отказ от текущего задания через анкету. Возвращает true, только если задание реально было
// и ссылка отказа нажалась. Это НЕОБРАТИМО - прогресс по заданию теряется, поэтому вызывается
// лишь тогда, когда игра сама сказала "у вас уже есть задание" и иначе квест не сдвинуть.
async function dropCurrentAssignment(page, reason = '') {
  const info = await readCurrentAssignment(page);
  if (!info) {
    console.log('Отказ от задания: не нашёл ссылку на анкету (pers.php) на текущей странице.');
    return false;
  }
  if (!info.assignment) {
    console.log('Отказ от задания: в анкете нет активного задания - отказываться не от чего.');
    await clickByTexts(page, ['В игру', 'в игру'], 'В игру (анкета)');
    return false;
  }

  console.log(`Отказ от задания (${reason}): "${snapshotText(info.assignment, 200)}"`);
  // 17.09.2026, Паша письмом: ты видимо когда от задания отказывался отказался и от статуи,
  // кнопка идентична, но другая строка. Проверено живьём: в анкете есть строка
  // Статуя славы: еще N мин Отказаться со ссылкой mod=statuenull, рядом с Текущее задание.
  // Клик по ТЕКСТУ отказаться - лотерея между ними, и он снял бафф статуи: максимум HP упал
  // 380 -> 340, а я успел заподозрить чужой вход в аккаунт. Целимся по href, а не по надписи.
  const dropHref = await page
    .evaluate(() => {
      const a = Array.from(document.querySelectorAll("a")).find((x) => (x.getAttribute("href") || "").includes("mod=dropquest"));
      return a ? a.getAttribute("href") : null;
    })
    .catch(() => null);

  if (!dropHref) {
    console.log("Отказ от задания: ссылка mod=dropquest не найдена - НИЧЕГО не жму по тексту, чтобы не снять бафф статуи (mod=statuenull).");
    return false;
  }

  await page.goto("http://lbast.ru/" + (dropHref[0] === "/" ? dropHref.slice(1) : dropHref), { waitUntil: "domcontentloaded", timeout: 60000 });
  await pause(page, 800, 1500);
  await clickByTexts(page, ['В игру', 'в игру'], 'В игру (после отказа)');
  await pause(page, 600, 1200);
  console.log('Отказ от задания: выполнено, задание освободилось.');
  return true;
}

function parseQuestNamesFromQMenuText(text) {
  const normalized = String(text || '')
    .replace(/\u00A0/g, ' ')
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .trim();

  const lines = normalized.split('\n').map((l) => l.trim()).filter(Boolean);
  const names = [];

  for (const line of lines) {
    // Example: "• Харчевня [инфо]"
    const match = line.match(/^[•*-]\s*(.+?)\s*\[\s*инфо\s*\]\s*$/i);
    if (match) {
      names.push(String(match[1] || '').trim());
    }
  }

  return names;
}

function normalizeQuestName(name) {
  return String(name || '')
    .replace(/\u00A0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function isQuestInMenu(questNames, targetQuestName) {
  const t = normalizeQuestName(targetQuestName);
  return questNames.some((q) => normalizeQuestName(q) === t);
}

async function clickLinkNextToQuest(page, questName, linkTexts, okLabel) {
  const target = String(questName || '').toLowerCase();

  for (const linkText of linkTexts) {
    const links = page.locator(`a:has-text("${linkText}")`);
    const total = await links.count().catch(() => 0);

    for (let i = 0; i < total; i++) {
      const link = links.nth(i);

      const lineText = await link.evaluate((el) => {
        const normalize = (s) => String(s || '').replace(/\u00A0/g, ' ').replace(/\s+/g, ' ').trim();

        // Similar to clickInfoForQuest: use nearby siblings up to <br> boundaries.
        let text = '';
        const parent = el.parentNode;
        if (!parent) return '';

        let cur = el.previousSibling;
        while (cur) {
          if (cur.nodeName === 'BR') break;
          text = (cur.textContent || '') + text;
          cur = cur.previousSibling;
        }

        cur = el.nextSibling;
        while (cur) {
          if (cur.nodeName === 'BR') break;
          text = text + (cur.textContent || '');
          cur = cur.nextSibling;
        }

        return normalize(text);
      }).catch(() => '');

      if (!lineText) continue;
      if (!lineText.toLowerCase().includes(target)) continue;

      try {
        await link.click({ timeout: 8000, noWaitAfter: true });
        console.log(`OK: ${okLabel} -> ${linkText}`);
        await pause(page, 800, 1600);
        return true;
      } catch (e) {
        console.log(`Could not click ${okLabel} -> ${linkText}: ${e.message}`);
      }
    }
  }

  return false;
}
