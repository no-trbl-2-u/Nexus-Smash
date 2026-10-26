// The fork's identity (spec 60, A2): the GUI's help links, the clone hint, the upgrade runbook link and the Discord
// user agent all come from kit.json through shared/kit.mjs, the package is named for the fork's scope, and nothing
// the package ships names the upstream kit.
import './jsx.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { KIT, LAUNCH, cloneUrl, fromPackage, kitDoc, kitUrl, launchLine, loadKit, uiKit } from '../shared/kit.mjs';
import { removeTreeSync } from './helpers/tmp.mjs';

const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = path.resolve(PKG, '..', '..');
const rootKit = JSON.parse(fs.readFileSync(path.join(ROOT, 'kit.json'), 'utf8'));
const pkgJson = JSON.parse(fs.readFileSync(path.join(PKG, 'package.json'), 'utf8'));

test('KIT is the root kit.json', () => {
  assert.equal(KIT.repo, rootKit.repo);
  assert.equal(KIT.package, rootKit.package);
  assert.equal(KIT.docs, rootKit.docs.replace(/\/+$/, ''));
  assert.equal(kitUrl(), `https://github.com/${rootKit.repo}`);
  assert.equal(cloneUrl(), `https://github.com/${rootKit.repo}.git`);
  assert.equal(kitDoc('concepts/plan-shape.md'), `${KIT.docs}/concepts/plan-shape.md`);
  assert.deepEqual(uiKit(), { repo: KIT.repo, package: KIT.package, docs: KIT.docs, launch: LAUNCH });
});

test('loadKit: the first full kit.json wins, a partial one is skipped, else package.json speaks', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-kit-'));
  try {
    const full = { repo: 'o/r', upstream: 'u/k', package: '@o/cli', docs: 'https://github.com/o/r/blob/main/' };
    const part = { repo: 'x/y', package: '@x/cli' };
    fs.writeFileSync(path.join(dir, 'full.json'), JSON.stringify(full));
    fs.writeFileSync(path.join(dir, 'part.json'), JSON.stringify(part));
    fs.writeFileSync(path.join(dir, 'pkg.json'), JSON.stringify({ name: '@p/cli', repository: { url: 'git+https://github.com/p/q.git' } }));
    const at = (f) => path.join(dir, f);
    assert.deepEqual(loadKit([at('gone.json'), at('part.json'), at('full.json')], at('pkg.json')), { ...full, docs: 'https://github.com/o/r/blob/main' });
    assert.deepEqual(loadKit([at('gone.json'), at('part.json')], at('pkg.json')), { repo: 'p/q', upstream: '', package: '@p/cli', docs: 'https://github.com/p/q/blob/main' });
    assert.deepEqual(fromPackage(null), { repo: '', upstream: '', package: '', docs: '' });
  } finally {
    removeTreeSync(dir);
  }
});

test('launchLine: npx for an npm install, node and the bin for a clone', () => {
  const kit = { ...KIT, package: '@o/cli' };
  assert.equal(launchLine({ kit, bin: '/home/a/.npm/_npx/1/node_modules/@o/cli/bin/nexus.mjs' }), 'npx @o/cli');
  assert.equal(launchLine({ kit, bin: 'C:\\npm\\node_modules\\@o\\cli\\bin\\nexus.mjs' }), 'npx @o/cli');
  assert.equal(launchLine({ kit, bin: '/src/kit/packages/cli/bin/nexus.mjs' }), 'node /src/kit/packages/cli/bin/nexus.mjs');
  assert.equal(launchLine({ kit, bin: '/My Code/kit/packages/cli/bin/nexus.mjs' }), 'node "/My Code/kit/packages/cli/bin/nexus.mjs"');
});

test('the help links, clone hint, runbook link and user agent read kit.json', async () => {
  const { PLAN_DOCS } = await import('../server/plan.mjs');
  const { DOCS } = await import('../server/vault-setup.mjs');
  const { ADOPT_PASTE } = await import('../server/server.mjs');
  const { UPGRADE_HELP } = await import('../server/upgrade.mjs');
  const { DISCORD_UA } = await import('../server/stack-checks-more.mjs');
  assert.equal(PLAN_DOCS, `${rootKit.docs}/concepts/plan-shape.md`);
  assert.equal(DOCS, `${rootKit.docs}/customization/secrets.md`);
  assert.match(ADOPT_PASTE, new RegExp(`^Clone https://github\\.com/${rootKit.repo}\\.git to`));
  assert.ok(UPGRADE_HELP.includes(`The runbook: ${rootKit.docs}/playbooks/upgrade.md`));
  assert.equal(DISCORD_UA, `DiscordBot (https://github.com/${rootKit.repo}, 1)`);
});

test('the UI reads the same identity (src/data/kit.js, defined at build time)', async () => {
  const { KIT: UI, kitDoc: uiDoc } = await import('../src/data/kit.js');
  assert.deepEqual({ ...UI }, uiKit());
  const { VAULT_DOCS } = await import('../src/screens/vault/model.js');
  assert.equal(VAULT_DOCS, uiDoc('customization/secrets.md'));
  const { healthWords } = await import('../src/data/health.js');
  assert.match(healthWords({ status: 'down' }).text, new RegExp(`Launch it again \\(${LAUNCH.replace(/[.]/g, '\\.')}\\)`));
  const vite = fs.readFileSync(path.join(PKG, 'vite.config.mjs'), 'utf8');
  assert.match(vite, /__NEXUS_KIT__: JSON\.stringify\(uiKit\(\)\)/);
});

test('the package is the fork\'s scope and ships the bundled kit.json', () => {
  assert.equal(pkgJson.name, rootKit.package);
  assert.deepEqual(pkgJson.bin, { nexus: 'bin/nexus.mjs' });
  assert.ok(pkgJson.files.includes('kit') && pkgJson.files.includes('shared'));
  assert.match(pkgJson.repository.url, new RegExp(rootKit.repo));
  const lock = JSON.parse(fs.readFileSync(path.join(PKG, 'package-lock.json'), 'utf8'));
  assert.equal(lock.name, rootKit.package);
  assert.equal(lock.packages[''].name, rootKit.package);
  assert.match(fs.readFileSync(path.join(PKG, 'scripts', 'bundle-kit.mjs'), 'utf8'), /'kit', 'kit\.json'/);
  const bundled = path.join(PKG, 'kit', 'kit.json');
  if (fs.existsSync(bundled)) assert.deepEqual(JSON.parse(fs.readFileSync(bundled, 'utf8')), rootKit, 'a build copies kit.json as it is');
});

test('nothing the package runs names the upstream kit', () => {
  const upstream = new RegExp(`${rootKit.upstream.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}|@${'usenexus'}/`, 'i');
  const hits = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(m?js|jsx)$/.test(e.name) && upstream.test(fs.readFileSync(p, 'utf8'))) hits.push(path.relative(PKG, p));
    }
  };
  for (const d of ['bin', 'server', 'shared', 'src']) walk(path.join(PKG, d));
  assert.deepEqual(hits, []);
});
