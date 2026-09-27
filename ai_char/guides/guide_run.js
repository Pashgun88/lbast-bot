// Guide runner. CLI: node guide_run.js <steps.txt> [fromIndex]
// Library: const { runGuide } = require('./guide_run'); await runGuide(page, file, from?)
//   -> { status: 'done'|'stop'|'mismatch'|'lost'|'nofight'|'error', index }
//   opts.quietDone: не писать письмо Tsunami об успешном проходе (ежедневные квесты - только сбои)
// Step file lines:
//   # comment            ignored
//   @url path            open a game URL (e.g. location.php?mod=konj&lway=7 - horse to Рыбацкая деревня) and wait out travel
//   @city N              fastway to city N (1 Последний портал, 2 Стоунгард, 3 Эвилгард, 4 Кулак, 8 Девтаун, 9 Дорожный крест)
//   @fight               HP gate (>= HP_GATE of max, waits in place exactly as long as needed) + "В бой!" + fightLoop
//   @stop text           stop here on purpose (write a letter with the text)
//   ?text                optional click (skip if absent)
//   text                 click the link whose text starts with this (leading "- " ignored, case/space-insensitive)
// Progress is saved to <steps>.progress after each step; rerun resumes from there.
// Stops on the first step that is not on the screen, dumps the screen and writes a letter to Tsunami.
const { chromium } = require('playwright');
const fs = require('fs');
const m = require('../module');
const HP_GATE = Number(process.env.HP_GATE || 0.7);
const LETTERS = process.env.LETTERS !== '0';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const norm = (s) => String(s || '').replace(/^[\s\-–—*•]+/, '').replace(/[«»"'.,!?…:;()]/g, '').replace(/ё/g, 'е').replace(/\s+/g, ' ').trim().toLowerCase();

// statuenull - отмена Статуи славы; маршруты её не видят вовсе (21.09.2026, слетел бафф).
const links = (page) => page.evaluate(() => Array.from(document.querySelectorAll('a')).map((a) => ({ t: (a.innerText || '').trim().replace(/\s+/g, ' ').replace(/^[*•]\s*/, ''), h: a.getAttribute('href') || '' })).filter((x) => x.t && !/statuenull/i.test(x.h))).catch(() => []);
async function dump(page, tag) {
  const t = await m.getBodyText(page);
  const l = await links(page);
  console.log(`\n== ${tag} [${new Date().toLocaleTimeString('ru-RU')}] ==\n` + t.replace(/\n\s*\n+/g, '\n').slice(0, 1500) + '\nLINKS: ' + l.map((x) => x.t).join(' | '));
  return { t, l };
}
async function goto(page, u) {
  const url = u.startsWith('http') ? u : 'http://lbast.ru/' + u.replace(/^\//, '');
  for (let a = 1; ; a++) {
    try { await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 }); break; } catch (e) {
      console.log('goto retry', a, e.message.split('\n')[0]);
      if (a >= 4) throw e;
      await sleep(5000);
    }
  }
  await sleep(700);
}
async function travelWait(page) {
  for (let i = 0; i < 30; i++) {
    const t = await m.getBodyText(page);
    if (!/В пути|Вы используете амулет|осталось\s+\d+/i.test(t)) return;
    await sleep(6000);
    await goto(page, 'location.php');
  }
}
async function readHp(page) {
  await goto(page, 'pers.php');
  const text = await m.getBodyText(page);
  const mm = text.match(/\((-?\d+)\s*\/\s*(\d+)\)/);
  const rr = text.match(/Лечение:\s*(\d+)\s*hp\/мин/i);
  return mm ? { hp: +mm[1], max: +mm[2], rate: rr ? +rr[1] : null } : null;
}
async function healInPlace(page, frac) {
  for (let i = 0; i < 20; i++) {
    const s = await readHp(page);
    if (!s) { await sleep(60000); continue; }
    const target = Math.ceil(s.max * frac);
    if (s.hp >= target) { console.log(`HP ${s.hp}/${s.max} >= ${target}`); return s; }
    const rate = s.rate > 0 ? s.rate : 14;
    const ms = Math.ceil(((target - s.hp) / rate) * 60000) + 10000;
    console.log(`HP ${s.hp}/${s.max}, need ${target}, ${rate}/min -> wait ${Math.round(ms / 1000)}s`);
    await sleep(ms);
  }
  return null;
}
// Return to where the quest scene is: location.php, then "Продолжить квест" if the game offers it.
async function backToScene(page) {
  await goto(page, 'location.php');
  const l = await links(page);
  const cont = l.find((x) => /^Продолжить квест$/i.test(x.t));
  if (cont) { await goto(page, cont.h); }
}
async function notify(page, msg) {
  if (!LETTERS) return;
  const ok = await m.replyToLetter(page, 'Tsunami', msg).catch(() => false);
  console.log('LETTER', ok, msg);
}
// Exact match wins. Otherwise a fuzzy tier counts only if it matches EXACTLY ONE link: 18.09.2026 a
// prefix match picked the wrong one of six similar lines ("Тара, Запри дверь..." + two endings),
// Gastor died and the quest failed. Ambiguity = stop, never guess.
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
    if (hits.length > 1) { console.log('AMBIGUOUS step, candidates:', hits.map((x) => x.t).join(' || ')); return null; }
  }
  return null;
}

