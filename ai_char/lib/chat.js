// Чат: чтение, разбор сообщений, триггеры, мониторинг комнат, раса/фракция игрока.
// Выделено из ai_char/module.js (там только сборка экспорта). Изменяемое состояние - S из ./state.

// Экспорт стоит ДО require: файлы lib/ вызывают друг друга по кругу, а объявления функций
// всплывают (hoisting), поэтому к моменту любого встречного require все функции уже здесь.
module.exports = {
  getPlayerRaceAndFaction, postChatMessage, getChatTextWithSmileys, getRecentChatMessages,
  extractChatMessagesSection, parseChatMessages, chatMessageKey, chatMessageAgeMinutes,
  detectChatTriggers, noteChatMessageSent, flushChatOutbox, runChatMonitorCycle,
};

const path = require('path');
const fs = require('fs');
const { AI_SELF_NICK_RE } = require('./state');
const { getBodyText, pause } = require('./core');
const { emitChatTrigger } = require('./mail');
const { clickByTexts } = require('./ui');

// ===== Чат: раса/фракция собеседника, публичные и личные сообщения =====
// 16.09.2026, Паша: "цель сделать автономного персонажа" - в постоянном коде, не как
// одноразовый _tmp-скрипт (см. LORE_ARDEN.md для полного контекста лора и персонажа AI__).

