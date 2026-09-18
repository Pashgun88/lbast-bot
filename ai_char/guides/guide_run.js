// Guide runner. CLI: node guide_run.js <steps.txt> [fromIndex]
// Library: const { runGuide } = require('./guide_run'); await runGuide(page, file, from?)
//   -> { status: 'done'|'stop'|'mismatch'|'lost'|'nofight'|'error', index }
// Step file lines:
//   # comment            ignored
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
const norm = (s) => String(s || '').replace(/^[\s\-–—]+/, '').replace(/[«»"'.,!?…:;()]/g, '').replace(/ё/g, 'е').replace(/\s+/g, ' ').trim().toLowerCase();

const links = (page) => page.evaluate(() => Array.from(document.querySelectorAll('a')).map((a) => ({ t: (a.innerText || '').trim().replace(/\s+/g, ' '), h: a.getAttribute('href') || '' })).filter((x) => x.t)).catch(() => []);
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

async function runGuide(page, FILE, fromArg) {
  const PROG = FILE + '.progress';
  const steps = fs.readFileSync(FILE, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  const from = fromArg !== undefined && fromArg !== null ? Number(fromArg) : (fs.existsSync(PROG) ? Number(fs.readFileSync(PROG, 'utf8')) : 0);
  const name = FILE.split(/[\\/]/).pop();
  let fights = 0;
  let result = { status: 'error', index: from };
  try {
    await backToScene(page);
    for (let i = from; i < steps.length; i++) {
      let step = steps[i];
      console.log(`\n--- [${i}/${steps.length}] ${step}`);
      if (step === '?@fight') {
        // optional extra fight: only if a fight is on screen right now
        const t0 = await m.getBodyText(page);
        const l0 = await links(page);
        if (/Ударить/.test(t0) || l0.some((x) => /^В бой!?$/i.test(x.t))) step = '@fight';
        else { console.log('no extra fight'); fs.writeFileSync(PROG, String(i + 1)); continue; }
      }
      if (step.startsWith('@city')) {
        const n = step.split(/\s+/)[1];
        await goto(page, `location.php?mod=fastway&lway=${n}`);
        await sleep(6000);
        await goto(page, 'location.php');
        await travelWait(page);
      } else if (step.startsWith('@heal')) {
        // heal in place to the given share of max HP (default HP_GATE) before a step that starts a fight
        const frac = Number(step.split(/\s+/)[1] || HP_GATE);
        await healInPlace(page, frac);
        await backToScene(page);
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
          const b = l.find((x) => /^В бой!?$/i.test(x.t)) || l.find((x) => /^Принять бой!?$/i.test(x.t)) || l.find((x) => /^Напасть/i.test(x.t));
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
          if (real.length !== 1 || !/^Далее$/i.test(real[0].t)) break;
          console.log('auto Далее');
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
      }
      fs.writeFileSync(PROG, String(i + 1));
      if (i === steps.length - 1) { result = { status: 'done', index: steps.length }; await dump(page, 'END'); await notify(page, `${name}: все шаги пройдены (${steps.length}), боёв ${fights}.`); }
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
