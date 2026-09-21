// Боевой цикл для РУЧНЫХ прогонов гайдов (node guides/guide_run.js ...), когда основной бот не
// запущен и его fightLoop недоступен. В автоматическом режиме daily_quests_piraty.js передаёт в
// runGuide свой собственный fightLoop -- он умнее (эликсиры, кулдауны целей), этот нужен только
// чтобы разовый прогон вообще мог драться.
const { sleep, getBodyText, links, goto } = require('./lib');

const START_FIGHT = /^(В бой!?|Принять бой!?|Вступить в бой|Напасть)/i;
const DONE = /^(Бой завершен!?|Вернуться)$/i;
const RESET_PAIRS = /^Сбросить пары$/i;
const RECEPTION = /^Прием|^Приём/i;
const MAX_STUCK = 10;

async function fightLoop(page) {
  let stuck = 0;

  for (let i = 0; i < 300; i++) {
    const text = await getBodyText(page);
    const l = await links(page);

    const done = l.find((x) => DONE.test(x.t));
    if (done) {
      await goto(page, done.h);
      return true;
    }

    // Личный кулдаун цели: "Вы слишком устали, приходите через N мин."
    const tired = text.match(/Вы\s+слишком\s+устали.{0,40}?через\s+(\d+)\s*мин/i);
    if (tired) throw new Error(`fight_target_cooldown:${Number(tired[1]) || 1}`);

    if (!/Ударить/i.test(text)) {
      const start = l.find((x) => START_FIGHT.test(x.t));
      if (start) { stuck = 0; await goto(page, start.h); continue; }

      const reset = l.find((x) => RESET_PAIRS.test(x.t));
      if (reset) { stuck = 0; await goto(page, reset.h); continue; }

      stuck += 1;
      if (stuck >= MAX_STUCK) throw new Error('fight_not_reached');
      await sleep(1200);
      continue;
    }

    // "Прием" -- необязательное действие перед ударом. HP на боевом экране читается простым
    // "(hp/max)": третьей группы с резервом, которую ждёт parseStats, здесь нет (см. память
    // fight-reception-hp-parsing).
    const hp = text.match(/\((-?\d+)\s*\/\s*(\d+)\)/);
    if (hp && Number(hp[2]) > 0 && Number(hp[1]) < Number(hp[2]) * 0.75) {
      const reception = l.find((x) => RECEPTION.test(x.t));
      if (reception) { await goto(page, reception.h); continue; }
    }

    const hit = l.find((x) => /^Ударить/i.test(x.t));
    if (!hit) {
      stuck += 1;
      if (stuck >= MAX_STUCK) throw new Error('fight_stuck');
      await sleep(1200);
      continue;
    }

    stuck = 0;
    await goto(page, hit.h);
  }

  throw new Error('fight_timeout');
}

module.exports = { fightLoop };
