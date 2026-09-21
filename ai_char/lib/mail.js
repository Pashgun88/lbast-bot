// Почта: счётчик писем, чтение/ответ на письма, emit-сообщения драйверу (MAIL/PVP/CHAT_TRIGGER), личные письма.
// Выделено из ai_char/module.js (там только сборка экспорта). Изменяемое состояние - S из ./state.

// Экспорт стоит ДО require: файлы lib/ вызывают друг друга по кругу, а объявления функций
// всплывают (hoisting), поэтому к моменту любого встречного require все функции уже здесь.
module.exports = {
  getPageTitleSafe, parseMailCountFromText, readMailCountFromIcon, getMailCountFromPage,
  emitMailMessage, emitPvpAlert, emitChatTrigger, buildMailSignature, openMailbox,
  getMailThreadIndex, clickMailThread, parseLatestMailFromText, readCurrentMail, returnToGame,
  handleUnreadMailIfAny, handleUnreadMailIfAnyInner, sendPrivateLetter, replyToLetter,
};

const { composeLetterReply } = require('../chat_autoreply');
const { noteOwnerOrder } = require('../chat_memory');
const { sendTelegram } = require('../telegram_alerts');
const { S, ENABLE_PVP_ALERTS } = require('./state');
const { getBodyText, pause } = require('./core');
const { clickByTexts } = require('./ui');

async function getPageTitleSafe(page) {
  try {
    return await page.title();
  } catch (e) {
    return '';
  }
}

function parseMailCountFromText(text) {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  const match = normalized.match(/Письма\s*\((\d+)\)/i);

  if (!match) {
    return 0;
  }

  return Number(match[1] || 0);
}

// 17.09.2026, найдено измерением: счётчик писем ЕСТЬ на location.php, но лежит в атрибуте
// картинки, а не в тексте страницы:
//   <img src="pics/icons/mail_unread.gif" title="Письма (1)">
// getBodyText возвращает innerText, куда атрибуты не попадают, поэтому parseMailCountFromText
// искал верную строку там, где её физически быть не может, и всегда возвращал 0. Из-за этого
// handleUnreadMailIfAny выходил в первой же строке КАЖДЫЙ цикл и не заметил ни одного письма
// (живая проверка: письмо от Tsunami от 17-09 15:48 висело непрочитанным, в логах - ни строки).
// Признак непрочитанного - сама иконка mail_unread.gif; число берём из её title.
async function readMailCountFromIcon(page) {
  return page
    .evaluate(() => {
      const img = document.querySelector('img[src*="mail_unread"]');
      if (!img) return 0;
      const title = (img.getAttribute('title') || '').replace(/\s+/g, ' ');
      const m = title.match(/Письма\s*\((\d+)\)/i);
      // Иконка непрочитанного есть, а число не разобралось - значит писем хотя бы одно.
      return m ? Number(m[1]) : 1;
    })
    .catch(() => 0);
}

async function getMailCountFromPage(page) {
  const iconCount = await readMailCountFromIcon(page);
  if (iconCount > 0) {
    return {
      count: iconCount,
      sourceText: `mail_unread.gif title="Письма (${iconCount})"`,
    };
  }

  const bodyText = await getBodyText(page);
  const titleText = await getPageTitleSafe(page);

  const bodyCount = parseMailCountFromText(bodyText);
  if (bodyCount > 0) {
    return {
      count: bodyCount,
      sourceText: bodyText,
    };
  }

  const titleCount = parseMailCountFromText(titleText);
  if (titleCount > 0) {
    return {
      count: titleCount,
      sourceText: titleText,
    };
  }

  return {
    count: 0,
    sourceText: bodyText || titleText || '',
  };
}

function emitMailMessage(payload) {
  try {
    const json = JSON.stringify(payload || {});
    const encoded = Buffer.from(json, 'utf8').toString('base64');
    console.log(`MAIL_MESSAGE:${encoded}`);
  } catch (e) {
    console.log(`Не удалось сериализовать письмо: ${e.message}`);
  }
}

