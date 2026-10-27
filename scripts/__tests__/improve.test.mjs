// improve.mjs (spec 59.1, A1): the dial sets every expansion knob's default per the table, an override line wins for
// its own knob only, absent reads as gentle, a repo variable that disagrees with the dial is warned about, and every
// governed knob of spec 58's registry has a value at all four dial positions. Pure: bearings text and the variable
// map are injected; the live plan/ is never read.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DEFAULT_POSITION, POSITIONS, TABLE, dial, generatorsListed, lines, main, resolve } from '../plan/improve.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const { KNOBS } = await import(pathToFileURL(path.join(ROOT, 'packages/cli/server/upgrade.mjs')).href);

const bearings = (...rows) => ['# Bearings', '', '## Plan expansion posture', '', ...rows, '', '## Generators', '', '- (none)', ''].join('\n');
const get = (r, knob) => r.knobs.find((k) => k.knob === knob);

// Spec 59's table, restated so a drift in TABLE fails here.
const SPEC = {
  support: ['off', 'triage-only', 'fix-small', 'fix-all'],
  promote: ['owner', 'owner', 'aged', 'aged'],
  generators: ['none', 'none', 'generic', 'generic+project'],
  stall_action: ['off', 'alert', 'alert', 'promote'],
  loop: ['off', 'off', 'on', 'on'],
  ui: ['none', 'none', 'critique', 'iterate'],
  research: ['off', 'off', 'monthly', 'weekly'],
  cadence: ['calm', 'steady', 'steady', 'eager'],
};

// Registry rows the upgrade writes that the dial does not govern: the cadence step's own numbers (the NEXUS_CADENCE
// preset sets them). A new write:true knob lands here or in TABLE, or the test fails.
// `UI` is the browser-walk target, not a dial knob: the dial governs `UI cadence`.
const UNGOVERNED = new Set(['NEXUS_CHAIN_MAX', 'NEXUS_IDLE_BACKOFF', 'NEXUS_QUOTA_MAX', 'UI']);

describe('the dial', () => {
  it('reads each position, case-insensitively, in any bearings line shape', () => {
    for (const p of POSITIONS) {
      assert.equal(dial(bearings(`Improve: ${p}`)).position, p);
      assert.equal(dial(bearings(`- **Improve:** \`${p.toUpperCase()}\``)).position, p);
    }
  });
  it('reads absent as gentle, and an unknown value as gentle with a warning', () => {
    assert.deepEqual([dial('').position, dial('').set], [DEFAULT_POSITION, false]);
    assert.equal(DEFAULT_POSITION, 'gentle');
    const bad = dial(bearings('Improve: loud'));
    assert.equal(bad.position, 'gentle');
    assert.match(bad.warnings[0], /Improve: loud/);
  });
  it('ignores a line inside an HTML comment', () => {
    assert.equal(dial('<!-- Improve: bold -->\n').position, 'gentle');
  });
});

describe('the table', () => {
  it('matches the spec at every position', () => {
    assert.deepEqual(TABLE.map((t) => t.knob).sort(), Object.keys(SPEC).sort());
    for (const [knob, row] of Object.entries(SPEC)) {
      const t = TABLE.find((x) => x.knob === knob);
      assert.deepEqual(POSITIONS.map((p) => t.values[p]), row, knob);
    }
  });
  it('sets every knob at every position from the dial alone', () => {
    for (const p of POSITIONS) {
      const r = resolve(bearings(`Improve: ${p}`));
      for (const [knob, row] of Object.entries(SPEC)) {
        assert.deepEqual([get(r, knob).value, get(r, knob).source], [row[POSITIONS.indexOf(p)], 'dial'], `${p} ${knob}`);
      }
    }
  });
  it('absent dial is the gentle column', () => {
    const r = resolve(bearings());
    assert.equal(r.dial, 'gentle');
    for (const [knob, row] of Object.entries(SPEC)) assert.equal(get(r, knob).value, row[1], knob);
  });
});