// ===== Мини-игра «Сапёр» (Жертвоприношение, день 1) =====
// Экран: «Достаньте это, не напоровшись на шип» и сетка 6x6. Клетки - ссылки с текстом «*»;
// открытая клетка показывает ЦИФРУ - сколько шипов рядом (27.09.2026 первая же клетка дала «1»).
// Две ловушки, на которых я уже споткнулся:
//   * обычный сборщик ссылок клетки не видит - он срезает ведущую «*» и выбрасывает пустой текст;
//   * выходить из цикла по слову «шип» нельзя: оно есть в самом тексте задания, всегда.
// Ссылки идут в том же порядке, что клетки в тексте, поэтому k-я «*» в чтении = k-я ссылка-клетка.
function parseGrid(text) {
  const rows = [];
  for (const line of String(text || '').split(new RegExp(String.raw`\r?\n`))) {
    const cells = line.trim().split(new RegExp(String.raw`[\s\t]+`));
    if (cells.length === 6 && cells.every((c) => c === '*' || /^[0-9]$/.test(c))) rows.push(cells);
  }
  return rows.length === 6 ? rows : null;
}
// наименьшей суммой соседних цифр - подальше от того, что уже пахнет шипами.
// Какую клетку открывать. Логика обычного сапёра, в два прохода:
//   1) если открытой цифре d не хватает ровно столько шипов, сколько у неё незакрытых соседей -
//      все они шипы, помечаем и больше не трогаем;
//   2) если все шипы цифры уже найдены, её остальные соседи безопасны - их и открываем.
// Безопасных нет - берём незакрытую клетку без метки шипа с наименьшей суммой соседних цифр.
function solveGrid(rows) {
  const key = (r, c) => r + ',' + c;
  const at = (r, c) => (r >= 0 && r < 6 && c >= 0 && c < 6 ? rows[r][c] : null);
  const around = (r, c) => {
    const out = [];
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      if (dr || dc) { const v = at(r + dr, c + dc); if (v !== null) out.push([r + dr, c + dc, v]); }
    }
    return out;
  };
  const digits = [];
  const unknown = [];
  for (let r = 0; r < 6; r++) for (let c = 0; c < 6; c++) {
    if (rows[r][c] === '*') unknown.push([r, c]);
    else digits.push([r, c, Number(rows[r][c])]);
  }
  const thorns = new Set();
  for (let pass = 0; pass < 8; pass++) {
    let changed = false;
    for (const [r, c, d] of digits) {
      const nb = around(r, c).filter(([, , v]) => v === '*');
      const open = nb.filter(([rr, cc]) => !thorns.has(key(rr, cc)));
      const known = nb.length - open.length;
      if (open.length && d - known === open.length) {
        for (const [rr, cc] of open) thorns.add(key(rr, cc));
        changed = true;
      }
    }
    if (!changed) break;
  }
  const safe = [];
  for (const [r, c, d] of digits) {
    const nb = around(r, c).filter(([, , v]) => v === '*');
    const known = nb.filter(([rr, cc]) => thorns.has(key(rr, cc))).length;
    if (d - known === 0) {
      for (const [rr, cc] of nb) {
        if (!thorns.has(key(rr, cc)) && !safe.some(([sr, sc]) => sr === rr && sc === cc)) safe.push([rr, cc]);
      }
    }
  }
  const score = ([r, c]) => around(r, c).reduce((a, [, , v]) => a + (v === '*' ? 0 : Number(v)), 0);
  return { safe, thorns, unknown, score, key };
}
function pickGridCell(rows) {
  const { safe, thorns, unknown, score, key } = solveGrid(rows);
  const free = unknown.filter(([r, c]) => !thorns.has(key(r, c)));
  const pool = safe.length ? safe : (free.length ? free : unknown);
  const best = Math.min(...pool.map(score));
  const cands = pool.filter((x) => score(x) === best);
  return { pick: cands[Math.floor(Math.random() * cands.length)], safeCount: safe.length, thornCount: thorns.size };
}
// Якорь дороги: после него местоположение персонажа известно наверняка.
function lastAnchorBefore(steps, i) {
  const isAnchor = (x) => /^@(city|url|qinfo)/.test(x) || x === 'Конь';
  for (let k = Math.min(i, steps.length - 1); k >= 0; k--) if (isAnchor(steps[k])) return k;
  return 0;
}
function gridCellIndex(rows, r, c) {
  let k = 0;
  for (let rr = 0; rr < 6; rr++) for (let cc = 0; cc < 6; cc++) {
    if (rows[rr][cc] === '*') { if (rr === r && cc === c) return k; k += 1; }
  }
  return -1;
}

