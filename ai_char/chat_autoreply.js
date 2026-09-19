// Автоответчик чата и писем AI__ (Паша, 19.09.2026: уменьшить расход токенов). Раньше каждый
// CHAT_TRIGGER будил большую сессию Claude ради одной реплики. Теперь драйвер сам вызывает
// `claude -p` на Haiku: пустая рабочая папка, без инструментов, без MCP и настроек, без сохранения
// сессии. Персона — chat_persona_prompt.txt (выжимка из памяти aichar_persona).
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

const PROMPT_FILE = path.join(__dirname, 'chat_persona_prompt.txt');
const OUTBOX_FILE = path.join(__dirname, 'chat_outbox.json');
const WORK_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'aichar-reply-'));
const MODEL = process.env.AI_CHAT_MODEL || 'haiku';
const BASH = process.env.AI_BASH || 'bash';
const CLAUDE_CMD = `claude -p --model ${MODEL} --tools "" --strict-mcp-config --setting-sources "" --no-session-persistence --system-prompt-file "$AI_PERSONA_FILE"`;
const CALL_TIMEOUT_MS = 90 * 1000;
const MIN_GAP_PER_ROOM_MS = 45 * 1000;
const MAX_REPLIES_PER_DAY = 60;
const REPLY_TYPES = new Set(['mention', 'reply', 'greeting', 'initiative', 'revival']);
const CRUDE_SMILES = /\.(fuck|nah|siski|negr|trah)\./gi;
// Без \w и \b: в JS они только ASCII и на кириллице молча не срабатывают — границы слова явные.
const LEAK_RE = /((?<![а-яё])ии(?![а-яё])|искусственн[а-яё]* интеллект|языков[а-яё]* модел|нейросет|(?<![а-яё])бот(?![а-яё])|(?<![a-z_])AI(?![a-z_])|Claude|Anthropic|промпт|инструкци)/iu;

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

// Поставить ответ на триггер чата в очередь (по одному вызову модели за раз).
function handleChatTrigger(trigger, roomText) {
  if (!trigger || !REPLY_TYPES.has(trigger.type)) return;
  queue = queue.then(async () => {
    const room = Number(trigger.room || 12);
    if (!checkQuota(room)) return;
    const task = describeTrigger(trigger);
    const user = `${task}\nКомната: ${cleanInput(trigger.roomName, 40)}. Новые сообщения сверху.\n<chat>\n${cleanInput(roomText, 1500)}\n</chat>`;
    const res = await askModel(user);
    if (!res.ok) { console.log(`Автоответ: ошибка вызова модели (${res.err})`); return; }
    const f = filterReply(res.text);
    if (!f.text) { console.log(`Автоответ: промолчал [${trigger.type}] (${f.reason})`); return; }
    let reply = f.text;
    const nick = cleanInput(trigger.nick, 30).trim();
    if ((trigger.type === 'mention' || trigger.type === 'reply') && nick && !reply.toLowerCase().startsWith(nick.toLowerCase())) {
      reply = `${nick}, ${reply.charAt(0).toLowerCase()}${reply.slice(1)}`;
    }
    appendOutbox(room, reply);
    lastReplyAt[room] = Date.now();
    repliesToday += 1;
    console.log(`Автоответ [${trigger.type}] -> outbox room=${room}: ${reply}`);
  }).catch((e) => console.log(`Автоответ: ошибка ${e.message}`));
}

// Ответ на письмо: возвращает текст или null. Письма Tsunami (Паша) сюда не передаются.
async function composeLetterReply(sender, body) {
  const user = `Тебе пришло личное письмо от игрока ${cleanInput(sender, 30)}. Ответь письмом в 1-3 предложения (до 400 символов).\n<chat>\n${cleanInput(body, 1500)}\n</chat>`;
  const res = await askModel(user);
  if (!res.ok) { console.log(`Автоответ: ошибка вызова модели для письма (${res.err})`); return null; }
  const f = filterReply(res.text, { oneLine: false, max: 450 });
  if (!f.text) { console.log(`Автоответ: письмо от ${cleanInput(sender, 30)} без ответа (${f.reason})`); return null; }
  return f.text;
}

module.exports = { handleChatTrigger, composeLetterReply, cleanOutput, filterReply };
