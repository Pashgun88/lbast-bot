// Раннер маршрутов квестов по файлам шагов (*.steps). Портирован из ai_char/guides/guide_run.js
// (там он обкатан вживую на персонаже AI__), но без зависимости от ai_char/module.js: всё, что
// нужно из основного бота (бой, меню квестов), передаётся через opts -- daily_quests_piraty.js
// не экспортирует свои функции и требовать его нельзя (при require он сразу поднимает браузер).
//
// CLI:      node guides/guide_run.js guides/имя.steps [сНомераШага]
// Библиотека: const { runGuide } = require('./guides/guide_run');
//             await runGuide(page, file, from, { fightLoop, resetToQuestMenu, clickInfoForQuest })
//             -> { status: 'done'|'stop'|'mismatch'|'lost'|'nofight'|'error', index }
//
// Синтаксис шагов:
//   # ...        комментарий
//   текст        нажать ссылку, чей текст начинается с этого (регистр/ё/кавычки/маркеры не важны)
//   ?текст       то же, но необязательно (нет ссылки -- шаг пропускается)
//   *текст       жать, пока ссылка есть на экране (длинные цепочки "Далее")
//   @city N      амулетом в город: 1 Последний портал, 2 Стоунгард, 3 Эвилгард, 4 Кулак Хаоса,
//                8 Девтаун, 9 Дорожный крест
//   @heal 0.8    лечиться НА МЕСТЕ до доли от максимума HP (при висящем бое пропускается -- HP
//                тогда не растёт). Значение БОЛЬШЕ 1 -- абсолютный порог в HP: @heal 1300.
//   @fight       бой: порог HP, "В бой!"/"Принять бой"/"Напасть", затем fightLoop основного бота
//   ?@fight      бой, только если он уже на экране (засады)
//   @qinfo Имя   открыть [инфо] квеста в меню Q и уехать "К месту выполнения"
//   @autolone    дальше самому жать единственную ссылку сцены (кроме боя/отказа)
//   @stop текст  остановиться намеренно
//
// Прогресс пишется в <файл>.progress после каждого шага, повторный запуск продолжает с него.
const fs = require('fs');
const path = require('path');
const { sleep, norm, getBodyText, links, sceneLinks, goto } = require('./lib');

const DEFAULT_HP_GATE = Number(process.env.HP_GATE || 0.7);

async function dump(page, tag) {
  const t = await getBodyText(page);
  const l = await links(page);
  console.log(`\n== ${tag} [${new Date().toLocaleTimeString('ru-RU')}] ==\n`
    + t.replace(/\n\s*\n+/g, '\n').slice(0, 1200)
    + '\nLINKS: ' + l.map((x) => x.t).join(' | '));
  return { t, l };
}

async function travelWait(page) {
  for (let i = 0; i < 30; i++) {
    const t = await getBodyText(page);
    if (!/В пути|Вы используете амулет|осталось\s+\d+/i.test(t)) return;
    await sleep(6000);
    await goto(page, 'location.php');
  }
}

async function readHp(page) {
  await goto(page, 'pers.php');
  const text = await getBodyText(page);
  const hp = text.match(/\((-?\d+)\s*\/\s*(\d+)\)/);
  const rate = text.match(/Лечение:\s*(\d+)\s*hp\/мин/i);
  return hp ? { hp: Number(hp[1]), max: Number(hp[2]), rate: rate ? Number(rate[1]) : null } : null;
}

// gate: доля от максимума HP (0..1) либо абсолютный порог, если больше 1. Абсолютный нужен там,
// где порог задан правилом в HP, а не процентом (Паша, 25.09.2026 про Кораблекрушение:
// "10 резервов и 1300 хп") -- доля привязалась бы к текущему максимуму и поехала бы при его росте.
async function healInPlace(page, gate) {
  for (let i = 0; i < 20; i++) {
    const s = await readHp(page);
    if (!s) { await sleep(60000); continue; }
    const target = gate > 1 ? Math.ceil(gate) : Math.ceil(s.max * gate);
    if (s.hp >= target) { console.log(`guide HP ${s.hp}/${s.max} >= ${target}`); return s; }
    const rate = s.rate > 0 ? s.rate : 14;
    const ms = Math.ceil(((target - s.hp) / rate) * 60000) + 10000;
    console.log(`guide HP ${s.hp}/${s.max}, нужно ${target}, ${rate}/мин -> жду ${Math.round(ms / 1000)} сек`);
    await sleep(ms);
  }
  return null;
}

// Вернуться туда, где идёт сцена квеста: location.php, а если игра предлагает -- "Продолжить квест".
async function backToScene(page) {
  await goto(page, 'location.php');
  const l = await links(page);
  const cont = l.find((x) => /^Продолжить квест$/i.test(x.t));
  if (cont) await goto(page, cont.h);
}

