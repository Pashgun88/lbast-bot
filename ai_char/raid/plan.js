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

// Урон одного бойца по духу (середина вилки из памятки) с учётом допинга.
function baseDamage(level) {
  if (level >= 17) return 480;
  if (level >= 11) return 440;
  return 0; // ниже 11 в экспедицию не берут: меньше трёх очков инвентаря
}

// Набор свитков на бойца: три штуки, с упором по уровню.
function scrollsFor(level) {
  if (level >= 15) return { сила: 2, медлительность: 1, слабость: 0 };
  return { слабость: 2, медлительность: 1, сила: 0 };
}

function plan(roster, dopingName = 'эль') {
  const doping = DOPING[dopingName] ?? DOPING['эль'];
  const fighters = roster.filter((f) => f.level >= 11);
  const tooLow = roster.filter((f) => f.level < 11);
  const bossHp = 800 * roster.length;
  const perRound = fighters.reduce((sum, f) => sum + Math.round(baseDamage(f.level) * (1 + doping)), 0);
  const rounds = perRound > 0 ? Math.ceil(bossHp / perRound) : Infinity;

  const lines = [];
  lines.push(`Забытые горы: участников ${roster.length}, из них бьют ${fighters.length}.`);
  lines.push(`HP духа: ${bossHp} (800 x ${roster.length}).`);
  lines.push(`Урон группы за раунд с допингом «${dopingName}» (+${Math.round(doping * 100)}%): ~${perRound}.`);
  lines.push(`Раундов при полном попадании: ~${rounds}${rounds > 3 ? ' - это больше трёх, нужен ещё народ или коньяк' : ''}.`);
  if (tooLow.length) {
    lines.push(`Ниже 11 уровня (в бой не берём, три свитка не унесут): ${tooLow.map((f) => `${f.nick || '?'} [${f.level}]`).join(', ')}.`);
  }
  lines.push('');
  lines.push('Что покупать в хижине старца (по 50 дин, всего 3 на бойца):');
  const totals = { сила: 0, слабость: 0, медлительность: 0 };
  for (const f of fighters) {
    const s = scrollsFor(f.level);
    for (const k of Object.keys(totals)) totals[k] += s[k];
    const set = Object.entries(s).filter(([, n]) => n > 0).map(([k, n]) => `${k} x${n}`).join(', ');
    lines.push(`  ${(f.nick || '?').padEnd(12)} [${String(f.level).padStart(2)}] - ${set}`);
  }
  lines.push(`Итого свитков: сила ${totals.сила}, слабость ${totals.слабость}, медлительность ${totals.медлительность}` +
    ` (${(totals.сила + totals.слабость + totals.медлительность) * 50} дин на группу).`);
  lines.push('');
  lines.push('Что делать по раундам (говорит ведущий, дух может передумать):');
  lines.push('  «будет атаковать»            -> хаи кидают СИЛУ и бьют; мидлы просто бьют.');
  lines.push('  «покинет телесную оболочку»  -> мидлы кидают СЛАБОСТЬ и бьют (урон 0, но дух слабеет).');
  lines.push('  «замедлит реальность»        -> все кидают МЕДЛИТЕЛЬНОСТЬ и бьют, иначе промах.');
  lines.push('');
  lines.push('Перед входом: допинг у всех (брага/эль/коньяк, прочее не работает), свитков не больше трёх.');
  return lines.join('\n');
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

module.exports = { plan, parseRoster, scrollsFor, baseDamage };