describe('registry coverage (spec 58)', () => {
  const rows = new Map(KNOBS.map((k) => [k.knob, k]));
  it('every table knob has a value at all four positions', () => {
    for (const t of TABLE) for (const p of POSITIONS) assert.ok(t.values[p], `${t.knob} lacks a value at ${p}`);
  });
  it('every registry-mapped knob exists in the registry, and its values are ones the registry accepts', () => {
    for (const t of TABLE.filter((x) => x.registry)) {
      const row = rows.get(t.registry);
      assert.ok(row, `${t.knob}: no registry row ${t.registry}`);
      // cadence is a preset name; ui is the audit cadence (UI cadence:), the UI: line being the walk target.
      if (row.accepts && t.knob !== 'cadence') {
        for (const p of POSITIONS) assert.ok(row.accepts.includes(t.values[p]), `${t.knob} ${p}: ${t.values[p]} not accepted by ${t.registry}`);
      }
    }
  });
  it('every knob the upgrade writes is governed by the dial or named as ungoverned', () => {
    const governed = new Set(TABLE.flatMap((t) => [t.registry, t.var]).filter(Boolean));
    for (const k of KNOBS.filter((r) => r.write)) {
      assert.ok(governed.has(k.knob) || UNGOVERNED.has(k.knob), `registry knob ${k.knob} has no value at any dial position: add it to TABLE (scripts/plan/improve.mjs) or UNGOVERNED`);
    }
  });
  it('the check catches a registry knob with no dial row', () => {
    const governed = new Set(TABLE.flatMap((t) => [t.registry, t.var]).filter(Boolean));
    const extra = [...KNOBS, { knob: 'Brand New', at: 'bearings', value: 'x', write: true }];
    const missing = extra.filter((r) => r.write && !governed.has(r.knob) && !UNGOVERNED.has(r.knob)).map((r) => r.knob);
    assert.deepEqual(missing, ['Brand New']);
  });
});

describe('overrides', () => {
  it('an override line wins for its knob only', () => {
    const r = resolve(bearings('Improve: bold', 'Promote: owner'));
    assert.deepEqual([get(r, 'promote').value, get(r, 'promote').source, get(r, 'promote').dial], ['owner', 'override', 'aged']);
    for (const k of r.knobs.filter((x) => x.knob !== 'promote')) assert.equal(k.source, 'dial', k.knob);
  });
  it('reads each override line', () => {
    const names = ['support', 'stall_action', 'loop', 'research', 'ui'];
    const r = resolve(bearings('Improve: off', 'Support: fix-small', 'stall_action: promote', 'loop: on', 'Research: weekly', 'UI cadence: both'));
    assert.deepEqual(names.map((k) => get(r, k).value), ['fix-small', 'promote', 'on', 'weekly', 'both']);
    assert.ok(names.every((k) => get(r, k).source === 'override'));
  });
  it('a listed generator overrides; the upgrade-written (none) does not', () => {
    assert.deepEqual(generatorsListed('## Generators\n\n- (none)\n'), []);
    const on = '## Generators\n\nintro\n\n- cli-ci-red\n- `ui-walk`\n\n## Next\n- not-a-generator\n';
    assert.deepEqual(generatorsListed(on), ['cli-ci-red', 'ui-walk']);
    const r = resolve(`Improve: gentle\n${on}`);
    assert.deepEqual([get(r, 'generators').value, get(r, 'generators').source], ['cli-ci-red,ui-walk', 'override']);
  });
  it('an override value the knob does not accept is ignored with a warning', () => {
    const r = resolve(bearings('Improve: steady', 'Support: maybe'));
    assert.deepEqual([get(r, 'support').value, get(r, 'support').source], ['fix-small', 'dial']);
    assert.match(r.warnings[0], /Support: maybe/);
  });
});