// Точное совпадение выигрывает всегда. Нечёткое засчитывается, только если подошла РОВНО одна
// ссылка: на живом прогоне (ai_char, 18.09.2026) префикс совпал не с той из шести похожих строк,
// напарник погиб и квест сорвался. Неоднозначность = остановка, никогда не угадываем.
function findLink(l, want) {
  const w = norm(want);
  const n = (x) => norm(x.t);
  const exact = l.find((x) => n(x) === w);
  if (exact) return exact;

  const tiers = [
    (x) => n(x).startsWith(w),
    (x) => w.length >= 8 && n(x).includes(w),
    (x) => w.length >= 12 && n(x).startsWith(w.slice(0, Math.max(12, Math.floor(w.length * 0.6)))),
  ];
  for (const f of tiers) {
    const hits = l.filter(f);
    if (hits.length === 1) return hits[0];
    if (hits.length > 1) {
      console.log('guide: НЕОДНОЗНАЧНЫЙ шаг, кандидаты:', hits.map((x) => x.t).join(' || '));
      return null;
    }
  }
  return null;
}

// Резерв ("(N)" рядом с HP) -- это минуты активности; ходьба и бои его тратят. Когда он кончился,
// игра НЕ выполняет действие, а показывает "Вам нужно отдохнуть еще N мин. Вернуться". Раньше это
// ловилось только перед следующим шагом: отклонённый шаг успевал записаться как выполненный, а
// после отдыха раннер продолжал со следующего -- персонаж оставался на старом месте и маршрут
// разъезжался (21.09.2026, «Смерть ростовщика», часть 3). Теперь проверяем сразу после действия и
// повторяем тот же шаг.
// Возвращает true, если пришлось отдыхать (значит, шаг НЕ выполнен и его надо повторить).
async function restIfBlocked(page) {
  const rest = (await getBodyText(page)).match(/отдохнуть\s+еще\s+(\d+)\s*мин/i);
  if (!rest) return false;
  const minutes = Number(rest[1]) || 1;
  console.log(`guide: резерв кончился, игра отклонила действие -- жду ${minutes} мин и повторяю шаг`);
  await sleep((minutes * 60 + 20) * 1000);
  await backToScene(page);
  return true;
}