function emitPvpAlert(payload) {
  if (!ENABLE_PVP_ALERTS) {
    return;
  }

  try {
    const json = JSON.stringify(payload || {});
    const encoded = Buffer.from(json, 'utf8').toString('base64');
    console.log(`PVP_ALERT:${encoded}`);
  } catch (e) {
    console.log(`Не удалось сериализовать PVP alert: ${e.message}`);
  }
}

// AI_SELF_NICK: определено в lib/state.js (константа нужна нескольким файлам).

// AI_SELF_NICK_RE: определено в lib/state.js (константа нужна нескольким файлам).

// Триггер чата - отдельный маркер в логе, по образцу PVP_ALERT/ATTACK_ALERT/MAIL_MESSAGE.
// Нужен потому, что обычные "CHAT UPDATE" печатаются на ЛЮБОЕ изменение комнаты, и обращение
// к нам тонет среди болтовни. CHAT_TRIGGER печатается только когда реально пора вмешаться.
function emitChatTrigger(payload) {
  try {
    const json = JSON.stringify(payload || {});
    const encoded = Buffer.from(json, 'utf8').toString('base64');
    console.log(`CHAT_TRIGGER:${encoded}`);
  } catch (e) {
    console.log(`Не удалось сериализовать chat trigger: ${e.message}`);
  }
}

function buildMailSignature(mail) {
  return [
    String(mail?.sender || '').trim(),
    String(mail?.date || '').trim(),
    String(mail?.body || '').trim().slice(0, 500),
  ].join('|');
}

async function openMailbox(page) {
  // 17.09.2026: раньше шаг жал ссылку по ТЕКСТУ Письма - и не находил её никогда. На
  // location.php почта это ИКОНКА БЕЗ ТЕКСТА (href содержит letters.php), самого слова
  // Письма на странице нет вовсе. Тот же класс ошибки, что был у счётчика непрочитанных:
  // код искал текст там, где его физически не может быть, и молча выходил. Из-за этого
  // письмо детектировалось, но ящик не открывался (Не удалось нажать на Письма).
  // Проверенный способ - брать href по подстроке letters.php (так работает replyToLetter).
  // Когда непрочитанных нет, иконка ведёт на страницу по умолчанию БЕЗ mod=inbox, где
  // списка писем нет - поэтому mod=inbox дописываем явно.
  const hrefs = await page
    .evaluate(() => Array.from(document.querySelectorAll("a"))
      .map((a) => a.getAttribute("href") || "")
      .filter((h) => h.includes("letters.php")))
    .catch(() => []);

  if (!hrefs.length) {
    console.log("Почта: на странице нет ссылки на письма (иконка letters.php не найдена).");
    return false;
  }

  let href = hrefs.find((h) => h.includes("mod=inbox")) || hrefs[0];
  if (!href.includes("mod=inbox")) href = href + "&mod=inbox";
  const url = "http://lbast.ru/" + (href[0] === "/" ? href.slice(1) : href);

  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await pause(page, 1000, 2000);
  return true;
}