// Клик по нику в любой комнате чата ведёт на chat.php?mod=infa&userlogin=<ник> - страница
// профиля с полями "Раса:" и либо "Мировоззрение:" (нейтральное/тёмный - для тех, кто не в
// формальном государстве), либо "Государство:" (Империя/Сариматское Братство и т.п.).
// ВАЖНО (обнаружено живьём 16.09.2026): раса и фракция независимы друг от друга - например
// орк может состоять в Государстве Империя, а не быть автоматически Тьмой/нейтральным по
// расе. Нельзя выводить фракцию из расы, только парсить оба поля отдельно.
async function getPlayerRaceAndFaction(page, nick) {
  const currentUrl = page.url();
  try {
    await page.goto(
      `http://lbast.ru/chat.php?mod=infa&userlogin=${encodeURIComponent(nick)}&room=1&sm=`,
      { waitUntil: 'domcontentloaded', timeout: 60000 }
    );
    const text = await getBodyText(page);

    const raceMatch = text.match(/Раса:\s*([^\s,]+)/i);
    const worldviewMatch = text.match(/Мировоззрение:\s*([^\s,]+)/i);
    const stateMatch = text.match(/Государство:\s*([^\s,]+)/i);
    const clanMatch = text.match(/Клан:\s*([^\n]+?)(?=\s{2,}|Статус:|Ролевой портрет|$)/i);

    return {
      race: raceMatch ? raceMatch[1] : null,
      worldview: worldviewMatch ? worldviewMatch[1] : null,
      state: stateMatch ? stateMatch[1] : null,
      clan: clanMatch ? clanMatch[1].trim() : null,
    };
  } finally {
    await page.goto(currentUrl, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  }
}

// Отправка сообщения в общий чат комнаты (по умолчанию room=1 = Городская площадь).
async function postChatMessage(page, message, room = 1) {
  await page.goto(`http://lbast.ru/chat.php?room=${room}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  const textarea = page.locator('textarea#msgbody');
  await textarea.fill(message);
  await page.locator('input#send').click({ timeout: 8000 });
  noteChatMessageSent(room); // -> комната считается активной, опрос раз в 30 сек
  await pause(page, 800, 1500);
}

// Читает последние сообщения комнаты как {nick, text} - используется, чтобы заметить чей-то
// ответ на сообщение AI__ (сопоставление по нику из ссылки mod=infa рядом с текстом сообщения).
// Смайлы в чате - это картинки <img src="smile/pivo.gif" title=".pivo.">, и innerText их просто
// выбрасывает. Паша, 18.09.2026: "а смайлики ты почему-то не видишь" - реплики Galla "AI__, [пиво]"
// доходили как пустое "AI__,". Подменяем каждую картинку-смайл её кодом (.pivo.), тогда код
// виден в тексте, а в ответ можно поставить смайл тем же кодом. Полный список кодов -
// ai_char/SMILES_AI_CHAR.txt (снят со страницы "Справка: смайлы").
async function getChatTextWithSmileys(page) {
  await page.evaluate(() => {
    document.querySelectorAll('img[src*="smile/"]').forEach((im) => {
      im.replaceWith(document.createTextNode(` ${im.getAttribute('title') || '.smile.'} `));
    });
  }).catch(() => {});
  return getBodyText(page);
}
async function getRecentChatMessages(page, room = 1) {
  const url = `http://lbast.ru/chat.php?room=${room}`;
  const alreadyInRoom = String(page.url() || '').includes(`chat.php?room=${room}`);

  // Паша, 17.09.2026: "чат не обновляешь. Нужно нажимать обновить". Повторный goto на ТОТ ЖЕ
  // адрес чат сам прерывает - в логе это видно как net::ERR_ABORTED, и комната остаётся со
  // старым содержимым, то есть монитор не видит новых сообщений вообще. Штатный способ
  // обновления в игре - ссылка "Обновить" на самой странице чата.
  if (alreadyInRoom) {
    const refreshed = await clickByTexts(page, ['Обновить'], `Обновить чат (room=${room})`).catch(() => false);
    if (refreshed) {
      await pause(page, 500, 900);
      return await getChatTextWithSmileys(page);
    }
  }

  // Первый заход в комнату (или "Обновить" не нашлась) - обычная навигация.
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  await pause(page, 400, 800);
  return await getChatTextWithSmileys(page);
}

// Живой факт (16.09.2026): полный текст страницы чата всегда меняется между опросами даже
// без новых сообщений - в шапке есть текущее время ("14:19:47, Ср.") и HP/кулдаун персонажа
// ("AI__ (200/340) (40)"), которые тикают каждую минуту сами по себе. Diff по ПОЛНОМУ тексту
// (как было в первой версии runChatMonitorCycle) ложно срабатывал почти на каждом опросе для
// каждой комнаты, независимо от реальной активности - шум забивал сигнал. Вырезаем только
// секцию с реальными сообщениями (между "Смайлы" и футером "Вперед - Обновить"/"Заметки -")
// и сравниваем именно её.
function extractChatMessagesSection(fullText) {
  const marker = 'Смайлы';
  const startIdx = fullText.indexOf(marker);
  let section = startIdx >= 0 ? fullText.slice(startIdx + marker.length) : fullText;
  const endMarkers = ['Вперед - Обновить', 'Заметки -'];
  let endIdx = section.length;
  for (const m of endMarkers) {
    const idx = section.indexOf(m);
    if (idx >= 0 && idx < endIdx) endIdx = idx;
  }
  return section.slice(0, endIdx).trim();
}

// Формат сообщения (снято живьём 17.09.2026 из лога драйвера):
//   Hacky [13.08]
//    Universe, Ceadmil, bloede dh'oine!
// Строка "Ник [ЧЧ.ММ]", следом строка с текстом. Сообщения идут сверху вниз ОТ НОВЫХ К СТАРЫМ.
// Обращение к собеседнику оформляется как "Ник, текст" в начале сообщения.
function parseChatMessages(sectionText) {
  const lines = String(sectionText || '').split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].trim().match(/^(\S+)\s*\[(\d{1,2})\.(\d{2})\]$/);
    if (!m) continue;
    const text = (lines[i + 1] || '').trim();
    if (!text) continue;
    out.push({ nick: m[1], hh: Number(m[2]), mm: Number(m[3]), text });
  }
  return out;
}