async function runGuide(page, FILE, fromArg, opts = {}) {
  // throwIfPaused -- необязательный хук от вызывающего сценария: он знает про кнопку "Пауза" в
  // Telegram, а раннер про неё нет. Проверяем между шагами, чтобы длинная цепочка не доигрывалась
  // ещё десяток экранов после того, как пользователь забрал браузер себе. Прогресс (.progress)
  // к этому моменту уже записан, так что после "Продолжить" маршрут пойдёт с того же места.
  const { fightLoop, resetToQuestMenu, clickInfoForQuest, throwIfPaused } = opts;
  const HP_GATE = Number(opts.hpGate || DEFAULT_HP_GATE);
  const PROG = FILE + '.progress';
  const steps = fs.readFileSync(FILE, 'utf8')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
  const from = fromArg !== undefined && fromArg !== null
    ? Number(fromArg)
    : (fs.existsSync(PROG) ? Number(fs.readFileSync(PROG, 'utf8')) : 0);
  const name = FILE.split(/[\\/]/).pop();

  let fights = 0;
  let autoLone = false;
  let result = { status: 'error', index: from };

  try {
    await backToScene(page);

    let restRetries = 0;

    for (let i = from; i < steps.length; i++) {
      if (throwIfPaused) throwIfPaused(`${name} [${i}/${steps.length}]`);

      let step = steps[i];
      console.log(`\n--- ${name} [${i}/${steps.length}] ${step}`);

      // Могли попасть на экран отдыха ещё до шага (прошлый заход, чужое действие в игре).
      for (let r = 0; r < 5 && await restIfBlocked(page); r++) { /* ждём и пробуем снова */ }

      // Шаги-клики можно безопасно повторить, если игра отклонит их из-за резерва. Для @fight это
      // неверно: бой к тому моменту уже прошёл, повтор ждал бы несуществующую кнопку боя.
      let canRetryAfterBlock = false;

      if (step === '?@fight') {
        const t0 = await getBodyText(page);
        const l0 = await links(page);
        if (/Ударить/.test(t0) || l0.some((x) => /^В бой!?$/i.test(x.t))) {
          step = '@fight';
        } else {
          console.log('guide: дополнительного боя нет');
          fs.writeFileSync(PROG, String(i + 1));
          continue;
        }
      }

      if (step === '@autolone') {
        autoLone = true;
      } else if (step.startsWith('@qinfo')) {
        const qn = step.slice(6).trim();
        if (!resetToQuestMenu || !clickInfoForQuest) {
          console.log('guide: @qinfo недоступен (не переданы resetToQuestMenu/clickInfoForQuest)');
          fs.writeFileSync(PROG, String(i));
          result = { status: 'mismatch', index: i };
          break;
        }
        await resetToQuestMenu(page);
        const infoOk = await clickInfoForQuest(page, qn);
        const l0 = await links(page);
        const go = l0.find((x) => /^К месту выполнения$/i.test(x.t));
        if (!infoOk || !go) {
          await dump(page, 'QINFO FAILED');
          fs.writeFileSync(PROG, String(i));
          result = { status: 'mismatch', index: i };
          break;
        }
        await goto(page, go.h);
        await sleep(6500);
        await goto(page, 'location.php');
        await travelWait(page);
      } else if (step.startsWith('@city')) {
        canRetryAfterBlock = true;
        const n = step.split(/\s+/)[1];
        await goto(page, `location.php?mod=fastway&lway=${n}`);
        await sleep(6000);
        await goto(page, 'location.php');
        await travelWait(page);
      } else if (step.startsWith('@heal')) {
        const gate = Number(step.split(/\s+/)[1] || HP_GATE);
        await backToScene(page);
        const lh = await links(page);
        if (lh.some((x) => /^(В бой!?|Принять бой!?)$/i.test(x.t)) || /Ударить/.test(await getBodyText(page))) {
          console.log('guide: @heal пропущен -- бой уже висит, HP не восстанавливается');
        } else {
          await healInPlace(page, gate);
          await backToScene(page);
        }
      } else if (step.startsWith('@stop')) {
        await dump(page, 'STOP');
        console.log(`guide ${name}: остановка по плану на шаге ${i}: ${step.slice(5).trim()}`);
        fs.writeFileSync(PROG, String(i + 1));
        result = { status: 'stop', index: i + 1 };
        break;
      } else if (step === '@fight') {
        if (typeof fightLoop !== 'function') {
          console.log('guide: @fight недоступен (не передан fightLoop)');
          fs.writeFileSync(PROG, String(i));
          result = { status: 'mismatch', index: i };
          break;
        }
        let { t, l } = await dump(page, 'BEFORE FIGHT');
        // Уже предложенный бой висит: HP тогда не восстанавливается, ждать лечения бессмысленно.
        const pending = l.some((x) => /^В бой!?$/i.test(x.t));
        if (pending) console.log('guide: бой уже висит -> без ожидания HP');

        if (!/Ударить/.test(t)) {
          if (!pending) {
            const s = await readHp(page);
            if (!s || s.hp < s.max * HP_GATE) await healInPlace(page, HP_GATE);
            await backToScene(page);
          }
          ({ t, l } = await dump(page, 'FIGHT SCREEN'));

          // Перед боем бывают экраны-виньетки с одной "Далее" -- листаем их до кнопки боя.
          for (let k = 0; k < 6 && !/Ударить/.test(t); k++) {
            const scene = sceneLinks(l);
            if (scene.some((x) => /^(В бой!?|Принять бой!?|Напасть.*)$/i.test(x.t))) break;
            if (scene.length !== 1 || !/^Далее/i.test(scene[0].t)) break;
            console.log('guide: перед боем "Далее"');
            await goto(page, scene[0].h);
            ({ t, l } = await dump(page, 'FIGHT SCREEN'));
          }

          const b = l.find((x) => /^В бой!?$/i.test(x.t))
            || l.find((x) => /^Принять бой!?$/i.test(x.t))
            || l.find((x) => /^Напасть/i.test(x.t));
          if (!b && !/Ударить/.test(t)) {
            await dump(page, 'NO FIGHT LINK');
            console.log(`guide ${name}: шаг ${i} ждал бой, но кнопки боя нет.`);
            fs.writeFileSync(PROG, String(i));
            result = { status: 'nofight', index: i };
            break;
          }
          if (b) await goto(page, b.h);
          t = await getBodyText(page);
          if (!/Ударить/.test(t)) {
            const l2 = await links(page);
            const b2 = l2.find((x) => /^В бой!?$/i.test(x.t));
            if (b2) await goto(page, b2.h);
          }
        }

        const won = await fightLoop(page).catch((e) => { console.log('guide fightLoop error', e.message); return null; });
        fights++;
        const s = await readHp(page);
        console.log(`guide >>> бой ${fights} result=${won} HP ${s && s.hp}/${s && s.max}`);
        if (s && s.hp <= 0) {
          console.log(`guide ${name}: бой на шаге ${i} ПРОИГРАН (HP ${s.hp}/${s.max}).`);
          fs.writeFileSync(PROG, String(i));
          result = { status: 'lost', index: i };
          break;
        }
        await backToScene(page);
      } else if (step.startsWith('*')) {
        canRetryAfterBlock = true;
        const want = step.slice(1).trim();
        for (let k = 0; k < 10; k++) {
          const { l } = await dump(page, `REPEAT ${i}.${k}`);
          const hit = findLink(l, want);
          if (!hit) break;
          await goto(page, hit.h);
        }
      } else {
        canRetryAfterBlock = true;
        const optional = step.startsWith('?');
        const want = optional ? step.slice(1).trim() : step;
        let { l } = await dump(page, `STEP ${i}`);
        let hit = findLink(l, want);

        // Гайды пропускают повествовательные экраны: если шага нет, а "Далее" -- единственный
        // путь дальше, жмём его сами.
        for (let k = 0; !hit && k < 12; k++) {
          const real = sceneLinks(l);
          if (real.length !== 1) break;
          const lone = real[0].t;
          const isNext = /^Далее$/i.test(lone);
          const forbidden = /^(в\s*бой!?|принять\s+бой!?|напасть|атаковать|ударить|вступить\s+в\s+бой|уйти|отказаться)/i
            .test(lone.replace(/^[-\s]+/, ''));
          if (!isNext && !(autoLone && !forbidden)) break;
          console.log(isNext ? 'guide: авто "Далее"' : `guide: авто единственная ссылка: ${lone}`);
          await goto(page, real[0].h);
          ({ l } = await dump(page, `STEP ${i} after auto Далее`));
          hit = findLink(l, want);
        }

        if (!hit) {
          if (optional) {
            console.log('guide: необязательный шаг, пропускаю');
            fs.writeFileSync(PROG, String(i + 1));
            continue;
          }
          console.log(`guide ${name}: ШАГ ${i} «${want}» НЕ НАЙДЕН -> остановка. На экране: `
            + sceneLinks(l).map((x) => x.t).slice(0, 12).join(' / '));
          fs.writeFileSync(PROG, String(i));
          result = { status: 'mismatch', index: i };
          break;
        }

        await goto(page, hit.h);
        if (/fastway|konj/.test(hit.h)) await travelWait(page);
      }

      // Игра могла отклонить действие из-за резерва -- тогда шаг НЕ выполнен, и записывать его в
      // прогресс нельзя: после отдыха повторяем тот же шаг.
      if (await restIfBlocked(page) && canRetryAfterBlock) {
        restRetries += 1;
        if (restRetries > 6) {
          console.log(`guide ${name}: шаг ${i} снова и снова упирается в резерв -> остановка.`);
          fs.writeFileSync(PROG, String(i));
          result = { status: 'mismatch', index: i };
          break;
        }
        i -= 1;
        continue;
      }
      restRetries = 0;

      fs.writeFileSync(PROG, String(i + 1));
      if (i === steps.length - 1) {
        result = { status: 'done', index: steps.length };
        await dump(page, 'END');
        console.log(`guide ${name}: все шаги пройдены (${steps.length}), боёв ${fights}.`);
      }
    }
  } catch (e) {
    // Пауза -- не провал маршрута: прокидываем её наверх, чтобы quests.js не записал квесту
    // "ошибку" и не отложил его, а сценарий просто встал. Прогресс уже на диске.
    if (e && e.scenarioPaused) throw e;
    console.log('guide FAILED', e.message);
  }

  if (from >= steps.length) result = { status: 'done', index: steps.length };
  return result;
}

module.exports = { runGuide, travelWait, restIfBlocked };

// Разовый прогон в своём окне браузера (сценарий при этом должен быть остановлен -- один профиль).
if (require.main === module) {
  const { chromium } = require('playwright');
  (async () => {
    const { browserLaunchArgs } = require('./lib');
    const ctx = await chromium.launchPersistentContext(path.join(__dirname, '..', 'chrome-profile'), {
      headless: false,
      viewport: null,
      // Тот же обход DNS, что в look.js: у Chrome свой резолвер, и он иногда отдаёт
      // ERR_NAME_NOT_RESOLVED на lbast.ru, когда curl с той же машины ходит нормально.
      args: await browserLaunchArgs(),
    });
    const page = ctx.pages()[0] || (await ctx.newPage());
    const { fightLoop } = require('./fight_standalone');
    const { resetToQuestMenu, clickInfoForQuest } = require('./qmenu_standalone');
    try {
      const r = await runGuide(page, process.argv[2], process.argv[3], { fightLoop, resetToQuestMenu, clickInfoForQuest });
      console.log('RESULT', JSON.stringify(r));
    } catch (e) {
      console.log('RESULT error', String(e.message).split('\n')[0]);
    } finally {
      await ctx.close();
    }
  })();
}