async function runGuide(page, FILE, fromArg, opts = {}) {
  const PROG = FILE + '.progress';
  const steps = fs.readFileSync(FILE, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  const from = fromArg !== undefined && fromArg !== null ? Number(fromArg) : (fs.existsSync(PROG) ? Number(fs.readFileSync(PROG, 'utf8')) : 0);
  const name = FILE.split(/[\\/]/).pop();
  // Возобновление ВСЕГДА начинаем с ближайшего якоря дороги перед сохранённым шагом. 27.09.2026 я
  // трижды наступил на одно и то же: маршрут падал, следующие шаги цикла уводили персонажа (то к
  // башне Ордо, то на южное побережье), и возобновлённый заход искал «Зайти в церковь» или «Идти на
  // юг» там, где его застали. Якорь - это @city, @url, @qinfo или «Конь»: после них место известно.
  let start = from;
  if (start > 0 && start < steps.length) {
    // Висящий бой откат отменяет: пока бой на экране, игра никуда не пустит, а @fight его разрулит.
    const tp = await m.getBodyText(page).catch(() => '');
    const lp = await links(page);
    const pendingFight = /Ударить/.test(tp) || lp.some((x) => /^В бой!?$/i.test(x.t));
    if (pendingFight) {
      console.log('Возобновление: на экране висит бой - откат к якорю не делаю.');
    } else {
      const anchor = lastAnchorBefore(steps, start);
      if (anchor !== start) console.log(`Возобновление: откатываюсь с шага ${start} к якорю [${anchor}] ${steps[anchor]}`);
      start = anchor;
    }
  }
  let fights = 0;
  let autoLone = false;
  let tiredWaits = 0;
  let result = { status: 'error', index: from };
  try {
    await backToScene(page);
    for (let i = start; i < steps.length; i++) {
      let step = steps[i];
      let banRewound = false;
      console.log(`\n--- [${i}/${steps.length}] ${step}`);
      // «Вам нужно отдохнуть еще N мин» - кончился резерв (19.09 «Крыша» дважды): ждём и возвращаемся в сцену.
      for (let r = 0; r < 5; r++) {
        const rm = (await m.getBodyText(page)).match(/отдохнуть еще (\d+) мин/i);
        if (!rm) break;
        console.log(`reserve: rest ${rm[1]} min`);
        await sleep((Number(rm[1]) * 60 + 20) * 1000);
        await backToScene(page);
      }
      // «Запрет на квесты N мин.» - после квестового боя игра закрывает сцену на несколько минут
      // (27.09.2026, «Вспышки прошлого» в церкви Единого). Экран отдаёт один линк с этим же текстом:
      // пережидаем и жмём его, сцена продолжается с того же места.
      for (let r = 0; r < 4; r++) {
        const bm = (await m.getBodyText(page)).match(/Запрет на квесты\s+(\d+)\s*мин/i);
        if (!bm) break;
        console.log(`запрет на квесты: ${bm[1]} мин - жду и возвращаюсь в сцену.`);
        await sleep((Number(bm[1]) * 60 + 25) * 1000);
        const lb = await links(page);
        const cont = lb.find((x) => /Запрет на квесты/i.test(x.t));
        if (cont) await goto(page, cont.h);
        else await backToScene(page);
        // 27.09.2026: запрет не просто ждёт - он ВЫКИДЫВАЕТ из сцены (из церкви Единого мы оказались
        // снаружи, на клетке с «Зайти в церковь»). Поэтому после ожидания идём от якоря дороги.
        const back = lastAnchorBefore(steps, i);
        if (back < i) {
          console.log(`запрет на квесты снят - возвращаюсь к якорю [${back}] ${steps[back]}`);
          fs.writeFileSync(PROG, String(back));
          i = back - 1;
          banRewound = true;
        }
        break;
      }
      if (banRewound) continue;
      if (step === '?@fight') {
        // optional extra fight: only if a fight is on screen right now
        const t0 = await m.getBodyText(page);
        const l0 = await links(page);
        if (/Ударить/.test(t0) || l0.some((x) => /^В бой!?$/i.test(x.t))) step = '@fight';
        else { console.log('no extra fight'); fs.writeFileSync(PROG, String(i + 1)); continue; }
      }
      if (step === '@autolone') {
        // Для квестов со случайными экранами-виньетками (Рыбный ресторан): если шага нет, а на экране
        // ровно одна не-служебная ссылка, жмём её. Боевые ссылки, "Уйти" и "Отказаться" — никогда.
        autoLone = true;
      } else if (step.startsWith('@grid')) {
        // ЦЕНА ОШИБКИ (замер 27.09.2026): укол шипом снял 355 HP - персонаж ушёл в минус с 351.
        // Поэтому политика простая: открываем только те клетки, которые ВЫВЕДЕНЫ безопасными,
        // а наугад тычем не больше, чем разрешено параметром (первый клик иначе невозможен -
        // на пустом поле выводить нечего). Кончились безопасные и догадки - уходим из игры целыми.
        const maxGuesses = Number(step.split(/\s+/)[1] || 1);
        let guesses = 0;
        for (let k = 0; k < 36; k++) {
          const hp = await readHp(page);
          if (hp && hp.max > 0 && hp.hp < hp.max * 0.5) { console.log(`@grid: HP ${hp.hp}/${hp.max} - меньше половины, в сетку не лезу.`); break; }
          const rows = parseGrid(await m.getBodyText(page));
          if (!rows) { console.log('@grid: сетки на экране нет - выхожу.'); break; }
          const cells = await page.evaluate(() => Array.from(document.querySelectorAll('a'))
            .filter((a) => (a.innerText || '').trim() === '*')
            .map((a) => a.getAttribute('href') || '')).catch(() => []);
          if (!cells.length) { console.log('@grid: закрытых клеток нет.'); break; }
          const { pick, safeCount, thornCount } = pickGridCell(rows);
          if (!pick) { console.log('@grid: открывать нечего.'); break; }
          if (!safeCount) {
            if (guesses >= maxGuesses) { console.log(`@grid: безопасных клеток не вывести, догадки (${maxGuesses}) кончились - выхожу целым.`); break; }
            guesses += 1;
          }
          const idx = gridCellIndex(rows, pick[0], pick[1]);
          console.log(`@grid: ${cells.length} закрытых, шипов найдено ${thornCount}, безопасных ${safeCount}, ${safeCount ? 'открываю' : `догадка ${guesses}/${maxGuesses}:`} (${pick[0] + 1},${pick[1] + 1}); сетка: ${rows.map((r) => r.join('')).join('/')}`);
          if (idx < 0 || idx >= cells.length) { console.log('@grid: клетка и ссылка не сошлись - выхожу.'); break; }
          await goto(page, cells[idx]);
          const after = await m.getBodyText(page);
          if (/укололи руку/i.test(after)) { console.log('@grid: напоролся на шип - дальше не лезу.'); break; }
        }
        await dump(page, 'AFTER GRID');

      } else if (step.startsWith('@url ')) {
        // Прямой переход по адресу игры (поездка конём в город: location.php?mod=konj&lway=7 -
        // Рыбацкая деревня). Добавлено 21.09.2026 для Галереи искусств.
        await goto(page, step.slice(5).trim());
        await travelWait(page);
        await goto(page, 'location.php');
      } else if (step.startsWith('@qinfo')) {
        // Взять квест формально: Q -> [инфо] -> "К месту выполнения" (без этого сценарий не поднимается).
        const qn = step.slice(6).trim();
        await m.resetToQuestMenu(page);
        const infoOk = await m.clickInfoForQuest(page, qn);
        const l0 = await links(page);
        const go = l0.find((x) => /^К месту выполнения$/i.test(x.t));
        if (!infoOk || !go) { await dump(page, 'QINFO FAILED'); fs.writeFileSync(PROG, String(i)); result = { status: 'mismatch', index: i }; break; }
        await goto(page, go.h);
        await sleep(6500);
        await goto(page, 'location.php');
        await travelWait(page);
      } else if (step.startsWith('@city')) {
        const n = step.split(/\s+/)[1];
        await goto(page, `location.php?mod=fastway&lway=${n}`);
        await sleep(6000);
        await goto(page, 'location.php');
        await travelWait(page);
      } else if (step.startsWith('@ale')) {
        // Выпить Праздничный эль ровно тогда, когда он нужен - перед боем, а не на старте маршрута
        // (25.09.2026: два эля сгорели на заходах, упавших на первом шаге).
        const { tryDrinkBuffAle, isAnyBuffAleActive } = require('../lib/recovery');
        if (await isAnyBuffAleActive(page).catch(() => false)) {
          console.log('@ale: баф эля уже висит, повторно не пью.');
        } else if (await tryDrinkBuffAle(page, 'Праздничный эль').catch(() => false)) {
          console.log('@ale: выпит Праздничный эль перед боем.');
        } else {
          console.log('@ale: эля нет - иду без него.');
        }
        await backToScene(page);
      } else if (step.startsWith('@heal')) {
        // heal in place to the given share of max HP (default HP_GATE) before a step that starts a fight
        const frac = Number(step.split(/\s+/)[1] || HP_GATE);
        // При висящем бое HP не восстанавливается: 19.09 «Ожерелье» ~20 мин ждало лечения перед
        // вторым налётчиком. Бой уже на экране - лечение пропускаем.
        await backToScene(page);
        const lh = await links(page);
        if (lh.some((x) => /^(В бой!?|Принять бой!?)$/i.test(x.t)) || /Ударить/.test(await m.getBodyText(page))) {
          console.log('@heal skipped: fight pending, HP does not regenerate');
        } else {
          await healInPlace(page, frac);
          await backToScene(page);
        }
      } else if (step.startsWith('@stop')) {
        await dump(page, 'STOP');
        await notify(page, `${name}: остановка по плану на шаге ${i}: ${step.slice(5).trim()}`);
        fs.writeFileSync(PROG, String(i + 1));
        result = { status: 'stop', index: i + 1 };
        break;
      } else if (step === '@fight') {
        let { t, l } = await dump(page, 'BEFORE FIGHT');
        // A fight already offered on screen is pending: HP does not regenerate then, waiting is useless.
        const pending = l.some((x) => /^В бой!?$/i.test(x.t));
        if (pending) console.log('fight already pending -> no HP wait');
        if (!/Ударить/.test(t)) {
          if (!pending) {
            const s = await readHp(page);
            if (!s || s.hp < s.max * HP_GATE) await healInPlace(page, HP_GATE);
            await backToScene(page);
          }
          ({ t, l } = await dump(page, 'FIGHT SCREEN'));
          // Перед боем бывают экраны-виньетки с одной «Далее» (Ожерелье, 19.09): листаем их, пока не
          // появится кнопка боя. Только когда на экране ровно одна ссылка сцены и это «Далее».
          for (let k = 0; k < 6 && !/Ударить/.test(t); k++) {
            const scene = l.filter((x) => !/^(Обновить|Чат|В игру)$/i.test(x.t));
            if (scene.some((x) => /^(В бой!?|Принять бой!?|Напасть.*)$/i.test(x.t))) break;
            if (scene.length !== 1 || !/^Далее/i.test(scene[0].t)) break;
            console.log('before fight: Далее');
            await goto(page, scene[0].h);
            ({ t, l } = await dump(page, 'FIGHT SCREEN'));
          }
          const b =l.find((x) => /^В бой!?$/i.test(x.t)) || l.find((x) => /^Принять бой!?$/i.test(x.t)) || l.find((x) => /^Напасть/i.test(x.t));
          if (!b && !/Ударить/.test(t)) { await dump(page, 'NO FIGHT LINK'); await notify(page, `${name}: шаг ${i} ждал бой, но кнопки боя нет. Стою.`); fs.writeFileSync(PROG, String(i)); result = { status: 'nofight', index: i }; break; }
          if (b) { await goto(page, b.h); }
          t = await m.getBodyText(page);
          if (!/Ударить/.test(t)) {
            const l2 = await links(page);
            const b2 = l2.find((x) => /^В бой!?$/i.test(x.t));
            if (b2) await goto(page, b2.h);
          }
        }
        const won = await m.fightLoop(page).catch((e) => { console.log('fightLoop error', e.message); return null; });
        fights++;
        const s = await readHp(page);
        console.log(`>>> fight ${fights} result=${won} HP ${s && s.hp}/${s && s.max}`);
        if (s && s.hp <= 0) { await notify(page, `${name}: бой на шаге ${i} ПРОИГРАН (HP ${s.hp}/${s.max}). Стою, жду лечения.`); fs.writeFileSync(PROG, String(i)); result = { status: 'lost', index: i }; break; }
        await backToScene(page);
      } else if (step.startsWith('*')) {
        // repeat-click while the link is on screen (hidden extra "Далее" screens)
        const want = step.slice(1).trim();
        for (let k = 0; k < 10; k++) {
          const { l } = await dump(page, `REPEAT ${i}.${k}`);
          const hit = findLink(l, want);
          if (!hit) break;
          await goto(page, hit.h);
        }
      } else {
        const optional = step.startsWith('?');
        const want = optional ? step.slice(1).trim() : step;
        let { l } = await dump(page, `STEP ${i}`);
        let hit = findLink(l, want);
        // Guides skip extra narrative screens: when the step is absent and "Далее" is the only way on, take it.
        for (let k = 0; !hit && k < 12; k++) {
          const real = l.filter((x) => !/^(Обновить|Чат|В игру)$/.test(x.t));
          if (real.length !== 1) break;
          const lone = real[0].t;
          const isNext = /^Далее$/i.test(lone);
          const forbidden = /^(в\s*бой!?|принять\s+бой!?|напасть|атаковать|ударить|вступить\s+в\s+бой|уйти|отказаться)/i.test(lone.replace(/^[-\s]+/, ''));
          if (!isNext && !(autoLone && !forbidden)) break;
          console.log(isNext ? 'auto Далее' : `auto lone link: ${lone}`);
          await goto(page, real[0].h);
          ({ l } = await dump(page, `STEP ${i} after auto Далее`));
          hit = findLink(l, want);
        }
        if (!hit) {
          if (optional) { console.log('optional, skipped'); fs.writeFileSync(PROG, String(i + 1)); continue; }
          console.log('>>> MISMATCH, stopping');
          if (process.env.MISMATCH_LETTERS === '1') await notify(page, `${name}: шаг ${i} «${want}» не найден. На экране: ${l.map((x) => x.t).filter((x) => !/^(Обновить|Чат|В игру|Aмулет|Амулет|Конь|Карта|Форум|Кланы|ЖГ|Галерея|Кто здесь\?|Выход|Размер текста)$/.test(x)).slice(0, 12).join(' / ')}. Стою.`);
          fs.writeFileSync(PROG, String(i));
          result = { status: 'mismatch', index: i };
          break;
        }
        await goto(page, hit.h);
        if (/fastway|konj/.test(hit.h)) await travelWait(page);
        // 22.09.2026: резерв ниже нуля - «Вы устали и решили отдохнуть 3 мин. Далее» вместо перехода
        // (дубление/кухня тратят резерв). Ждём и повторяем тот же шаг с экрана, где он был.
        const tired = (await m.getBodyText(page)).match(/устали и решили отдохнуть\s+(\d+)\s*мин/i);
        if (tired && (tiredWaits += 1) <= 5) {
          const min = Number(tired[1]) + 0.3;
          console.log(`устал: отдыхаю ${min} мин и повторяю шаг ${i}`);
          await page.waitForTimeout(min * 60000);
          await goto(page, 'http://lbast.ru/location.php');
          i -= 1;
          continue;
        }
      }
      fs.writeFileSync(PROG, String(i + 1));
      if (i === steps.length - 1) { result = { status: 'done', index: steps.length }; await dump(page, 'END'); if (!opts.quietDone) await notify(page, `${name}: все шаги пройдены (${steps.length}), боёв ${fights}.`); }
    }
  } catch (e) {
    console.log('FAILED', e.message);
  }
  if (from >= steps.length) result = { status: 'done', index: steps.length };
  return result;
}

module.exports = { runGuide };

if (require.main === module) {
  (async () => {
    const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
    const page = ctx.pages()[0] || (await ctx.newPage());
    const r = await runGuide(page, process.argv[2], process.argv[3]);
    console.log('RESULT', JSON.stringify(r));
    await ctx.close();
  })();
}
