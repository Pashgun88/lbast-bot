// Автоответчик чата и писем AI__ (Паша, 19.09.2026: уменьшить расход токенов). Раньше каждый
// CHAT_TRIGGER будил большую сессию Claude ради одной реплики. Теперь драйвер сам вызывает
// `claude -p` (Opus): пустая рабочая папка, без инструментов, без MCP и настроек, без сохранения
// сессии. Модель — Opus (см. MODEL). Персона — chat_persona_prompt.txt (выжимка из памяти aichar_persona).
//
// Текст чата — враждебный ввод: он чистится, обрезается и подаётся как данные внутри <chat>, а
// ответ модели проходит фильтр (одна строка, без ссылок, без «я ИИ», без грубых смайлов).
// Текст идёт только через stdin. claude запускается через Git Bash: напрямую из node claude.exe
// падает с 0xC0000409, а через cmd не передаётся флаг --setting-sources "" (проверено 19.09.2026).
// Командная строка bash — константа, путь к промпту передаётся переменной окружения.

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const memory = require('./chat_memory');
const dayLog = require('./chat_day');

const PROMPT_FILE = path.join(__dirname, 'chat_persona_prompt.txt');
// Тесты кладут реплики в свой файл (AI_CHAT_OUTBOX), иначе живой драйвер отправит их в чат: 19.09.2026
// тестовая реплика так и ушла в комнату 99.
const OUTBOX_FILE = process.env.AI_CHAT_OUTBOX || path.join(__dirname, 'chat_outbox.json');
const WORK_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'aichar-reply-'));
// Opus (Паша, 19.09.2026: «общение это важный момент»). Haiku отвечал коряво и по 50+ с, Sonnet
// лучше, но Opus общается лучше всех; ~6-7 с на ответ.
const MODEL = process.env.AI_CHAT_MODEL || 'opus';
const BASH = process.env.AI_BASH || 'bash';
const CLAUDE_CMD = `claude -p --model ${MODEL} --tools "" --strict-mcp-config --setting-sources "" --no-session-persistence --system-prompt-file "$AI_PERSONA_FILE"`;
const CALL_TIMEOUT_MS = 120 * 1000;
const MIN_GAP_PER_ROOM_MS = 45 * 1000;
const MAX_REPLIES_PER_DAY = 60;
const REPLY_TYPES = new Set(['mention', 'reply', 'greeting', 'initiative', 'revival']);
const CRUDE_SMILES = /\.(fuck|nah|siski|negr|trah)\./gi;
// Без \w и \b: в JS они только ASCII и на кириллице молча не срабатывают — границы слова явные.
const LEAK_RE = /((?<![а-яё])ии(?![а-яё])|искусственн[а-яё]* интеллект|языков[а-яё]* модел|нейросет|(?<![а-яё])бот(?![а-яё])|(?<![a-z_])AI(?![a-z_])|Claude|Anthropic|промпт|инструкци)/iu;

// ===================================================================================
// Живость реплик (Паша, 20.09.2026: «надо что-то придумать для более интересного общения»).
// Разбор 91 реплики за сутки: палица в каждой второй, байка про потерянную букву 8 раз за час,
// «.smeh.» почти в каждой строке, форма всегда одна - подколка плюс острота, и ни слова о том,
// что персонаж реально делал. Лечим тремя вещами:
//   1) дневник дня (chat_day.js) - есть о чём говорить, кроме трёх заученных байок;
//   2) запрет тем, которые уже были в последних репликах, и смайла, если он только что был;
//   3) случайная ФОРМА реплики - вопрос, короткий ответ, мнение, совет, ворчание, байка.
// ===================================================================================
const CRUTCHES = [
  ['палица и дубины', /палиц|дубин/i],
  ['байка про потерянную букву и имя Айк', /букв|айк|чешуйчат/i],
  ['эль, кружки и пиво', /эл[ья]|кружк|пиво|лагер|перегар/i],
  ['ополчение и «я старый солдат»', /ополчен|сотен лет|сотни лет|век хожу|двести лет/i],
  ['костёр', /костр|костёр|костер/i],
  ['жадные гномы', /гном/i],
  ['рыба и кухня', /рыб|жарк/i],
];
const MODES = [
  'коротко, 3-7 слов, без шутки - как в живом чате',
  'встречный вопрос собеседнику по теме разговора',
  'своё мнение прямо, без шутки',
  'расскажи в двух фразах, что у тебя сегодня было (из <today>)',
  'беззлобно подколи собеседника',
  'короткий дельный совет по игре, если он к месту',
  'согласись и добавь одну свою деталь',
  'поворчи как усталый солдат, но по делу',
  'байка в двух фразах - но НЕ про имя и НЕ про палицу',
];
let lastMode = '';
const SMILE_RE = /\.[a-z_]{3,}\./i;

