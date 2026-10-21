const a = require('./lib/auction_watch');
const sample = [
  'Семян оливкового дерева: 2',
  'Винокур - BlackOpium еще 3 дн.',
  'Травник - BUDDAHAM еще 3 дн.',
  'Аптекарь - Zajka111 еще 2 дн. 7 ч. 30 мин.',
  'Мэр города - Runaway еще 2 дн. 13 ч. 11 мин.',
  'Мясник - lomavoy еще 5 дн.',
  'Кузнец - Pubby еще 3 дн.',
  'Перчаточник - YEAHXXX еще 4 дн.',
].join('\n');
const now = Date.parse('2026-10-21T11:00:00');
const r = a.parseAuctionBoard(sample, now);
console.log('семян:', r.seeds, '| строк:', r.rows.length, '| не разобрано:', JSON.stringify(r.unknown));
r.rows.forEach((x) => console.log('  ', x.prof, '|', x.holder, '|', new Date(x.endsAt).toLocaleString('ru-RU'), x.coarse ? '(грубо)' : ''));
const end = Date.parse('2026-10-21T18:20:00');
const t = (s) => Date.parse('2026-10-21T' + s);
console.log('08:30 ->', JSON.stringify(a.dueReminder(end, [], t('08:30:00'))));
console.log('15:30 ->', JSON.stringify(a.dueReminder(end, ['утро'], t('15:30:00'))));
console.log('18:12 ->', JSON.stringify(a.dueReminder(end, ['утро', '3ч'], t('18:12:00'))));
console.log('18:40 ->', JSON.stringify(a.dueReminder(end, ['утро', '3ч', '10м'], t('18:40:00'))));
console.log('ночной в 02:00, смотрим в 08:30 ->', JSON.stringify(a.dueReminder(t('02:00:00'), [], t('08:30:00'))));
console.log('повтор утром дважды ->', JSON.stringify(a.dueReminder(end, ['утро'], t('09:30:00'))));