function chatMessageKey(m) {
  return `${m.nick}|${m.hh}.${m.mm}|${m.text}`;
}

// Возраст сообщения в минутах по времени из чата (местное время сервера совпадает с нашим -
// в шапке страницы тот же час). Если время "из будущего" - считаем, что это вчерашнее.
function chatMessageAgeMinutes(m, nowDate = new Date()) {
  const msgMinutes = m.hh * 60 + m.mm;
  const nowMinutes = nowDate.getHours() * 60 + nowDate.getMinutes();
  const diff = nowMinutes - msgMinutes;
  return diff >= 0 ? diff : diff + 24 * 60;
}

// Паша, 17.09.2026: "ничего не копить, только живое" - сигналы старше этого порога
// выбрасываются: лучше промолчать, чем ответить на разговор часовой давности.
const CHAT_TRIGGER_MAX_AGE_MIN = 15;
// "Оживление после тишины": несколько новых сообщений подряд в комнате, которая молчала.
const CHAT_QUIET_FOR_REVIVAL_MS = 20 * 60_000;
const CHAT_REVIVAL_MIN_MESSAGES = 2;
// "Развлекательный момент" (Паша: "я хочу чтобы ты сам писал, отталкиваясь от характера
// персонажа") - повод заговорить первым в давно молчащей комнате, но не чаще раза в 3 часа,
// иначе это уже не характер, а спам.
// Паша, 18.09.2026: "пиши иногда в клановом зале, заводи беседу". При 90 мин тишины и
// раз в 3 часа инициатива почти не срабатывала.
// Паша, 18.09.2026 (вечер): "если в чате тишина более 2х часов днём с 4 утра по 23:00, то
// пиши что-нибудь, заводи разговор". Ночью (23:00-04:00) AI__ первым не пишет.
// 21.09.2026: оживление комнаты (revival) выключено - отвечаем только когда обращаются.
const CHAT_REACT_TO_ROOM = false;
// Обращение к AI__ в тексте: ник или прозвище «Айк» (Паша, 21.09.2026: «откликайся на Айк/айк
// тоже»), с падежами (Айка, Айку, Айком, Айке). Границы слова для кириллицы - явными классами:
// \b в JS только ASCII. Для ника собеседника (m.nick) по-прежнему AI_SELF_NICK_RE - игрок с ником
// вроде «Айкидо» не должен считаться нами.
const AI_MENTION_RE = /(\bAI__\b|(^|[^а-яёА-ЯЁA-Za-z0-9_])[Аа]йк(а|у|ом|е)?(?![а-яёА-ЯЁA-Za-z0-9_]))/;
const CHAT_INITIATIVE_QUIET_MS = 120 * 60_000;
const CHAT_INITIATIVE_COOLDOWN_MS = 120 * 60_000;
// 21.09.2026, Паша: «с 23 до 5 сон» - первым AI__ пишет только с 5:00 (было с 4:00).
const CHAT_INITIATIVE_FROM_HOUR = 5;
const CHAT_INITIATIVE_TO_HOUR = 23;
// Сколько минут после нашей реплики чужое сообщение считается ответом нам.
const CHAT_REPLY_WINDOW_MIN = 15;
const CHAT_GREETING_RE = /(^|\s)(привет\w*|здаров\w*|здорово|здравствуй\w*|доброго|добрый\s+(?:день|вечер)|доброе\s+утро|салют|хай|ку)(\s|[,!.?)]|$)/i;