describe('variable and dial', () => {
  it('warns when NEXUS_SUPPORT or NEXUS_CADENCE disagrees with the resolved value', () => {
    const r = resolve(bearings('Improve: bold'), { NEXUS_SUPPORT: 'triage-only', NEXUS_CADENCE: 'calm' });
    assert.equal(r.warnings.length, 2);
    assert.match(r.warnings[0], /NEXUS_SUPPORT=triage-only disagrees with support fix-all/);
    assert.match(r.warnings[1], /NEXUS_CADENCE=calm disagrees with cadence eager/);
  });
  it('is quiet when the variable agrees, is unset or is empty', () => {
    assert.deepEqual(resolve(bearings('Improve: bold'), { NEXUS_SUPPORT: 'fix-all', NEXUS_CADENCE: 'eager' }).warnings, []);
    assert.deepEqual(resolve(bearings('Improve: bold'), {}).warnings, []);
    assert.deepEqual(resolve(bearings('Improve: bold'), { NEXUS_SUPPORT: ' ' }).warnings, []);
  });
  it('compares against the override, not the dial, when the knob has its own line', () => {
    assert.deepEqual(resolve(bearings('Improve: bold', 'Support: fix-small'), { NEXUS_SUPPORT: 'fix-small' }).warnings, []);
  });
  it('the variable wins and prints as source var, with the warning', () => {
    const r = resolve(bearings('Improve: steady'), { NEXUS_SUPPORT: 'off' });
    assert.deepEqual([get(r, 'support').value, get(r, 'support').source, get(r, 'support').dial], ['off', 'var', 'fix-small']);
    assert.match(r.warnings[0], /the variable wins in cloud/);
    const o = resolve(bearings('Improve: steady', 'Support: fix-all'), { NEXUS_SUPPORT: 'off' });
    assert.deepEqual([get(o, 'support').value, get(o, 'support').source], ['off', 'var']);
  });
  it('a variable that is not a level is ignored with a warning', () => {
    const r = resolve(bearings('Improve: steady'), { NEXUS_SUPPORT: 'max', NEXUS_CADENCE: 'sprint' });
    assert.deepEqual([get(r, 'support').value, get(r, 'support').source], ['fix-small', 'dial']);
    assert.match(r.warnings[0], /NEXUS_SUPPORT=max is not one of/);
    assert.deepEqual([get(r, 'cadence').value, get(r, 'cadence').source], ['sprint', 'var']);
  });
  it('UI: is the walk target and not the cadence: only UI cadence overrides the dial', () => {
    const r = resolve(bearings('Improve: bold', 'UI: url'));
    assert.deepEqual([get(r, 'ui').value, get(r, 'ui').source], ['iterate', 'dial']);
    assert.equal(get(resolve(bearings('Improve: bold', 'UI cadence: critique')), 'ui').value, 'critique');
    assert.match(resolve(bearings('UI cadence: dev')).warnings[0], /UI cadence: dev/);
  });
});

describe('the printed form', () => {
  it('is one `<knob> <value> (dial|override)` line per knob', () => {
    const out = lines(resolve(bearings('Improve: steady', 'Promote: owner')));
    assert.equal(out.length, TABLE.length);
    assert.ok(out.includes('support fix-small (dial)'));
    assert.ok(out.includes('promote owner (override)'));
    assert.ok(out.every((l) => /^\S+ \S+ \((dial|override)\)$/.test(l)));
  });
  it('main prints the dial, the lines and the warnings (exit 0), --json the object, and reads a missing file as gentle', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-improve-'));
    fs.mkdirSync(path.join(root, 'plan'));
    fs.writeFileSync(path.join(root, 'plan', 'bearings.md'), bearings('Improve: bold'));
    const out = [];
    const err = [];
    assert.equal(main(['--root', root], { env: { NEXUS_SUPPORT: 'off' }, log: (s) => out.push(s), err: (s) => err.push(s) }), 0);
    assert.equal(out[0], 'improve bold');
    assert.ok(out.includes('support off (var)'));
    assert.match(err[0], /^warn: NEXUS_SUPPORT=off/);
    const j = [];
    main(['--root', root, '--json'], { env: {}, log: (s) => j.push(s), err: () => {} });
    assert.equal(JSON.parse(j[0]).dial, 'bold');
    const none = [];
    main(['--root', path.join(root, 'nowhere')], { env: {}, log: (s) => none.push(s), err: () => {} });
    assert.equal(none[0], 'improve gentle (absent: gentle)');
    fs.rmSync(root, { recursive: true, force: true });
  });
});