async function getMailThreadIndex(page, unreadOnly = false) {
  return await page.evaluate((onlyUnread) => {
    function getStyleText(node) {
      if (!node) {
        return '';
      }

      const inlineStyle = String(node.getAttribute?.('style') || '');
      const computedStyle = window.getComputedStyle(node);

      return [
        inlineStyle,
        computedStyle.color,
        computedStyle.backgroundColor,
        computedStyle.borderLeftColor,
        computedStyle.borderLeftWidth,
        computedStyle.fontWeight,
      ].join(' ').toLowerCase();
    }

    function hasBoldUnreadMarker(anchor) {
      const nodes = [anchor, anchor.parentElement, anchor.closest('td'), anchor.closest('tr')];

      for (const node of nodes) {
        if (!node) {
          continue;
        }

        const fontWeight = window.getComputedStyle(node).fontWeight;
        const numericWeight = Number.parseInt(fontWeight, 10);

        if (!Number.isNaN(numericWeight) && numericWeight >= 600) {
          return true;
        }

        if (/bold/i.test(String(fontWeight))) {
          return true;
        }
      }

      return Boolean(anchor.querySelector('b, strong'));
    }

    function hasRedUnreadMarker(anchor) {
      let current = anchor;

      for (let depth = 0; current && depth < 4; depth += 1) {
        if (/red|rgb\(255,\s*0,\s*0\)|#f00|#ff0000/.test(getStyleText(current))) {
          return true;
        }

        for (const child of Array.from(current.children || [])) {
          if (/red|rgb\(255,\s*0,\s*0\)|#f00|#ff0000/.test(getStyleText(child))) {
            return true;
          }
        }

        current = current.parentElement;
      }

      return false;
    }

    const anchors = Array.from(document.querySelectorAll('a'));
    let bestIndex = -1;
    let bestScore = -1;

    for (let i = 0; i < anchors.length; i++) {
      const a = anchors[i];
      const text = String(a.textContent || '').replace(/\s+/g, ' ').trim();
      const href = String(a.getAttribute('href') || '').trim();
      const row = a.closest('tr') || a.closest('td') || a.parentElement;
      const parentText = String(row?.innerText || a.parentElement?.innerText || '').replace(/\s+/g, ' ').trim();
      const style = [getStyleText(a), getStyleText(a.parentElement), getStyleText(row)].join(' ');

      if (!text) {
        continue;
      }

      if (!/\[\d{2}-\d{2}\s+\d{2}:\d{2}\]/.test(parentText)) {
        continue;
      }

      const hasUnreadStyle = hasBoldUnreadMarker(a) || hasRedUnreadMarker(a);
      if (onlyUnread && !hasUnreadStyle) {
        continue;
      }

      let score = 10;

      if (hasUnreadStyle) {
        score += 20;
      }

      if (/red|ff0000|#f00|#ff0000/.test(style)) {
        score += 8;
      }

      if (/mail|post|msg|message|letter/i.test(href)) {
        score += 5;
      }

      if (text.length >= 3 && text.length <= 40) {
        score += 2;
      }

      if (score > bestScore) {
        bestScore = score;
        bestIndex = i;
      }
    }

    return bestIndex;
  }, unreadOnly);
}

async function clickMailThread(page, unreadOnly = false) {
  const index = await getMailThreadIndex(page, unreadOnly);

  if (index < 0) {
    console.log(unreadOnly
      ? '?? ??????? ????????????? ?????'
      : '?? ??????? ????? ?????? ?? ??????');
    return false;
  }

  try {
    await page.locator('a').nth(index).click({ timeout: 5000 });
    console.log('OK: ?????? ' + (unreadOnly ? '????????????? ??????' : '??????'));
    await pause(page, 1000, 2000);
    return true;
  } catch (e) {
    console.log('?? ??????? ??????? ' + (unreadOnly ? '????????????? ??????' : '??????') + ': ' + e.message);
    return false;
  }
}

function parseLatestMailFromText(text) {
  const normalized = String(text || '')
    .replace(/\r/g, '')
    .replace(/\u00A0/g, ' ')
    .trim();

  const blocks = [];
  const regex = /От:\s*(.+?)\n([\s\S]*?)(?=\nОт:\s*|\nСообщений:|$)/g;

  let match;
  while ((match = regex.exec(normalized)) !== null) {
    const sender = String(match[1] || '').trim();
    const rest = String(match[2] || '').trim();

    const dateMatch = rest.match(/(\d{2}-\d{2}\s+\d{2}:\d{2})/);
    const date = dateMatch ? dateMatch[1] : '';

    let body = rest;

    body = body.replace(/^\d{2}-\d{2}\s+\d{2}:\d{2}\s*(\[[^\]]+\]\s*)*/m, '').trim();
    body = body.replace(/^---\s*/m, '').trim();
    body = body.replace(/\n?Сообщений:\s*[\s\S]*$/m, '').trim();
    body = body.replace(/\n?Удалить цепочку писем[\s\S]*$/m, '').trim();

    blocks.push({
      sender,
      date,
      body,
    });
  }

  if (!blocks.length) {
    return null;
  }

  return blocks[0];
}

