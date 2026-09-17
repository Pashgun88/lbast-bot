// Проверка разбора чата и триггеров на РЕАЛЬНОМ образце из лога. Браузер не нужен - функции
// чистые. Файл временный, удаляется после проверки.
const { parseChatMessages, detectChatTriggers, chatMessageAgeMinutes } = require('./module');

let failures = 0;
function check(name, cond, extra = '') {
  console.log(`${cond ? 'OK  ' : 'FAIL'}  ${name}${extra ? ' | ' + extra : ''}`);
  if (!cond) failures++;
}

// --- 1. Разбор: точный кусок из лога драйвера (то, что идёт после "Смайлы") ---
const SAMPLE = [
  'Hacky [13.08]',
  " Universe, Ceadmil, bloede dh'oine! Фокус-покус... Чары-мары... Arse blathanna!",
  '_Focus_ [12.12]',
  ' Universe, сказала самая занудная эльфийка бастиона',
  'Universe [11.53]',
  ' Ладно фокус человек, но он скучный, тут все ясно',
  'Universe [11.53]',
  ' Hacky, Это мне эльф говорит?',
  'Iliniel [07.19]',
  ' _Focus_, Путь мой брааат, судьба сестраааа',
  'Sylque [07.10]',
  ' Блат',
].join('\n');

const parsed = parseChatMessages(SAMPLE);
check('разбор находит все 6 сообщений', parsed.length === 6, `найдено ${parsed.length}`);
check('первое сообщение - Hacky в 13.08', parsed[0] && parsed[0].nick === 'Hacky' && parsed[0].hh === 13 && parsed[0].mm === 8,
  JSON.stringify(parsed[0]));
check('ник с подчёркиваниями (_Focus_) разобран', parsed.some((m) => m.nick === '_Focus_'));
check('текст привязан к нужному нику', parsed[5] && parsed[5].nick === 'Sylque' && parsed[5].text === 'Блат',
  JSON.stringify(parsed[5]));

// --- 2. Триггеры. Время берём текущее, чтобы сообщения считались "живыми". ---
const now = Date.now();
const d = new Date(now);
const hh = d.getHours();
const mm = d.getMinutes();
const fresh = (nick, text) => ({ nick, hh, mm, text });
const OLD = { nick: 'Sylque', hh: (hh + 23) % 24, mm, text: 'старое сообщение' }; // ~час назад
const ROOM = { room: 12, name: 'Клановый зал' };
const prev = [OLD];

const tMention = detectChatTriggers(ROOM, prev, [fresh('Hacky', 'AI__, ты чего молчишь?'), OLD], { quietForMs: 0, now });
check('обращение к AI__ -> mention', tMention.some((t) => t.type === 'mention'), JSON.stringify(tMention.map((t) => t.type)));

const tGreet = detectChatTriggers(ROOM, prev, [fresh('Hacky', 'всем привет!'), OLD], { quietForMs: 0, now });
check('приветствие -> greeting', tGreet.some((t) => t.type === 'greeting'), JSON.stringify(tGreet.map((t) => t.type)));

const tRevival = detectChatTriggers(ROOM, prev,
  [fresh('Hacky', 'о, кто тут'), fresh('Universe', 'да вот сижу'), OLD],
  { quietForMs: 40 * 60_000, now });
check('тишина + 2 сообщения -> revival', tRevival.some((t) => t.type === 'revival'), JSON.stringify(tRevival.map((t) => t.type)));

const tInit = detectChatTriggers(ROOM, prev, [OLD], { quietForMs: 120 * 60_000, lastInitiativeAt: 0, now });
check('долгая тишина -> initiative', tInit.some((t) => t.type === 'initiative'), JSON.stringify(tInit.map((t) => t.type)));

const tInitCooldown = detectChatTriggers(ROOM, prev, [OLD],
  { quietForMs: 120 * 60_000, lastInitiativeAt: now - 10 * 60_000, now });
check('initiative не повторяется в кулдаун', !tInitCooldown.some((t) => t.type === 'initiative'));

// Устаревшее сообщение (час назад) не должно давать триггер - "только живое".
const tStale = detectChatTriggers(ROOM, prev, [{ nick: 'Hacky', hh: (hh + 23) % 24, mm, text: 'AI__, ответь' }, OLD],
  { quietForMs: 0, now });
check('сообщение часовой давности игнорируется', !tStale.some((t) => t.type === 'mention'), JSON.stringify(tStale.map((t) => t.type)));

// Первое наблюдение комнаты: история не должна считаться поводом.
const tFirst = detectChatTriggers(ROOM, [], [fresh('Hacky', 'AI__, привет')], { quietForMs: 0, now });
check('первое наблюдение комнаты не триггерит', tFirst.length === 0, JSON.stringify(tFirst.map((t) => t.type)));

// Живой баг 17.09.2026: при первом наблюдении lastChangeAt = 0, "тишина" выходила Infinity,
// и initiative срабатывал сразу на каждом запуске драйвера.
const tFirstInit = detectChatTriggers(ROOM, [], [OLD], { quietForMs: null, lastInitiativeAt: 0, now });
check('первое наблюдение не даёт initiative', !tFirstInit.some((t) => t.type === 'initiative'),
  JSON.stringify(tFirstInit.map((t) => t.type)));

const tInfinite = detectChatTriggers(ROOM, prev, [OLD], { quietForMs: Infinity, lastInitiativeAt: 0, now });
check('бесконечная тишина не считается поводом', !tInfinite.some((t) => t.type === 'initiative'),
  JSON.stringify(tInfinite.map((t) => t.type)));

// Своё же сообщение не должно триггерить.
const tSelf = detectChatTriggers(ROOM, prev, [fresh('AI__', 'всем привет, я AI__'), OLD], { quietForMs: 0, now });
check('собственное сообщение не триггерит', tSelf.length === 0, JSON.stringify(tSelf.map((t) => t.type)));

check('возраст сообщения считается верно', chatMessageAgeMinutes({ hh, mm }, d) === 0);

console.log(failures === 0 ? '\nВСЕ ПРОВЕРКИ ПРОШЛИ' : `\nПРОВАЛЕНО: ${failures}`);
process.exit(failures === 0 ? 0 : 1);