describe('--get (the cadence step falls back to the dial)', () => {
  const run = (text, argv, env = {}) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-improve-get-'));
    fs.mkdirSync(path.join(root, 'plan'));
    if (text != null) fs.writeFileSync(path.join(root, 'plan', 'bearings.md'), text);
    const out = [];
    const err = [];
    const code = main(['--root', root, ...argv], { env, log: (s) => out.push(s), err: (s) => err.push(s) });
    fs.rmSync(root, { recursive: true, force: true });
    return { code, out, err };
  };
  it('prints the bare value; --if-set prints nothing for an absent dial and the value once it is set', () => {
    assert.deepEqual(run(bearings('Improve: bold'), ['--get', 'cadence']).out, ['eager']);
    assert.deepEqual(run(bearings(), ['--get', 'cadence']).out, ['steady']);
    assert.deepEqual(run(bearings(), ['--get', 'cadence', '--if-set']).out, []);
    assert.deepEqual(run(bearings('Improve: gentle'), ['--get', 'cadence', '--if-set']).out, ['steady']);
    assert.deepEqual(run(bearings('Support: fix-all'), ['--get', 'support', '--if-set']).out, ['fix-all']);
  });
  it('--line is the one-line digest form: the dial, then each knob not at its dial value', () => {
    assert.deepEqual(run(bearings('Improve: bold', 'Promote: owner'), ['--line'], { NEXUS_CADENCE: 'calm' }).out, ['improve bold; promote owner (override); cadence calm (var)']);
    assert.deepEqual(run(bearings(), ['--line']).out, ['improve gentle (absent: gentle)']);
  });
  it('an unknown knob exits 2', () => {
    const r = run(bearings(), ['--get', 'nope']);
    assert.equal(r.code, 2);
    assert.match(r.err[0], /unknown knob nope/);
  });
});

describe('review findings (3 to 8b)', () => {
  const sec = (...rows) => ['## Plan expansion posture', '', ...rows, ''].join('\n');
  it('3: fenced and indented code blocks are not read', () => {
    assert.equal(resolve('```\nImprove: bold\n```\nImprove: off\n').dial, 'gentle');
    assert.equal(resolve(sec('~~~', 'Improve: bold', '~~~', 'Improve: off')).dial, 'off');
    assert.equal(resolve(sec('Example:', '', '    Improve: bold', '', 'Improve: off')).dial, 'off');
    assert.equal(resolve(sec('- item', '', '    Improve: bold', '', 'Improve: off')).dial, 'bold');
    assert.deepEqual(generatorsListed('## Generators\n\n```\n- fake\n```\n- real\n'), ['real']);
    const r = resolve(sec('```', 'Support: fix-all', '```'));
    assert.equal(get(r, 'support').source, 'dial');
  });
  it('4: duplicate Improve lines warn and name the winner', () => {
    const r = resolve(sec('Improve: bold', 'Improve: off'));
    assert.equal(r.dial, 'bold');
    assert.ok(r.warnings.some((w) => /more than one Improve/.test(w) && /bold/.test(w)), r.warnings.join('|'));
    assert.deepEqual(resolve(sec('Improve: bold')).warnings, []);
  });
  it('5: Improve is read only inside Plan expansion posture', () => {
    const text = '# B\n\nImprove: bold\n\n## Plan expansion posture\n\nImprove: steady\n\n## Other\n\nImprove: off\n';
    const r = resolve(text);
    assert.equal(r.dial, 'steady');
    assert.ok(r.warnings.some((w) => /outside/.test(w)));
    const stray = resolve('## Support\n\nImprove: bold\n');
    assert.equal(stray.dial, 'gentle');
    assert.ok(stray.warnings.some((w) => /outside/.test(w)));
    assert.equal(resolve('## Plan expansion posture\r\n\r\nImprove: bold\r\n').dial, 'bold');
  });
  it('6: values tolerate a BOM, trailing punctuation and comments; prose is not an override', () => {
    assert.equal(dial('﻿## Plan expansion posture\n\nImprove: bold\n').position, 'bold');
    for (const tail of ['bold.', 'bold,', 'bold  # note', 'bold <!-- n -->', '**bold**', '`bold`']) assert.equal(resolve(sec(`Improve: ${tail}`)).dial, 'bold', tail);
    const r = resolve(sec('Improve: steady', '- Support: fix-all is what we run', 'loop: on the tick', '- **Promote:** aged', 'stall_action: promote.'));
    assert.equal(get(r, 'support').source, 'dial');
    assert.equal(get(r, 'loop').source, 'dial');
    assert.deepEqual([get(r, 'promote').source, get(r, 'stall_action').value], ['override', 'promote']);
    assert.equal(resolve(sec('Improve: bold is the plan')).dial, 'gentle');
  });
  it('7: Generators heading suffix and numbered items; a ### ends the list', () => {
    assert.deepEqual(generatorsListed('## Generators (optional)\n\n1. foo\n2) bar\n- baz\n\n### Notes\n\n- not-one\n'), ['foo', 'bar', 'baz']);
    assert.deepEqual(generatorsListed('## Generators\n\n- (none)\n'), []);
  });
  it('8b: Promote: autonomous is accepted', () => {
    const r = resolve(sec('Improve: bold', 'Promote: autonomous'));
    assert.deepEqual([get(r, 'promote').value, get(r, 'promote').source], ['autonomous', 'override']);
    assert.deepEqual(r.warnings, []);
  });
});