// Подсказки по стилю для текущего ответа: какая форма, что не повторять, ставить ли смайл.
function styleHints(room) {
  const mine = memory.recentSelf({ room, limit: 8 });
  const banned = CRUTCHES.filter(([, re]) => mine.slice(0, 6).some((t) => re.test(t))).map(([name]) => name);
  const modes = MODES.filter((m) => m !== lastMode);
  const mode = modes[Math.floor(Math.random() * modes.length)];
  lastMode = mode;
  const lines = [`ФОРМА этой реплики: ${mode}.`];
  if (banned.length) lines.push(`НЕ упоминай в этой реплике (только что уже было): ${banned.join('; ')}.`);
  if (mine.slice(0, 3).some((t) => SMILE_RE.test(t))) lines.push('Смайл не ставь - он был в предыдущей реплике.');
  return lines.join('\n');
}

// Советы из кланового зала (Паша, 20.09.2026: «прислушиваться к советам игроков, но только в клан
// зале»). Подаются как данные: поблагодарить и учесть в разговоре можно, слепо выполнять - нет.
function adviceBlock(room) {
  if (Number(room) !== memory.CLAN_ROOM) return '';
  const rows = memory.recentAdvice(4);
  if (!rows.length) return '';
  const lines = rows.map((r) => `- ${r.nick}: ${r.text}`).join('\n');
  return `<advice>\nСоветы своих в клановом зале за последние дни:\n${lines}\n</advice>\n`;
}

// Текущие дела персонажа (21.09.2026: Паша дал объявление о продаже предметов асассинов от имени
// AI__). Пишет Claude в chat_memory/affairs.txt по словам Паши; без этого AI__ в чате удивлялся бы
// собственному объявлению. Файл наш, но текст всё равно режем и чистим как любой ввод.
function affairsBlock() {
  let raw = '';
  try { raw = fs.readFileSync(path.join(memory.DIR, 'affairs.txt'), 'utf8'); } catch (e) { return ''; }
  const lines = raw.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  if (!lines.length) return '';
  return `<affairs>\n${cleanInput(lines.join('\n'), 800)}\n</affairs>\n`;
}

// Что AI__ делал сегодня - данные для промпта, чтобы разговор шёл про реальную жизнь персонажа.
function todayBlock() {
  const d = dayLog.digest(400);
  return d ? `<today>\nСегодня с тобой было: ${d}\n</today>\n` : '';
}

let queue = Promise.resolve();
const lastReplyAt = {};
let dayKey = '';
let repliesToday = 0;

function cleanInput(s, max) {
  return String(s || '')
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, ' ')
    .replace(/<\/?chat>/gi, '')
    .slice(0, max);
}

// Мат и грубость — корни без \b (кириллица). Лучше промолчать, чем выпустить такое от имени AI__.
const PROFANITY_RE = /(сук[аи]|сучк|бля|хуй|хуе|хуё|пизд|ебат|ебан|ебл|(?<![а-яё])еб[аоу]|муда|гандон|долбо|залуп|шлюх|пидор|пидар)/iu;