// Решает, есть ли повод вмешаться. Возвращает список триггеров; пустой список = молчим.
function detectChatTriggers(roomInfo, prevMsgs, nextMsgs, opts = {}) {
  const { quietForMs = 0, lastInitiativeAt = 0, now = Date.now() } = opts;
  const triggers = [];
  const nowDate = new Date(now);
  const base = { room: roomInfo.room, roomName: roomInfo.name, at: new Date(now).toISOString() };

  // При первом наблюдении комнаты вся история выглядит "новой", поэтому обычные поводы
  // (приветствие, оживление, инициатива) подавляются - иначе рестарт драйвера реагировал бы
  // на всю ленту разом.
  //
  // НО прямое обращение к AI__ подавлять НЕЛЬЗЯ. Живой провал 17.09.2026: Galla написала
  // "AI__, кто ты, воин?", драйвер в этот момент был перезапущен, вопрос попал в "историю"
  // первого наблюдения и был проглочен - Паша: "у тебя в чате спрашивают а ты молчишь".
  // Так как я перезапускал драйвер десятки раз, а клановый зал опрашивается раз в 20 минут,
  // мониторинг чата фактически не работал ни разу. От древних обращений защищает фильтр по
  // возрасту (CHAT_TRIGGER_MAX_AGE_MIN), а не подавление первого наблюдения.
  const firstObservation = prevMsgs.length === 0;
  const seen = new Set(prevMsgs.map(chatMessageKey));
  const fresh = nextMsgs.filter((m) => !seen.has(chatMessageKey(m)));

  // Лента идёт новыми сверху. Всё, что НИЖЕ последнего сообщения AI__, написано до нашего
  // ответа - на это мы уже отреагировали. 18.09.2026: одно неполное обновление чата стёрло
  // prevMsgs, и обе старые реплики Galla ("а оркам отдыхать можно?", "ну спасибо") снова
  // пришли как новые обращения. Это правило от prevMsgs не зависит.
  const ownIdx = nextMsgs.findIndex((m) => AI_SELF_NICK_RE.test(m.nick));
  const newerThanOurReply = (m) => ownIdx < 0 || nextMsgs.indexOf(m) < ownIdx;

  const live = fresh.filter((m) => {
    if (AI_SELF_NICK_RE.test(m.nick)) return false; // своё же сообщение
    if (!newerThanOurReply(m)) return false;
    return chatMessageAgeMinutes(m, nowDate) <= CHAT_TRIGGER_MAX_AGE_MIN;
  });

  // Паша, 18.09.2026: "отвечай на все сообщения, адресованные тебе". Ответ на нашу реплику
  // часто приходит без ника (Galla: "У нас, кстати, хорошенькие гномихи" - сразу после
  // шутки AI__ про гномих) и раньше не ловился вовсе. Всё, что пришло в течение
  // CHAT_REPLY_WINDOW_MIN после нашего сообщения, считаем адресованным нам.
  const ownLastForReply = nextMsgs.find((m) => AI_SELF_NICK_RE.test(m.nick));
  const inReplyWindow = ownLastForReply
    && chatMessageAgeMinutes(ownLastForReply, nowDate) <= CHAT_REPLY_WINDOW_MIN;
  // 21.09.2026, Паша: «тебе не нужно на каждое сообщение отвечать в чате. Только если к тебе
  // обращаются, поддерживай разговор, и иногда пиши, если тишина более двух часов». Ответом нам
  // считаем только сообщение собеседника: если наша реплика начиналась с «Ник,», ждём ответа от
  // этого ника; реплика без адресата (сами заговорили) - отвечать может любой.
  const ownAddressee = ownLastForReply && (ownLastForReply.text.match(/^\s*([A-Za-z0-9_.-]+)\s*,/) || [])[1];
  const isOurInterlocutor = (nick) => !ownAddressee || ownAddressee.toLowerCase() === String(nick).toLowerCase();

  for (const m of live) {
    if (AI_MENTION_RE.test(m.text)) {
      triggers.push({ ...base, type: 'mention', nick: m.nick, text: m.text,
        reason: `${m.nick} обратился к AI__` });
    // "Tsunami, и за месяц спустила..." - обращение к ДРУГОМУ нику: это не нам, даже если пришло
    // сразу после нашей реплики (первая ложная сработка 18.09.2026).
    } else if (!firstObservation && inReplyWindow && isOurInterlocutor(m.nick)
      && !/^[A-Za-z0-9_.-]+\s*,/.test(m.text)) {
      triggers.push({ ...base, type: 'reply', nick: m.nick, text: m.text,
        reason: `${m.nick} ответил после реплики AI__` });
    }
    // Приветствия всем подряд и «оживление» комнаты больше не повод (Паша, 21.09.2026) - см. выше.
  }

  if (CHAT_REACT_TO_ROOM && !firstObservation && live.length >= CHAT_REVIVAL_MIN_MESSAGES
      && quietForMs >= CHAT_QUIET_FOR_REVIVAL_MS
      && !triggers.some((t) => t.type === 'mention' || t.type === 'reply')) {
    triggers.push({ ...base, type: 'revival',
      reason: `после тишины пошёл разговор (${live.length} сообщений)`,
      lines: live.slice(0, 6).map((m) => `${m.nick}: ${m.text}`) });
  }

  // quietForMs обязан быть КОНЕЧНЫМ числом: при первом наблюдении комнаты истории тишины нет
  // (lastChangeAt = 0), и старое условие давало "молчит Infinity мин" - initiative срабатывал
  // сразу на каждом запуске драйвера. Живой случай 17.09.2026, сразу после включения триггеров.
  // Пауза между инициативами считается и по САМОЙ ЛЕНТЕ: lastInitiativeAt живёт в памяти и
  // обнуляется при каждом перезапуске драйвера. 18.09.2026 после рестарта пришёл сигнал
  // "заговорить первым" через 40 минут после моей последней реплики - а до неё было пять
  // подряд. Последнее сообщение AI__ в ленте переживает любые перезапуски.
  const ownLast = nextMsgs.find((m) => AI_SELF_NICK_RE.test(m.nick));
  const ownLastAgoMs = ownLast ? chatMessageAgeMinutes(ownLast, nowDate) * 60_000 : Infinity;
  if (!firstObservation && fresh.length === 0
      && Number.isFinite(quietForMs) && quietForMs >= CHAT_INITIATIVE_QUIET_MS
      && now - lastInitiativeAt >= CHAT_INITIATIVE_COOLDOWN_MS
      && ownLastAgoMs >= CHAT_INITIATIVE_COOLDOWN_MS
      && nowDate.getHours() >= CHAT_INITIATIVE_FROM_HOUR && nowDate.getHours() < CHAT_INITIATIVE_TO_HOUR) {
    triggers.push({ ...base, type: 'initiative',
      reason: `комната молчит ${Math.round(quietForMs / 60000)} мин - повод заговорить первым` });
  }

  return triggers;
}