// A2 (spec 59.2): the skills that read expansion knobs read them through the resolver, never from bearings lines.
// The pattern is the old phrasing: a backticked knob line (`Support: fix-small`, `loop: on`, `Promote:`) or the
// `## Generators` heading, which a skill only writes when it greps bearings for the knob. A skill describes a value
// as "the `support` knob reads `fix-small`" and fetches it with `node scripts/plan/improve.mjs`.
describe('the named skills read knobs through the resolver (A2)', () => {
  const STALE = [/`(?:Support|Promote|stall_action|Research|UI cadence)(?::|: [^`\n]*)`/, /`loop: [^`\n]*`/, /## Generators/];
  const READERS = {
    'skills': ['march', 'triage', 'expand', 'iterate', 'digest'],
    'templates/skills': ['march', 'triage', 'expand', 'iterate', 'critique', 'digest'],
  };
  const stale = (text) => STALE.filter((re) => re.test(text.replace(/\s+/g, ' '))).map(String);

  it('the check catches the old phrasings', () => {
    for (const old of ['else `Support:` in `plan/bearings.md`', 'Under `Promote: aged` (or', 'Runs when bearings says `loop: on`', '`stall_action: promote` under', 'a `## Generators` line', 'with `UI cadence: critique` or']) {
      assert.ok(stale(old).length, old);
    }
    for (const fine of ['the `support` knob reads `fix-small`', 'a `loop:do` label and `loop:veto`', 'the `Improve:` dial', '`UI: none` browses nothing']) assert.deepEqual(stale(fine), [], fine);
  });
  for (const [dir, names] of Object.entries(READERS)) {
    for (const name of names) {
      const rel = `${dir}/${name}.md`;
      const text = fs.readFileSync(path.join(ROOT, rel), 'utf8');
      it(`${rel} fetches knobs with improve.mjs and greps none from bearings`, () => {
        assert.match(text, /scripts\/plan\/improve\.mjs/, `${rel} never names the resolver`);
        assert.deepEqual(stale(text), [], `${rel} reads a knob line from bearings itself`);
      });
    }
  }
  it('nexus\'s own critique reads no dial knob (its GUI pass is not cadence-gated)', () => {
    assert.deepEqual(stale(fs.readFileSync(path.join(ROOT, 'skills/critique.md'), 'utf8')), []);
  });
});

describe('the cadence step reads the dial when the variable is unset (A2)', () => {
  for (const file of ['.github/workflows/march.yml', '.github/workflows/heartbeat.yml', 'templates/.github/workflows/march.yml', 'templates/.github/workflows/heartbeat.yml']) {
    it(`${file}: every Cadence step falls back to improve.mjs --get cadence --if-set`, () => {
      const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
      const runs = text.split('\n').filter((l) => /cadence\.mjs resolve/.test(l));
      assert.ok(runs.length, `${file} has no cadence resolve step`);
      for (const l of runs) assert.match(l, /--cadence "\$\{CADENCE:-\$\(node scripts\/plan\/improve\.mjs --get cadence --if-set/, l.trim());
    });
  }
});
