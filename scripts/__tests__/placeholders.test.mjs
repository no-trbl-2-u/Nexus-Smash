// scripts/placeholders.mjs (the placeholders leg's scan): a pending Add or Edit is checked as settled. node:test, fixtures
// in a scratch dir, never the live plan/.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { scanPlaceholders, scanSettled } from '../placeholders.mjs';

const rules = {
  vocabulary: new Set(['<PROJECT>', '<NN>']),
  retired: new Map([['<PHASE_N>', '<SPEC_N>']]),
  retiredHome: 'playbooks/upgrade.md',
};

function fixture(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'placeholders-'));
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  }
  return root;
}

const SPEC = [
  '# Spec 07', '', '## Acceptance', '', '- **A1** One.', '', 'Measure: 1 open · 0 closed · next A2', '',
  '## Chunks', '', '- [ ] **07.1** One · S · closes A1 · needs —', '',
].join('\n');
const head = '---\nclose: 07.9\ndate: 2026-10-20\nsays: Fixture\n---\n';
const add = (body) => `${head}## Add plan/07-x.md\n~~~ acceptance\n- **A?zip** ${body}\n~~~\n`;
const edit = (next) => `${head}## Edit plan/07-x.md\n~~~ old\nOne.\n~~~\n~~~ new\n${next}\n~~~\n`;

describe('scanPlaceholders', () => {
  const run = (text, file = 'a.md') => scanPlaceholders([file], () => text, rules);
  it('passes a known token and fails an unknown one with file:line', () => {
    assert.deepEqual(run('use <PROJECT> here').failures, []);
    assert.match(run('ok\nuse <PROJEKT> here').failures[0], /^a\.md:2: unknown placeholder <PROJEKT>/);
  });
  it('lets only the upgrade playbook name a retired token', () => {
    assert.equal(run('<PHASE_N>').failures.length, 1);
    assert.deepEqual(run('<PHASE_N>', 'playbooks/upgrade.md').failures, []);
  });
});

describe('scanSettled', () => {
  it('fails a pending Add carrying an unknown placeholder, before it settles', () => {
    const root = fixture({ 'plan/07-x.md': SPEC, 'plan/pending/p.md': add('Row for <BOGUS_TOKEN>.') });
    const { failures } = scanSettled(root, ['plan/07-x.md'], rules);
    assert.ok(failures.some((f) => /plan\/07-x\.md:\d+: unknown placeholder <BOGUS_TOKEN>/.test(f)), failures.join('\n'));
  });
  it('passes a pending Add carrying a known placeholder', () => {
    const root = fixture({ 'plan/07-x.md': SPEC, 'plan/pending/p.md': add('Row for <PROJECT>.') });
    assert.deepEqual(scanSettled(root, ['plan/07-x.md'], rules).failures, []);
  });
  it('fails a pending Edit that introduces an unknown placeholder, passes a known one', () => {
    const bad = fixture({ 'plan/07-x.md': SPEC, 'plan/pending/p.md': edit('Two <BOGUS_TOKEN>.') });
    assert.match(scanSettled(bad, ['plan/07-x.md'], rules).failures[0], /plan\/07-x\.md:\d+: unknown placeholder <BOGUS_TOKEN>/);
    const ok = fixture({ 'plan/07-x.md': SPEC, 'plan/pending/p.md': edit('Two <NN>.') });
    assert.deepEqual(scanSettled(ok, ['plan/07-x.md'], rules).failures, []);
  });
});
