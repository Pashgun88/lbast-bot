// Клики и шаги по интерфейсу: селекторы, clickByTexts*, existsAnyText, performStep.
// Выделено из ai_char/module.js (там только сборка экспорта). Изменяемое состояние - S из ./state.

// Экспорт стоит ДО require: файлы lib/ вызывают друг друга по кругу, а объявления функций
// всплывают (hoisting), поэтому к моменту любого встречного require все функции уже здесь.
module.exports = {
  escapeCssStringLiteral, buildSelectorsForText, buildSelectorsForClickableDetect,
  buildSelectorsForTextAny, escapeRegexLiteral, clickOnlySensibleOption, existsAnyText,
  existsAnyClickable, clickByTexts, clickByTextsLoose, clickByTextsForced, clickByKeywords,
  clickByNormalizedIncludes, performStep,
};

const { S, UI_STUCK_MAX_FAILS, UI_STUCK_MAX_MS } = require('./state');
const { fixedPause, getBodyText, pause } = require('./core');

// 16.09.2026: link/button text on lbast.ru sometimes contains a literal ASCII `"` (e.g.
// 'Ответить "да"', 'Таверна "Три поросенка"') - interpolating that straight into a
// double-quoted CSS string (`a:has-text("${text}")`) breaks the selector's own quoting and
// silently matches nothing (no error, just "не найдено ни одного варианта"). Hit this bug
// twice live this session before finally fixing it here instead of working around it with a
// shorter substring each time.
function escapeCssStringLiteral(str) {
  return String(str || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function buildSelectorsForText(text) {
  // Use these selectors when we intend to CLICK something.
  // Avoid `text=` for clicking because it can match non-clickable text and lead to wrong clicks
  // (e.g. hitting "Настройка" or other nearby labels).
  // IMPORTANT: append Playwright's `:visible` pseudo-class. Some location pages render a
  // second, hidden copy of the nav (display:none, 0x0 rect — looks like leftover
  // responsive/mobile markup) BEFORE the real one in DOM order. `.first()` on an unfiltered
  // selector then grabs the invisible clone forever, and every click on it times out with
  // "element is not visible" no matter how long we wait. Found 15.09.2026 on the "Конь" nav
  // link, but the same hidden-duplicate pattern can affect any nav link on such a page.
  const escaped = escapeCssStringLiteral(text);
  return [
    `a:has-text("${escaped}"):visible`,
    `button:has-text("${escaped}"):visible`,
    `input[value="${escaped}"]:visible`,
  ];
}

function buildSelectorsForClickableDetect(text) {
  // Use these selectors when we want to DETECT that a clickable action is available.
  // Some lbast pages use non-standard clickable elements.
  const escaped = escapeCssStringLiteral(text);
  return [
    ...buildSelectorsForText(text),
    `[onclick]:has-text("${escaped}")`,
    `[role="link"]:has-text("${escaped}")`,
    `[role="button"]:has-text("${escaped}")`,
  ];
}

function buildSelectorsForTextAny(text) {
  // Use these selectors when we only want to DETECT that text exists on the page.
  return [...buildSelectorsForText(text), `text=${text}`];
}

function escapeRegexLiteral(str) {
  return String(str || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// 16.09.2026, Паша: "если под текстом одна кнопка то сразу ее нажать - все равно выбора нет".
// Общая логика для линейных сюжетных цепочек (диалоги/квестовые сцены, где на экране всегда
// ровно один осмысленный переход) - убираем служебные пункты шапки/меню сайта и, если остаётся
// РОВНО одна содержательная ссылка, кликаем её без необходимости знать точный текст заранее.
// Изначально была написана как одноразовая copy-paste функция внутри временного скрипта для
// Дня 3 "Жертвоприношения" (см. feedback_shtolni_debugging_mistakes) - теперь общий хелпер.
const NAV_SERVICE_WORDS = [
  // "Aмулет" (латинская A, U+0041) - известный баг верстки сайта, ссылка иногда рендерится
  // с латинской буквой вместо кириллической "Амулет" (см. feedback_shtolni_debugging_mistakes) -
  // без обоих вариантов фильтр пропускает её как "содержательную" ссылку и ломает
  // одно-кнопочные экраны ложной неоднозначностью.
  'Чат', 'В игру', 'Обновить', 'Амулет', 'Aмулет', 'Конь', 'Форум', 'ЖГ', 'Карта', 'Кланы',
  'Бои', 'Выход', 'Размер текста', 'Помощь', 'Галерея', 'Кто здесь?', 'Уйти',
];

async function clickOnlySensibleOption(page, label = 'единственный вариант') {
  const links = (await page.locator('a').allTextContents()).map((t) => t.trim()).filter(Boolean);
  const candidates = links.filter(
    (l) =>
      l.length > 3 &&
      !NAV_SERVICE_WORDS.some((w) => l === w || l.includes(w)) &&
      // Персонажный ник со статами в шапке, напр. "AI__ (380/380)" - ссылка на pers.php,
      // не игровой выбор.
      !/^[\wА-Яа-яЁё_]+\s*\(\d+\/\d+\)$/.test(l)
  );
  const unique = [...new Set(candidates)];
  if (unique.length !== 1) {
    return { clicked: false, reason: unique.length === 0 ? 'no_candidates' : 'ambiguous', candidates: unique };
  }
  const target = unique[0];
  const ok = await clickByTexts(page, [target], `${label}: "${target}"`);
  return { clicked: ok, target, candidates: unique };
}

async function existsAnyText(page, texts) {
  for (const text of texts) {
    const selectors = buildSelectorsForTextAny(text);
    for (const selector of selectors) {
      const count = await page.locator(selector).first().count().catch(() => 0);
      if (count > 0) {
        return true;
      }
    }
  }
  return false;
}

async function existsAnyClickable(page, texts) {
  for (const text of texts) {
    const selectors = buildSelectorsForClickableDetect(text);
    for (const selector of selectors) {
      const count = await page.locator(selector).first().count().catch(() => 0);
      if (count > 0) {
        return true;
      }
    }
  }
  return false;
}

async function clickByTexts(page, texts, stepName) {
  for (const text of texts) {
    const variants = buildSelectorsForText(text);

    for (const selector of variants) {
      const locator = page.locator(selector).first();
      const count = await locator.count().catch(() => 0);

      if (count > 0) {
        try {
          // Many lbast actions don't trigger a real navigation, and Playwright can time out
          // waiting for "scheduled navigations". We handle progression in performStep instead.
          await locator.click({ timeout: 8000, noWaitAfter: true });
          console.log(`OK: ${stepName} -> ${text}`);
          // Reset stuck detection on any successful click.
          S.uiStuckState = { stepName: '', count: 0, firstAt: 0 };
          return true;
        } catch (e) {
          console.log(`Не смог кликнуть ${stepName} -> ${text}: ${e.message}`);
        }
      }
    }
  }

  console.log(`Не найдено для шага "${stepName}" ни одного варианта: ${texts.join(', ')}`);

  // Update stuck detector (only for repeated failures of the same step name).
  const now = Date.now();
  if (S.uiStuckState.stepName === stepName) {
    S.uiStuckState.count += 1;
  } else {
    S.uiStuckState = { stepName, count: 1, firstAt: now };
  }

  const elapsed = now - (S.uiStuckState.firstAt || now);
  if (S.uiStuckState.count >= UI_STUCK_MAX_FAILS || elapsed >= UI_STUCK_MAX_MS) {
    throw new Error(`ui_stuck:${stepName}`);
  }

  return false;
}

async function clickByTextsLoose(page, texts, stepName) {
  // First, try the safe click targets (a/button/input).
  const ok = await clickByTexts(page, texts, stepName);
  if (ok) return true;

  // Fallback: click a unique exact-text match (any element). Use only when unique to avoid misclicking.
  for (const text of texts) {
    const locator = page.locator(`text=${text}`);
    const count = await locator.count().catch(() => 0);
    if (count === 1) {
      try {
        await locator.first().click({ timeout: 8000, noWaitAfter: true });
        console.log(`OK: ${stepName} -> ${text} (loose)`);
        return true;
      } catch (e) {
        console.log(`Не смог кликнуть ${stepName} -> ${text} (loose): ${e.message}`);
      }
    }
  }

  return false;
}

// Last resort for buttons confirmed real in-game but that clickByTextsLoose still can't click
// (e.g. its "must be the only match" safety check refuses due to a hidden duplicate/tooltip).
// Clicks the first match regardless of count, with force to bypass any overlay.
async function clickByTextsForced(page, texts, stepName) {
  const ok = await clickByTextsLoose(page, texts, stepName);
  if (ok) return true;

  for (const text of texts) {
    const locator = page.locator(`text=${text}`).first();
    const count = await locator.count().catch(() => 0);
    if (count > 0) {
      try {
        await locator.click({ timeout: 8000, force: true, noWaitAfter: true });
        console.log(`OK: ${stepName} -> ${text} (forced)`);
        return true;
      } catch (e) {
        console.log(`Не смог кликнуть ${stepName} -> ${text} (forced): ${e.message}`);
      }
    }
  }

  return false;
}

async function clickByKeywords(page, keywords, stepName) {
  for (const keyword of keywords) {
    const kw = String(keyword || '').trim();
    if (!kw) continue;

    // Prefer clickable targets.
    const clickable = page.locator(`a:has-text("${kw}"), button:has-text("${kw}"), input[value="${kw}"]`).first();
    const clickableCount = await clickable.count().catch(() => 0);
    if (clickableCount > 0) {
      try {
        await clickable.click({ timeout: 8000, noWaitAfter: true });
        console.log(`OK: ${stepName} -> ${kw} (keyword)`);
        return true;
      } catch (e) {
        console.log(`Не смог кликнуть ${stepName} -> ${kw} (keyword): ${e.message}`);
      }
    }

    // Fallback: regex text match (handles extra spaces/line breaks).
    const re = escapeRegexLiteral(kw);
    const any = page.locator(`text=/${re}/i`).first();
    const anyCount = await any.count().catch(() => 0);
    if (anyCount > 0) {
      try {
        await any.click({ timeout: 8000, noWaitAfter: true });
        console.log(`OK: ${stepName} -> ${kw} (keyword-regex)`);
        return true;
      } catch (e) {
        console.log(`Не смог кликнуть ${stepName} -> ${kw} (keyword-regex): ${e.message}`);
      }
    }
  }

  return false;
}

async function clickByNormalizedIncludes(page, keywords, stepName) {
  const kws = (keywords || []).map((k) => String(k || '').trim().toLowerCase()).filter(Boolean);
  if (kws.length === 0) return false;

  try {
    const clicked = await page.evaluate((needles) => {
      const normalize = (s) => String(s || '')
        .replace(/\u00A0/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();

      const matchesAll = (hay) => needles.every((n) => hay.includes(n));

      const isVisible = (el) => {
        try {
          const style = window.getComputedStyle(el);
          if (!style) return true;
          if (style.visibility === 'hidden' || style.display === 'none') return false;
          const rect = el.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        } catch (e) {
          return true;
        }
      };

      const candidates = [
        ...Array.from(document.querySelectorAll('a')),
        ...Array.from(document.querySelectorAll('button')),
        ...Array.from(document.querySelectorAll('input')),
        // Some lbast pages use non-standard clickable elements.
        ...Array.from(document.querySelectorAll('[onclick]')),
        ...Array.from(document.querySelectorAll('[role="link"], [role="button"]')),
      ];

      for (const el of candidates) {
        let text = '';
        if (el.tagName === 'INPUT') {
          text = el.value || '';
        } else {
          text = el.textContent || '';
        }

        const norm = normalize(text);
        if (!norm) continue;
        if (!matchesAll(norm)) continue;
        if (!isVisible(el)) continue;

        try {
          el.click();
          return true;
        } catch (e) {
          // continue
        }
      }

      return false;
    }, kws);

    if (clicked) {
      console.log(`OK: ${stepName} -> ${keywords.join(' ')} (normalized)`);
      return true;
    }
  } catch (e) {
    console.log(`Не смог кликнуть ${stepName} (normalized): ${e.message}`);
  }

  return false;
}

async function performStep(page, config) {
  const {
    stepName,
    currentTexts,
    nextTexts = [],
    waitAfterClickMs = null,
    retries = 3,
    waitForNextMs = 0,
    clickFn = null,
    skipIfNextVisible = true,
  } = config;

  const snapshot = (text) => String(text || '')
    .replace(/\u00A0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500);

  // Occasionally a navigation lands on a nearly-empty page (just the clock, no menu links) — the
  // step can't find anything to click and would fail. Reload location.php once to recover; only
  // the first step of a route lives on location.php, so deeper steps stay unaffected.
  let didBlankReload = false;

  for (let attempt = 1; attempt <= retries; attempt++) {
    console.log(`Шаг "${stepName}", попытка ${attempt}/${retries}`);

    if (skipIfNextVisible && nextTexts.length > 0 && await existsAnyClickable(page, nextTexts)) {
      console.log(`Следующий шаг для "${stepName}" уже виден, пропускаю текущий шаг`);
      return true;
    }

    const urlBeforeClick = page.url();
    const textBeforeClick = nextTexts.length === 0 ? snapshot(await getBodyText(page)) : null;
    const clicker = clickFn || clickByTexts;
    const clicked = await clicker(page, currentTexts, stepName);

    if (clicked) {
      if (waitAfterClickMs) {
        console.log(`Жду ${Math.round(waitAfterClickMs / 1000)} секунд после "${stepName}"`);
        await fixedPause(page, waitAfterClickMs);
      } else {
        await pause(page, 800, 1800);
      }

      if (waitForNextMs > 0 && nextTexts.length > 0) {
        const started = Date.now();
        while (Date.now() - started < waitForNextMs) {
          if (await existsAnyClickable(page, nextTexts)) {
            console.log(`OK: после "${stepName}" появился следующий шаг`);
            return true;
          }
          await pause(page, 150, 250);
        }
      }

      const urlAfterClick = page.url();
      if (urlAfterClick && urlAfterClick !== urlBeforeClick) {
        if (waitForNextMs > 0 && nextTexts.length > 0) {
          const started = Date.now();
          while (Date.now() - started < waitForNextMs) {
            if (await existsAnyClickable(page, nextTexts)) {
              console.log(`OK: после "${stepName}" появился следующий шаг`);
              return true;
            }
            await pause(page, 150, 250);
          }
        }
        console.log(`OK: после "${stepName}" изменился URL`);
        return true;
      }

      if (textBeforeClick !== null) {
        const textAfterClick = snapshot(await getBodyText(page));
        if (textAfterClick !== textBeforeClick) {
          if (waitForNextMs > 0 && nextTexts.length > 0) {
            const started = Date.now();
            while (Date.now() - started < waitForNextMs) {
              if (await existsAnyClickable(page, nextTexts)) {
                console.log(`OK: после "${stepName}" появился следующий шаг`);
                return true;
              }
              await pause(page, 150, 250);
            }
          }
          console.log(`OK: после "${stepName}" изменился текст страницы`);
          return true;
        }
      }

      const nextExists = nextTexts.length > 0 ? await existsAnyClickable(page, nextTexts) : false;
      const currentStillExists = await existsAnyText(page, currentTexts);

      if (nextExists) {
        console.log(`OK: после "${stepName}" появился следующий шаг`);
        return true;
      }

      if (!currentStillExists) {
        if (nextTexts.length > 0) {
          console.log(`"${stepName}" исчез со страницы, но следующий шаг не появился -> пробую еще раз`);
          await pause(page, 1000, 2000);
          continue;
        }

        console.log(`OK: "${stepName}" исчез со страницы, считаю шаг успешным`);
        return true;
      }

      console.log(`После "${stepName}" страница не обновилась как ожидалось, пробую еще раз`);
      await pause(page, 1000, 2000);
      continue;
    }

    if (nextTexts.length > 0 && await existsAnyText(page, nextTexts)) {
      console.log(`Хотя "${stepName}" не подтвердился, следующий шаг уже есть. Иду дальше.`);
      return true;
    }

    // Blank-page recovery: if the page has almost no content (e.g. only the clock rendered),
    // reload location.php once and retry from a clean state instead of burning all retries.
    if (!didBlankReload) {
      const bodyNow = snapshot(await getBodyText(page));
      if (bodyNow.replace(/\s+/g, '').length < 30) {
        didBlankReload = true;
        console.log(`Шаг "${stepName}": страница почти пустая ("${bodyNow}") -> перезагружаю location.php`);
        try {
          await page.goto('http://lbast.ru/location.php', { waitUntil: 'domcontentloaded', timeout: 60000 });
          await pause(page, 1000, 2000);
        } catch (e) {
          console.log(`Не удалось перезагрузить location.php: ${e.message}`);
        }
        continue;
      }
    }

    await pause(page, 1200, 2200);
  }

  if (nextTexts.length > 0 && await existsAnyText(page, nextTexts)) {
    console.log(`Перед ошибкой обнаружен следующий шаг для "${stepName}". Считаю шаг успешным.`);
    return true;
  }

  const failUrl = page.url();
  const failText = snapshot(await getBodyText(page));
  throw new Error(`Не найден или не выполнен шаг "${stepName}" (url=${failUrl}) (page="${failText}")`);
}