async function readCurrentMail(page) {
  const text = await getBodyText(page);
  const parsed = parseLatestMailFromText(text);

  if (!parsed) {
    console.log('Не удалось распарсить письмо на странице');
    return null;
  }

  if (!parsed.body) {
    console.log('Тело письма пустое');
    return null;
  }

  return parsed;
}

async function returnToGame(page) {
  const ok = await clickByTexts(page, ['В игру', 'в игру'], 'В игру');

  if (ok) {
    await pause(page, 1000, 2000);
    return true;
  }

  try {
    await page.goto('http://lbast.ru/location.php', {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });
    await pause(page, 1000, 2000);
    console.log('Вернулся в игру через location.php');
    return true;
  } catch (e) {
    console.log(`Не удалось вернуться в игру: ${e.message}`);
    return false;
  }
}

// Автоответ на письма (Паша, 19.09.2026, экономия токенов): письма чужих игроков отвечает Haiku
// через chat_autoreply.js, письма Tsunami (это сам Паша) пересылаются в Telegram — на них нужен
// ответ по делу, который Haiku без знания игры дать не может.
const LETTERS_FROM_OWNER_RE = /^tsunami$/i;
const TRADE_LETTER_RE = /(куп(лю|ить|ишь|ит)|прода(шь|ёшь|ешь|м|й)|почём|почем|цен[аыуе]|ч[её]тк|асас|ассас|ассы|сделк|обмен)/i;
const lettersToAnswer = [];

async function handleUnreadMailIfAny(page) {
  const handled = await handleUnreadMailIfAnyInner(page);
  while (lettersToAnswer.length) {
    const { sender, body } = lettersToAnswer.shift();
    try {
      // 20.09.2026, Паша: «если получаешь письмо от меня - реагируй, а не просто пересылай его мне
      // же в телеграм». Письмо от Tsunami - это распоряжение: отвечаем в игре по делу (без байки),
      // складываем в chat_memory/orders.jsonl (Claude читает его в начале сессии и делает то, что
      // требует кода или покупок) и только уведомляем в Telegram, что письмо принято и отвечено.
      if (LETTERS_FROM_OWNER_RE.test(sender)) {
        const order = noteOwnerOrder(sender, body);
        const reply = await composeLetterReply(sender, body, { owner: true });
        let ok = false;
        if (reply) ok = await replyToLetter(page, sender, reply);
        console.log(`Письмо от ${sender} (распоряжение): ответ ${ok ? 'отправлен' : 'НЕ отправлен'} - ${reply || 'нет'}`);
        await sendTelegram(`письмо от ${sender} принято${ok ? ' и отвечено в игре' : ' (ответ НЕ ушёл)'}: ${body}${reply ? `
Ответ AI__: ${reply}` : ''}`);
        if (order) console.log(`Распоряжение Паши записано: ${order.text.slice(0, 120)}`);
        continue;
      }
      // 21.09.2026: Паша дал от имени AI__ объявление о продаже предметов асассинов. Письма о купле-
      // продаже - это сделка, её ведёт Паша: пересылаем ему в Telegram, а в игре AI__ отвечает сам
      // (без цены и обещаний, см. <affairs> в промпте).
      if (TRADE_LETTER_RE.test(body)) {
        await sendTelegram(`письмо про сделку от ${sender}: ${body}`);
        console.log(`Письмо про сделку от ${sender} переслано Паше.`);
      }
      const reply = await composeLetterReply(sender, body);
      if (!reply) continue;
      const ok = await replyToLetter(page, sender, reply);
      console.log(`Автоответ на письмо ${sender}: ${ok ? 'отправлен' : 'НЕ отправлен'} - ${reply}`);
    } catch (e) {
      console.log(`Автоответ: ошибка ответа на письмо ${sender}: ${e.message}`);
    }
  }
  return handled;
}

