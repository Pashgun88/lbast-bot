// Раскладка свитков на «Забытые горы» (дух подземелья). Чистый расчёт, игру не трогает.
//
// Правила взяты из памятки Linda (24.09.2026) и FAQ Raul:
//  - у каждого бойца не больше ТРЁХ свитков, по 50 дин; действуют один раунд;
//  - сила - усиливает удар, слабость - ослабляет духа, медлительность - сбивает ему уворот;
//  - «будет атаковать» -> сила, «покинет телесную оболочку» -> слабость,
//    «замедлит реальность» -> медлительность; дух может менять намерение;
//  - мидлы (11-14) наиболее полезны слабостью под выход из оболочки: бьют в ноль, зато ослабляют;
//  - хаи (15+) бьют под силу;
//  - без медлительности шанс попасть крайне мал, поэтому она нужна каждому на «медленный» раунд;
//  - HP духа = 800 x число участников; урон 430-450 (11-14 ур.) и 470-490 (17-18 ур.);
//  - допинг обязателен: брага +10%, праздничный эль +15%, коньяк +25%. Прочее не работает.
//
// Запуск: node raid/plan.js "Ник:21, Ник2:14, Ник3:12" [--doping=эль]
// Можно без ников: node raid/plan.js "21,14,12,12,11,18,17"

const DOPING = { брага: 0.10, эль: 0.15, коньяк: 0.25 };

function parseRoster(arg) {
  return String(arg || '').split(/[,;]+/).map((chunk) => {
    const s = chunk.trim();
    if (!s) return null;
    const m = s.match(/^(.*?)[:\s]+(\d{1,2})$/);
    if (m) return { nick: m[1].trim(), level: Number(m[2]) };
    if (/^\d{1,2}$/.test(s)) return { nick: '', level: Number(s) };
    return null;
  }).filter(Boolean);
}

// ВАЖНО, разобрано по настоящему логу боя (25.09.2026, 10 участников, дух 8000 HP, убит за 21 раунд,
// бой занял 8,5 минут). Памятка Linda в двух местах вводила в заблуждение, и первый расчёт был неверным:
//  1. РАУНД - это удар ОДНОГО бойца, а не общий залп группы. Раундов было 21, а не «три».
//  2. Урон за удар выше обещанного: 11-12 ур. ~470-490, 15-16 ур. ~520-540, 20-22 ур. ~570-600.
//  3. Свиток силы даёт ровно +75% («Свиток силы, урон X увеличен на 75%»).
//  4. Свиток слабости режет урон ДУХА на 50% («урон Дух подземелья снижен на 50%») - это защита
//     группы, а не усиление своего удара.
//  5. Пока дух вне телесной оболочки, урон по нему 0 - поэтому мидлы под «покинет оболочку» бьют
//     ради слабости, а не ради урона.
//  6. Урон духа зависит от максимума HP цели: он снимал 45-95% максимума за удар, то есть с любого
//     уровня хватает двух-трёх попаданий. В том бою полегли 6 из 10, и это нормально.
function baseDamage(level) {
  if (level >= 20) return 585;
  if (level >= 17) return 560;
  if (level >= 15) return 530;
  if (level >= 11) return 480;
  return 0; // ниже 11 в экспедицию не берут: меньше трёх очков инвентаря
}

const FORCE_MULTIPLIER = 1.75;
// Числа выше сняты с живого боя, где почти все пили эль, то есть допинг в них УЖЕ учтён. Поэтому
// другой допинг считаем относительно эля, а не сверху (первый расчёт умножал второй раз и обещал
// 13 раундов вместо настоящих 21).
const REFERENCE_DOPING = DOPING['эль'];
function hitDamage(level, doping) {
  return baseDamage(level) * (1 + doping) / (1 + REFERENCE_DOPING);
}
// Средний урон за РАУНД по живому бою: 8340 урона за 21 раунд = ~397, при среднем ударе группы ~536.
// То есть в зачёт идёт примерно три четверти: часть ударов приходится на духа вне оболочки (ноль),
// часть усилена свитком силы. Этим коэффициентом и оцениваем число раундов.
const ROUND_YIELD = 0.75;

// Набор свитков на бойца: три штуки. Раскладка подтверждена логом: хаи били под силу (урон ~1030 за
// удар вместо ~590), мидлы кидали слабость под выход из оболочки и медлительность под замедление.
function scrollsFor(level) {
  if (level >= 17) return { сила: 2, медлительность: 1, слабость: 0 };
  return { слабость: 2, медлительность: 1, сила: 0 };
}

// Ожидаемый урон бойца за весь бой: удары под силу идут с множителем, удар под медлительность -
// обычный, удары под слабость чаще всего в ноль (дух вне оболочки), поэтому в расчёт их не берём.
function expectedDamage(level, doping) {
  const base = hitDamage(level, doping);
  const s = scrollsFor(level);
  return Math.round(base * (s.сила * FORCE_MULTIPLIER + s.медлительность));
}