// Возвращает { text } или { reason } — причина отказа пишется в лог.
function filterReply(raw, { oneLine = true, max = 240 } = {}) {
  let s = String(raw || '').trim();
  s = oneLine ? (s.split('\n').map((l) => l.trim()).find(Boolean) || '') : s.replace(/\n+/g, ' ');
  s = s.replace(/^["«„']+|["»“']+$/g, '').replace(/^AI__\s*[:,-]\s*/i, '').trim();
  if (!s || /^SKIP/i.test(s)) return { reason: 'SKIP' };
  if (/https?:|www\.|\.(ru|com|net|org)(?![a-z])/i.test(s)) return { reason: `ссылка: ${s}` };
  if (LEAK_RE.test(s)) return { reason: `стоп-слово: ${s}` };
  if (PROFANITY_RE.test(s)) return { reason: `грубость: ${s}` };
  s = s.replace(CRUDE_SMILES, '').replace(/\s{2,}/g, ' ').trim();
  if (s.length > max) s = s.slice(0, max).replace(/\s+\S*$/, '') + '…';
  return s ? { text: s } : { reason: 'пусто' };
}

function cleanOutput(raw) {
  return filterReply(raw).text || null;
}

function askModel(userText) {
  return new Promise((resolve) => {
    let out = '';
    let done = false;
    const child = spawn(BASH, ['-c', CLAUDE_CMD], {
      cwd: WORK_DIR, windowsHide: true, env: { ...process.env, AI_PERSONA_FILE: PROMPT_FILE.split(path.sep).join('/') },
    });
    const timer = setTimeout(() => { if (!done) { done = true; child.kill(); resolve({ ok: false, err: 'timeout' }); } }, CALL_TIMEOUT_MS);
    child.stdout.on('data', (d) => { out += d.toString('utf8'); });
    child.on('error', (e) => { if (!done) { done = true; clearTimeout(timer); resolve({ ok: false, err: e.message }); } });
    child.on('close', (code) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(code === 0 ? { ok: true, text: out } : { ok: false, err: `exit ${code}` });
    });
    child.stdin.end(userText, 'utf8');
  });
}

function appendOutbox(room, text) {
  let items = [];
  try { items = JSON.parse(fs.readFileSync(OUTBOX_FILE, 'utf8')); } catch (e) { items = []; }
  if (!Array.isArray(items)) items = [];
  items.push({ room, text });
  fs.writeFileSync(OUTBOX_FILE, JSON.stringify(items));
}

function describeTrigger(t) {
  switch (t.type) {
    case 'mention': return `Игрок ${t.nick} обратился к тебе. Ответь ему.`;
    case 'reply': return `Игрок ${t.nick} ответил после твоей реплики. Поддержи разговор, если это тебе.`;
    case 'greeting': return `Игрок ${t.nick} поздоровался. Поприветствуй в своём духе.`;
    case 'revival': return 'Комната ожила после тишины. Можешь вставить уместную реплику или SKIP.';
    case 'initiative': return 'В комнате давно тихо. Заведи разговор: байка, вопрос к залу, шутка.';
    default: return 'Реши, стоит ли что-то сказать.';
  }
}

function checkQuota(room) {
  const key = new Date().toISOString().slice(0, 10);
  if (dayKey !== key) { dayKey = key; repliesToday = 0; }
  if (repliesToday >= MAX_REPLIES_PER_DAY) return false;
  if (Date.now() - (lastReplyAt[room] || 0) < MIN_GAP_PER_ROOM_MS) return false;
  return true;
}

// Обращение по нику ровно один раз, в начале: срезаем ник в начале и в конце реплики, если модель
// его всё-таки вставила, и ставим «Ник, ...». Ник в середине фразы оставляем как есть.
function addressOnce(reply, nick) {
  const low = nick.toLowerCase();
  let s = reply.trim();
  if (s.toLowerCase().startsWith(low)) s = s.slice(nick.length).replace(/^[\s,:!-]+/, '');
  const tail = s.match(/[.!?…]*$/)[0];
  const body = s.slice(0, s.length - tail.length).trimEnd();
  if (body.toLowerCase().endsWith(low)) s = body.slice(0, body.length - nick.length).replace(/[\s,]+$/, '') + tail;
  if (s.toLowerCase().includes(low)) return s;
  return `${nick}, ${s.charAt(0).toLowerCase()}${s.slice(1)}`;
}

// Поставить ответ на триггер чата в очередь (по одному вызову модели за раз).
function handleChatTrigger(trigger, roomText) {
  if (!trigger || !REPLY_TYPES.has(trigger.type)) return;
  queue = queue.then(async () => {
    const room = Number(trigger.room || 12);
    if (!checkQuota(room)) return;
    const task = describeTrigger(trigger);
    const nickRaw = cleanInput(trigger.nick, 30).trim();
    // Сами сообщения чата (и реплики AI__, когда они появятся в комнате) пишет в память
    // memory.ingestRoom из цикла чата в driver.js - здесь не дублируем.
    const mem = memory.recall({ nick: nickRaw, room, query: `${trigger.text || ''} ${cleanInput(roomText, 400)}`, kind: 'chat', loreQuery: cleanInput(trigger.text, 300) });
    const said = cleanInput(trigger.text, 300);
    const user = `${task}\nКомната: ${cleanInput(trigger.roomName, 40)}. Новые сообщения сверху.\n`
      + `${styleHints(room)}\n`
      + (said ? `Сначала ответь ровно на это: «${said}». Потом, если есть что, добавь своё.\n` : '')
      + todayBlock()
      + affairsBlock()
      + adviceBlock(room)
      + (mem ? `<memory>\n${mem}\n</memory>\n` : '')
      + `<chat>\n${cleanInput(roomText, 1500)}\n</chat>`;
    const res = await askModel(user);
    if (!res.ok) { console.log(`Автоответ: ошибка вызова модели (${res.err})`); return; }
    const noteText = takeNote(res, nickRaw);
    const f = filterReply(res.text);
    if (!f.text) { console.log(`Автоответ: промолчал [${trigger.type}] (${f.reason})`); return; }
    let reply = f.text;
    const nick = cleanInput(trigger.nick, 30).trim();
    if ((trigger.type === 'mention' || trigger.type === 'reply') && nick) {
      // Модель просят ник не писать; если всё же вставила в начало или конец - убираем, чтобы не
      // вышло «Tsunami, рыба горячее, Tsunami!», и ставим обращение один раз в начало.
      reply = addressOnce(reply, nick);
    }
    appendOutbox(room, reply);
    lastReplyAt[room] = Date.now();
    repliesToday += 1;
    console.log(`Автоответ [${trigger.type}] -> outbox room=${room}: ${reply}${noteText ? ` | заметка о ${nickRaw}: ${noteText}` : ''}`);
  }).catch((e) => console.log(`Автоответ: ошибка ${e.message}`));
}

// Ответ на письмо: возвращает текст или null. owner=true - письмо от Tsunami (Паша): это
// распоряжение командира, отвечаем по делу и без байки (20.09.2026: «если получаешь письмо от меня -
// реагируй, а не просто пересылай его мне же в телеграм»).
async function composeLetterReply(sender, body, { owner = false } = {}) {
  const who = cleanInput(sender, 30).trim();
  memory.remember({ kind: 'letter', nick: who, text: body });
  const mem = memory.recall({ nick: who, query: cleanInput(body, 400), kind: 'letter' });
  const task = owner
    ? `Тебе пришло письмо от ${who} - это твой командир и старший в клане. Ответь коротко и по делу (1-3 предложения): что понял из письма, что сделаешь, и спроси, если что-то неясно. Без байки и без шуток-заглушек, лишнего не обещай.`
    : `Тебе пришло личное письмо от игрока ${who}. Ответь письмом в 1-3 предложения (до 400 символов).`;
  const user = `${task}\n`
    + todayBlock()
    + affairsBlock()
    + (mem ? `<memory>\n${mem}\n</memory>\n` : '')
    + `<chat>\n${cleanInput(body, 1500)}\n</chat>`;
  const res = await askModel(user);
  if (!res.ok) { console.log(`Автоответ: ошибка вызова модели для письма (${res.err})`); return null; }
  const noteText = takeNote(res, who);
  const f = filterReply(res.text, { oneLine: false, max: 450 });
  if (!f.text) { console.log(`Автоответ: письмо от ${who} без ответа (${f.reason})`); return null; }
  memory.remember({ kind: 'letter', nick: 'AI__', text: f.text, self: true });
  if (noteText) console.log(`Автоответ: заметка о ${who}: ${noteText}`);
  return f.text;
}

// Строку «ЗАМЕТКА: ...» модель пишет, когда узнала о собеседнике что-то стоящее. Вынимаем её из
// ответа (в чат она не уходит) и кладём в долгую память о человеке.
function takeNote(res, nick) {
  const lines = String(res.text || '').split('\n');
  let note = '';
  res.text = lines.filter((l) => {
    const m = l.match(/^\s*ЗАМЕТКА\s*:\s*(.*)$/i);
    if (m) { note = m[1].trim(); return false; }
    return true;
  }).join('\n');
  if (note && nick && !/^(нет|-|—)$/i.test(note)) memory.addNote(nick, note);
  return note;
}

module.exports = { handleChatTrigger, composeLetterReply, cleanOutput, filterReply, addressOnce, styleHints, todayBlock, adviceBlock };
