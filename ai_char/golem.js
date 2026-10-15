// Поставить просьбу «голем» в очередь, не останавливая драйвер.
// Очередь - файл golem_queue.json, драйвер читает её в начале каждого цикла.
//
//   node ai_char/golem.js Hank            - применить на Hank сразу
//   node ai_char/golem.js Hank 16:52:44   - применить на Hank ровно в 16:52:44
//   node ai_char/golem.js --list          - показать очередь
//
// 15.10.2026, Паша: «если не пишут во сколько сделать - делай сразу. Буду писать например - голем
// в 16:52:44, нужно точно в это время». Этим скриптом просьбу ставлю я, когда Паша пишет её сюда,
// а не в игру; просьбы из игрового чата попадают в ту же очередь сами (lib/chat.js).
const { enqueueGolemRequest, readGolemQueue, parseGolemRequest } = require('./lib/golem');

const args = process.argv.slice(2);
if (args[0] === '--list' || args.length === 0) {
  const q = readGolemQueue();
  if (q.length === 0) console.log('Очередь голема пуста.');
  for (const r of q) {
    console.log(`- на «${r.target}», время ${r.atMs ? new Date(r.atMs).toLocaleString('ru-RU') : 'сразу'} (от ${r.requester || 'Паши'}, ${r.source || 'напрямую'})`);
  }
  process.exit(0);
}

const target = args[0];
// Фраза-триггер подставляется сама: сюда Паша передаёт только ник и время.
const req = parseGolemRequest(`нужен голем ${args.slice(1).join(' ')}`, target) || { atMs: 0 };
enqueueGolemRequest({ target, atMs: req.atMs, requester: 'Паша', source: 'CLI' });