// Список комнат чата (найдено живьём 16.09.2026, chat.php лобби) - Паша попросил
// активность сразу в нескольких, не только на Городской площади.
// Паша, 17.09.2026: "по чатам - смотри клановый зал, остальные пока не нужно". Оставлена
// одна комната. Остальные НЕ удалены, а отключены - вернуть можно, раскомментировав строку.
// Появились после вступления AI__ в клан "Боги войны" 16.09.2026 - см. LORE_ARDEN.md.
// idlePollMs=20 мин - из более раннего указания: "если никого нет раз в 20 минут, если идет
// общение поддерживаешь беседу" (при активности интервал сам падает до CHAT_ACTIVE_POLL_MS).
const CHAT_ROOMS = [
  // idlePollMs убран: теперь общий CHAT_IDLE_POLL_MS = 5 минут (Паша, 17.09.2026).
  { room: 12, name: 'Клановый зал' },
  // Отключены 17.09.2026 по просьбе Паши:
  // { room: 1, name: 'Городская площадь' },
  // { room: 2, name: 'Сады Афродиты' },
  // { room: 3, name: 'Вопросы по игре' },
  // { room: 4, name: 'Эльфийская деревня' },
  // { room: 5, name: 'Торба на круче' },
  // { room: 6, name: 'Казармы орков' },
  // { room: 7, name: 'Пещера гномов' },
  // { room: 200, name: 'Таверна' },
  // { room: 300, name: 'Ролевая' },   // ВАЖНО: только здесь допустим формат /действие/
  // { room: 51, name: 'Имперский зал' },
];