async function handleUnreadMailIfAnyInner(page) {
  const mailInfo = await getMailCountFromPage(page);
  const mailCount = Number(mailInfo?.count || 0);
  const sourceText = String(mailInfo?.sourceText || '');

  if (mailCount <= 0) {
    return false;
  }

  // 17.09.2026: все сообщения этой функции были побиты кодировкой ("??????? ????? ??????") -
  // то есть даже сработав, она докладывала о письме нечитаемо, и в логе это выглядело как шум.
  console.log('Непрочитанных писем: ' + mailCount);

  let openedMailbox = false;
  const handledSignatures = new Set();
  let handledAny = false;

  try {
    openedMailbox = await openMailbox(page);

    if (!openedMailbox) {
      console.log('Почта: не удалось открыть ящик.');
      return false;
    }

    for (let i = 0; i < mailCount; i++) {
      if (i > 0) {
        openedMailbox = await openMailbox(page);
        if (!openedMailbox) {
          console.log('Почта: не удалось открыть ящик повторно.');
          break;
        }
      }

      const openedThread = await clickMailThread(page, true);
      if (!openedThread) {
        if (i === 0) {
          console.log('Почта: не удалось открыть ни одну непрочитанную переписку.');
          return false;
        }
        break;
      }

      const mail = await readCurrentMail(page);
      if (!mail) {
        console.log('Почта: не удалось прочитать письмо.');
        break;
      }

      const signature = buildMailSignature(mail);
      if (handledSignatures.has(signature)) {
        console.log('Почта: то же самое письмо открылось повторно - прекращаю обход.');
        break;
      }

      handledSignatures.add(signature);
      handledAny = true;

      if (signature === S.lastHandledMailSignature) {
        console.log('Почта: это письмо уже отправляли в Telegram, пропускаю.');
      } else {
        S.lastHandledMailSignature = signature;

        emitMailMessage({
          sender: mail.sender,
          body: mail.body,
        });
        if (mail.sender) lettersToAnswer.push({ sender: String(mail.sender), body: String(mail.body || '') });

        // Паша, 17.09.2026: "нужно автоответы сделать по типу как в чате, считай письмо это
        // тригер". MAIL_MESSAGE - машинный маркер для manager_bot.js, в логе он выглядит как
        // строка base64, и глазами его не заметить. Громкий блок печатается ровно в том же
        // формате, что чат-триггеры (>>> ПОРА ОТВЕТИТЬ), чтобы письмо требовало ответа так же
        // заметно, как обращение в клановом зале.
        console.log(`>>> ПОРА ОТВЕТИТЬ [letter] "${mail.sender || 'неизвестный'}": письмо ${i + 1}/${mailCount}`);
        for (const line of String(mail.body || '').split('\n')) {
          if (line.trim()) console.log(`    ${line.trim()}`);
        }
        console.log('');
      }
    }

    return handledAny;
  } catch (e) {
    console.log('Почта: ошибка обработки письма: ' + e.message);
    return false;
  } finally {
    if (openedMailbox) {
      await returnToGame(page);
    }
  }
}

// "Отвечаешь лично" - личное письмо конкретному игроку (letters.php, отдельная от чата
// система - на lbast.ru нет отдельного real-time приватного чата с конкретным игроком,
// только это). Форма подтверждена живьём 16.09.2026: textarea#msgbody, submit #send.
async function sendPrivateLetter(page, nick, message) {
  await page.goto(
    `http://lbast.ru/letters.php?mod=write&room=1&userlogin=${encodeURIComponent(nick)}&privat=2&fromchat=1`,
    { waitUntil: 'domcontentloaded', timeout: 60000 }
  );
  const textarea = page.locator('textarea#msgbody');
  await textarea.fill(message);
  await page.locator('input#send').click({ timeout: 8000 });
  await pause(page, 800, 1500);
}