function plan(roster, dopingName = 'эль') {
  const doping = DOPING[dopingName] ?? DOPING['эль'];
  const fighters = roster.filter((f) => f.level >= 11);
  const tooLow = roster.filter((f) => f.level < 11);
  const bossHp = 800 * roster.length;
  const groupDamage = fighters.reduce((sum, f) => sum + expectedDamage(f.level, doping), 0);
  // Раунд = один удар. Средний удар по группе нужен, чтобы оценить, сколько их потребуется.
  const avgHit = fighters.length
    ? Math.round(fighters.reduce((s2, f) => s2 + hitDamage(f.level, doping), 0) / fighters.length)
    : 0;
  const perRound = Math.round(avgHit * ROUND_YIELD);
  const hitsNeeded = perRound ? Math.ceil(bossHp / perRound) : Infinity;
  const hitsAvailable = fighters.length * 3;

  const lines = [];
  lines.push(`Забытые горы: участников ${roster.length}, из них бьют ${fighters.length}.`);
  lines.push(`HP духа: ${bossHp} (800 x ${roster.length}).`);
  lines.push(`Ожидаемый урон группы за бой с допингом «${dopingName}» (+${Math.round(doping * 100)}%): ~${groupDamage}` +
    ` - это ${groupDamage >= bossHp ? 'хватает' : 'МАЛО, духа не свалим'}.`);
  lines.push(`Средний удар ~${avgHit}, в зачёт раунда идёт ~${perRound} (часть ударов в ноль: дух вне оболочки).`);
  lines.push(`Раундов понадобится ~${hitsNeeded}, в запасе ${hitsAvailable} ударов со свитками (по 3 на бойца).`);
  lines.push(`По времени: в живом бою 21 раунд занял 8,5 минут - считай ~25 секунд на раунд, тут выйдет ~${Math.round(hitsNeeded * 25 / 60)} мин.`);
  if (hitsNeeded > hitsAvailable) {
    lines.push('ВНИМАНИЕ: ударов со свитками меньше, чем нужно - берите коньяк вместо эля или зовите ещё людей.');
  }
  if (tooLow.length) {
    lines.push(`Ниже 11 уровня (в бой не берём, три свитка не унесут): ${tooLow.map((f) => `${f.nick || '?'} [${f.level}]`).join(', ')}.`);
  }
  lines.push('');
  lines.push('Что покупать в хижине старца (по 50 дин, всего 3 на бойца):');
  const totals = { сила: 0, слабость: 0, медлительность: 0 };
  for (const f of fighters) {
    const sc = scrollsFor(f.level);
    for (const k of Object.keys(totals)) totals[k] += sc[k];
    const set = Object.entries(sc).filter(([, n]) => n > 0).map(([k, n]) => `${k} x${n}`).join(', ');
    lines.push(`  ${(f.nick || '?').padEnd(12)} [${String(f.level).padStart(2)}] - ${set} (его урон за удар ~${Math.round(hitDamage(f.level, doping))}${f.level >= 17 ? `, под силой ~${Math.round(hitDamage(f.level, doping) * FORCE_MULTIPLIER)}` : ''})`);
  }
  lines.push(`Итого свитков: сила ${totals.сила}, слабость ${totals.слабость}, медлительность ${totals.медлительность}` +
    ` (${(totals.сила + totals.слабость + totals.медлительность) * 50} дин на группу).`);
  lines.push('');
  lines.push('Что делать по раундам. Дух СНАЧАЛА объявляет намерение, а потом может его сменить');
  lines.push('(в логе строка «Дух подземелья меняет намерения» встретилась 4 раза из 21):');
  lines.push('  «будет атаковать»            -> СИЛА и удар. Хаи так и бьют: 1030 вместо 590.');
  lines.push('  «покинет телесную оболочку»  -> СЛАБОСТЬ и удар. Урон будет 0, зато дух бьёт вдвое слабее.');
  lines.push('  «замедлит реальность»        -> МЕДЛИТЕЛЬНОСТЬ и удар, иначе дух уворачивается.');
  lines.push('');
  lines.push('Перед входом: допинг у всех (брага/эль/коньяк, прочее не работает), свитков не больше трёх.');
  lines.push('В бою: сначала «бросить пары», затем применить свиток, затем удар - и сразу обновиться.');
  return lines.join(String.fromCharCode(10));
}

if (require.main === module) {
  const arg = process.argv.slice(2).filter((a) => !a.startsWith('--')).join(' ');
  const dop = (process.argv.find((a) => a.startsWith('--doping=')) || '').split('=')[1];
  const roster = parseRoster(arg);
  if (!roster.length) {
    console.log('Нужен состав: node raid/plan.js "Hank:22, Varus:20, Galla:18, ..." [--doping=коньяк]');
    process.exit(0);
  }
  console.log(plan(roster, dop));
}

module.exports = { plan, parseRoster, scrollsFor, baseDamage, expectedDamage, FORCE_MULTIPLIER };