// Адаптивный опрос (16.09.2026, Паша: "обновляй чаще, если в комнате пошло общение можешь ее
// обновлять раз в 30 сек" - до этого все 9 комнат опрашивались одинаково раз в CHAT_POLL_INTERVAL_MS
// целиком, что и медленно реагирует на живой разговор, и просто лишний трафик для тихих комнат).
// Комната считается "активной" ACTIVE_WINDOW_MS после последнего замеченного изменения - в этом
// окне она проверяется каждые ACTIVE_POLL_MS, иначе раз в IDLE_POLL_MS (или в room.idlePollMs,
// если для комнаты задан отдельный интервал - см. Клановый зал выше).
// Паша, 17.09.2026: "проверяй каждые 5 минут, а когда отправляешь сообщение - 30 сек, когда
// общение прекратилось опять 5 минут". Активное окно = сколько держится режим 30 секунд
// после последнего движения в комнате (нового сообщения ИЛИ нашей собственной отправки).
const CHAT_ACTIVE_POLL_MS = 30_000;
// Паша, 18.09.2026: "почему так долго отвечал в клан зале?" - при опросе раз в 5 минут
// реплику Galla заметили через 5 минут. Раз в минуту - всё ещё спокойно для сервера.
const CHAT_IDLE_POLL_MS = 60_000;
const CHAT_ACTIVE_WINDOW_MS = 15 * 60_000;

// Когда МЫ написали в комнату - ждём ответа, а значит следующие CHAT_ACTIVE_WINDOW_MS
// опрашиваем её раз в 30 секунд. Хранится здесь, а не в state драйвера, чтобы работало при
// любом вызове postChatMessage (в том числе из разовых скриптов).
const lastChatSentAt = {};
function noteChatMessageSent(room) {
  lastChatSentAt[room] = Date.now();
}

// state: {[room]: {lastText, lastChangeAt, lastCheckedAt}} - переиспользуется между вызовами,
// начать с {}. Каждый вызов проверяет только те комнаты, чей интервал уже истёк (не долбит все
// 9 комнат разом каждый раз), с паузой между реальными проверками внутри одного тика.
// Исходящие реплики. Реплику пишет Claude (драйвер сам не разговаривает), но профиль браузера
// занят драйвером, и отправка из разового скрипта означала бы останавливать фарм. Поэтому:
// Claude кладёт реплики в chat_outbox.json ([{room, text}]), вкладка чата отправляет их на
// ближайшем опросе и очищает файл. Файл в .gitignore.
const CHAT_OUTBOX_FILE = path.join(__dirname, '..', 'chat_outbox.json');

async function flushChatOutbox(chatPage) {
  let items;
  try {
    items = JSON.parse(fs.readFileSync(CHAT_OUTBOX_FILE, 'utf8'));
  } catch (e) {
    return 0; // файла нет или он пуст - нечего отправлять
  }
  if (!Array.isArray(items) || items.length === 0) return 0;
  // Очищаем ДО отправки: лучше потерять реплику при сбое, чем повторить её в чат дважды.
  fs.writeFileSync(CHAT_OUTBOX_FILE, '[]');
  let sent = 0;
  for (const it of items) {
    const text = String((it && it.text) || '').trim().slice(0, 500);
    const room = Number((it && it.room) || 12);
    if (!text) continue;
    try {
      await postChatMessage(chatPage, text, room);
      console.log(`CHAT_SENT room=${room}: ${text}`);
      sent += 1;
    } catch (e) {
      console.log(`CHAT_SEND_FAILED room=${room}: ${e.message}`);
    }
  }
  return sent;
}

