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
const UNGOVERNED = new Set(['NEXUS_CHAIN_MAX', 'NEXUS_IDLE_BACKOFF', 'NEXUS_QUOTA_MAX']);

describe('the dial', () => {
  it('reads each position, case-insensitively, in any bearings line shape', () => {
    for (const p of POSITIONS) {
      assert.equal(dial(`Improve: ${p}`).position, p);
      assert.equal(dial(`- **Improve:** \`${p.toUpperCase()}\``).position, p);
    }
  });
  it('reads absent as gentle, and an unknown value as gentle with a warning', () => {
    assert.deepEqual([dial('').position, dial('').set], [DEFAULT_POSITION, false]);
    assert.equal(DEFAULT_POSITION, 'gentle');
    const bad = dial('Improve: loud');
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
      // ui holds the dial's cadence words (the UI: line itself is the walk target); cadence is a preset name.
      if (row.accepts && !['ui', 'cadence'].includes(t.knob)) {
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
    const r = resolve(bearings('Improve: off', 'Support: fix-small', 'stall_action: promote', 'loop: on', 'Research: weekly', 'UI: url'));
    assert.deepEqual(names.map((k) => get(r, k).value), ['fix-small', 'promote', 'on', 'weekly', 'url']);
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
    const r = resolve(bearings('Improve: steady', 'Support: email us'));
    assert.deepEqual([get(r, 'support').value, get(r, 'support').source], ['fix-small', 'dial']);
    assert.match(r.warnings[0], /Support: email/);
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
  it('never changes the printed value: the variable is a warning, not a source', () => {
    const r = resolve(bearings('Improve: steady'), { NEXUS_SUPPORT: 'off' });
    assert.deepEqual([get(r, 'support').value, get(r, 'support').source], ['fix-small', 'dial']);
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
    assert.ok(out.includes('support fix-all (dial)'));
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