// Ответ В ТОЙ ЖЕ переписке. Паша, 17.09.2026: "письма это тригер и отвечай так же как в чате".
// Отличается от sendPrivateLetter выше: тот бьёт в mod=write&fromchat=1 - путь личного письма
// ИЗ ЧАТА, он заводит новую переписку, а не продолжает цепочку.
// Проверено вживую 17.09.2026, игра подтвердила: "Письмо для Tsunami отправлено."
// Две ловушки, обе стоили мне неудачных попыток:
//  1) У ссылки "Ответить" ПУСТОЙ href - это не навигация, а JS-тумблер видимости формы.
//     Скрипт, ищущий href, находит пустоту и решает, что ответить нельзя.
//  2) Форма ответа уже лежит на странице письма, но скрыта (display:none). Пока тумблер не
//     нажат, Playwright отказывается заполнять поле: "element is not visible". Наличие поля
//     в разметке не означает, что с ним можно работать.
// Нонс r= у формы СВОЙ, отличный от нонса страницы, поэтому жмём саму форму, а не строим URL.
async function replyToLetter(page, nick, message) {
  await page.goto('http://lbast.ru/location.php', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await pause(page, 700, 1200);

  let inboxHref = await page.evaluate(() => {
    const a = Array.from(document.querySelectorAll('a')).find((x) => (x.getAttribute('href') || '').includes('letters.php'));
    return a ? a.getAttribute('href') : null;
  }).catch(() => null);
  if (!inboxHref) {
    console.log('Ответ на письмо: иконка почты на локации не найдена.');
    return false;
  }
  if (!inboxHref.includes('mod=inbox')) inboxHref += '&mod=inbox';

  await page.goto(`http://lbast.ru/${inboxHref.replace(/^\//, '')}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await pause(page, 600, 1000);

  const letterHref = await page.evaluate((who) => {
    const a = Array.from(document.querySelectorAll('a')).find(
      (x) => (x.getAttribute('href') || '').includes('mod=readletter') && (x.innerText || '').includes(who),
    );
    return a ? a.getAttribute('href') : null;
  }, nick).catch(() => null);
  if (!letterHref) {
    console.log(`Ответ на письмо: переписка с "${nick}" не найдена во входящих.`);
    return false;
  }

  await page.goto(`http://lbast.ru/${letterHref.replace(/^\//, '')}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await pause(page, 700, 1200);

  const toggled = await page.evaluate(() => {
    const a = Array.from(document.querySelectorAll('a')).find((x) => (x.innerText || '').trim() === 'Ответить');
    if (!a) return false;
    a.click();
    return true;
  }).catch(() => false);
  if (!toggled) {
    console.log('Ответ на письмо: тумблер "Ответить" не найден.');
    return false;
  }

  const area = page.locator('#msgbody');
  try {
    await area.waitFor({ state: 'visible', timeout: 15000 });
  } catch (e) {
    console.log('Ответ на письмо: поле ввода так и не стало видимым.');
    return false;
  }
  await area.fill(message);

  const submit = page.locator('input[type=submit][value="Ответить"]');
  if ((await submit.count().catch(() => 0)) === 0) {
    console.log('Ответ на письмо: кнопка отправки не найдена.');
    return false;
  }
  await Promise.all([
    page.waitForLoadState('domcontentloaded'),
    submit.first().click({ timeout: 15000 }),
  ]);
  await pause(page, 900, 1500);

  // Не верим клику на глаз: игра прямо пишет "Письмо для <ник> отправлено."
  const after = await getBodyText(page).catch(() => '');
  const ok = /Письмо для .* отправлено/i.test(after);
  console.log(ok
    ? `Ответ на письмо: отправлено "${nick}".`
    : `Ответ на письмо: подтверждения отправки не увидел, считаю неудачей ("${nick}").`);
  return ok;
}