async function runChatMonitorCycle(chatPage, state) {
  await flushChatOutbox(chatPage).catch((e) => console.log('Chat outbox error:', e.message));
  const now = Date.now();
  const changed = [];
  let didAnyFetch = false;
  for (const { room, name, idlePollMs } of CHAT_ROOMS) {
    const s = state[room] || { lastText: undefined, lastChangeAt: 0, lastCheckedAt: 0 };
    const sentAt = lastChatSentAt[room] || 0;
    const isActive = (now - s.lastChangeAt < CHAT_ACTIVE_WINDOW_MS)
      || (now - sentAt < CHAT_ACTIVE_WINDOW_MS);
    const intervalMs = isActive ? CHAT_ACTIVE_POLL_MS : (idlePollMs || CHAT_IDLE_POLL_MS);
    if (now - s.lastCheckedAt < intervalMs) {
      state[room] = s;
      continue;
    }
    if (didAnyFetch) {
      await pause(chatPage, 3000, 6000);
    }
    const text = await getRecentChatMessages(chatPage, room).catch((e) => {
      console.log(`Chat monitor: ошибка чтения комнаты "${name}" (room=${room}):`, e.message);
      return null;
    });
    didAnyFetch = true;
    s.lastCheckedAt = now;
    if (text === null) {
      state[room] = s;
      continue;
    }
    const messagesOnly = extractChatMessagesSection(text);
    const nextMsgs = parseChatMessages(messagesOnly);
    // 18.09.2026: каждое ВТОРОЕ обновление чата приходило пустым (0 сообщений, потом снова 14).
    // Комната от этого "менялась" каждые полминуты: lastChangeAt не старел, и инициатива
    // (30 мин тишины) не срабатывала НИКОГДА, а lastMsgs затирался, и старые обращения
    // приходили повторно. Живая лента из 14 сообщений не пустеет за полминуты, так что пустое
    // чтение после непустого - это сбой чтения, а не событие в комнате. Пропускаем его.
    if (nextMsgs.length === 0 && (s.lastMsgs || []).length > 0) {
      state[room] = s;
      continue;
    }
    const textChanged = s.lastText !== undefined && s.lastText !== messagesOnly;

    // Триггеры считаем ВСЕГДА, а не только при изменении текста: "развлекательный момент"
    // должен сработать именно в молчащей комнате, где ничего не менялось.
    const triggers = detectChatTriggers({ room, name }, s.lastMsgs || [], nextMsgs, {
      // null, а не Infinity: пока мы не видели ни одного изменения, про длину тишины ничего
      // не известно - "мы только что пришли" это не "комната давно молчит".
      // После перезапуска lastChangeAt нет, и раньше тишина считалась неизвестной до первого
      // изменения - в молчащем зале инициатива не срабатывала никогда. Время самого свежего
      // сообщения в ленте даёт честную длину тишины и без этого.
      quietForMs: s.lastChangeAt
        ? now - s.lastChangeAt
        : (nextMsgs.length ? chatMessageAgeMinutes(nextMsgs[0], new Date(now)) * 60_000 : null),
      lastInitiativeAt: s.lastInitiativeAt || 0,
      now,
    });
    if (triggers.some((t) => t.type === 'initiative')) {
      s.lastInitiativeAt = now;
    }
    for (const t of triggers) {
      emitChatTrigger(t);
    }

    if (textChanged || triggers.length > 0) {
      changed.push({ room, name, text, triggers });
      if (textChanged) s.lastChangeAt = now;
    }
    s.lastText = messagesOnly;
    s.lastMsgs = nextMsgs;
    state[room] = s;
  }
  return changed;
}

// Константы экспортируются в конце (их нет до выполнения этих строк). Берёт их только module.js.
Object.assign(module.exports, {
  CHAT_ROOMS,
});
