#!/usr/bin/env node
/**
 * evals/eval-install.mjs: scripts/install.mjs and scripts/vendor-core.mjs
 * against a throwaway copy of the kit, a temp HOME and a temp client repo.
 * Nothing here reads or writes the real home directory or a real client:
 * every child gets HOME, CLAUDE_CONFIG_DIR and CODEX_HOME under a temp root
 * (WATCHDOG_EVAL_TMP when set, the OS temp directory otherwise).
 *
 *   node evals/eval-install.mjs
 */

import { assert, check, done } from './lib/harness.mjs';
import { spawnSync } from 'node:child_process';
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const realKit = dirname(dirname(fileURLToPath(import.meta.url)));
const root = mkdtempSync(join(process.env.WATCHDOG_EVAL_TMP || tmpdir(), 'wk-install-'));
process.on('exit', () => rmSync(root, { recursive: true, force: true }));

/** A fresh copy of the kit (no .git), so an eval can make the checkout move on. */
function freshKit(name) {
  const dir = join(root, name);
  cpSync(realKit, dir, { recursive: true, verbatimSymlinks: true, filter: (src) => basename(src) !== '.git' });
  return dir;
}
function freshHome(name) {
  const home = join(root, name);
  mkdirSync(home, { recursive: true });
  return home;
}
function run(kit, home, ...args) {
  const env = { ...process.env, HOME: home, CLAUDE_CONFIG_DIR: join(home, '.claude'), CODEX_HOME: join(home, '.codex') };
  const out = spawnSync(process.execPath, [join(kit, 'scripts', args[0]), ...args.slice(1)], { env, encoding: 'utf8' });
  return { status: out.status, out: (out.stdout || '') + (out.stderr || '') };
}
const install = (kit, home, ...a) => run(kit, home, 'install.mjs', ...a);
const vendor = (kit, home, ...a) => run(kit, home, 'vendor-core.mjs', ...a);
const ledger = (home) => JSON.parse(readFileSync(join(home, '.watchdog-kit-install.json'), 'utf8'));
const skillFile = 'skills/watchdog-survey/SKILL.md';
const agentFile = readdirSync(join(realKit, 'agents')).filter((f) => f.endsWith('.md')).sort()[0];

// ---- vendor-core --check ----

await check('vendor-core --check exits 1 on missing, stale or diverged files, one line each with the fix, and 0 only when all match', () => {
  const kit = freshKit('kit-vendor');
  const home = freshHome('home-vendor');
  const repo = join(root, 'client-repo');
  mkdirSync(repo, { recursive: true });

  let r = vendor(kit, home, repo, '--check');
  assert.equal(r.status, 1, 'nothing vendored yet must fail');
  assert.match(r.out, /^missing +lib\/watchdog\/core\/scope\.js  \(.*run node scripts\/vendor-core\.mjs /m);

  assert.equal(vendor(kit, home, repo).status, 0);
  r = vendor(kit, home, repo, '--check');
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /all \d+ file\(s\) match the kit/);

  unlinkSync(join(repo, 'lib/watchdog/core/scope.js'));
  appendFileSync(join(repo, 'lib/watchdog/core/run.js'), '\n// client edit\n');
  appendFileSync(join(kit, 'core/verdicts.js'), '\n// kit moved on\n');
  r = vendor(kit, home, repo, '--check');
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /^missing +lib\/watchdog\/core\/scope\.js  \(/m);
  assert.match(r.out, /^diverged lib\/watchdog\/core\/run\.js  \(.*--force/m);
  assert.match(r.out, /^stale +lib\/watchdog\/core\/verdicts\.js  \(/m);
});

// ---- install.mjs copy mode ----

await check('a copy install records a baseline sha256 per installed file, including the materialised $KIT, and leaves no temporary ledger', () => {
  const kit = freshKit('kit-copy-a');
  const home = freshHome('home-copy-a');
  const r = install(kit, home, '--claude', '--copy', '--yes');
  assert.equal(r.status, 0, r.out);
  const l = ledger(home);
  const skill = l.entries.find((e) => e.target.endsWith('/.claude/skills/watchdog-survey'));
  assert.equal(skill.kind, 'copy');
  assert.match(skill.files['SKILL.md'], /^[0-9a-f]{64}$/);
  const build = l.entries.find((e) => e.target.endsWith('/.claude/skills/watchdog-build'));
  assert.ok(build.files['kit/core/scope.js'], 'materialised kit parts are hashed too');
  const agent = l.entries.find((e) => e.target.endsWith(`/.claude/agents/${agentFile}`));
  assert.match(agent.files[''], /^[0-9a-f]{64}$/);
  assert.deepEqual(readdirSync(home).filter((f) => f.endsWith('.tmp')), []);
});

await check('a copy re-run refreshes stale files, reports and keeps hand-edited ones, and keeps what is up to date', () => {
  const kit = freshKit('kit-copy-b');
  const home = freshHome('home-copy-b');
  assert.equal(install(kit, home, '--claude', '--copy', '--yes').status, 0);
  const installedSkill = join(home, '.claude', skillFile.replace(/^skills\//, 'skills/'));
  const installedAgent = join(home, '.claude/agents', agentFile);
  const editedPath = join(home, '.claude/skills/watchdog-review/SKILL.md');
  const baselineEdited = ledger(home).entries.find((e) => e.target.endsWith('/skills/watchdog-review')).files['SKILL.md'];

  appendFileSync(join(kit, skillFile), '\nkit moved on\n');
  appendFileSync(join(kit, 'agents', agentFile), '\nkit moved on\n');
  appendFileSync(join(kit, 'skills/watchdog-review/SKILL.md'), '\nkit moved on\n');
  appendFileSync(editedPath, '\nmy own note\n');

  let r = install(kit, home, '--claude', '--copy');
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /^refresh ~\/\.claude\/skills\/watchdog-survey  \(1 file\(s\) newer in the kit\)/m);
  assert.match(r.out, /^refresh ~\/\.claude\/agents\//m);
  assert.match(r.out, /^edited +~\/\.claude\/skills\/watchdog-review\/SKILL\.md  \(changed by hand since install; kept/m);
  assert.match(r.out, /^keep +~\/\.claude\/skills\/watchdog-eval /m);
  assert.doesNotMatch(readFileSync(installedSkill, 'utf8'), /kit moved on/, 'a dry run changes nothing');

  r = install(kit, home, '--claude', '--copy', '--yes');
  assert.equal(r.status, 0, r.out);
  assert.match(readFileSync(installedSkill, 'utf8'), /kit moved on\n$/);
  assert.match(readFileSync(installedAgent, 'utf8'), /kit moved on\n$/);
  const edited = readFileSync(editedPath, 'utf8');
  assert.match(edited, /my own note\n$/);
  assert.doesNotMatch(edited, /kit moved on/);
  const l = ledger(home);
  assert.equal(l.entries.find((e) => e.target.endsWith('/skills/watchdog-review')).files['SKILL.md'], baselineEdited, 'an edited file keeps its install-time baseline');

  r = install(kit, home, '--claude', '--copy');
  assert.doesNotMatch(r.out, /^refresh/m, 'refreshed files are up to date on the next run');
  assert.match(r.out, /^edited +~\/\.claude\/skills\/watchdog-review\/SKILL\.md/m, 'the edit is still reported');
});

await check('symlink mode is unchanged: a re-run keeps every link', () => {
  const kit = freshKit('kit-link');
  const home = freshHome('home-link');
  assert.equal(install(kit, home, '--claude', '--yes').status, 0);
  appendFileSync(join(kit, skillFile), '\nkit moved on\n');
  const r = install(kit, home, '--claude');
  assert.equal(r.status, 0, r.out);
  assert.doesNotMatch(r.out, /^(refresh|edited|replace|create)/m);
  assert.match(r.out, /^keep +~\/\.claude\/skills\/watchdog-survey  \(already installed \(symlink\)\)/m);
  assert.equal(ledger(home).entries[0].files, undefined);
});

// ---- install.mjs --check ----

await check('--check passes a clean copy install and a clean symlink install', () => {
  const kit = freshKit('kit-check-clean');
  const homeCopy = freshHome('home-check-copy');
  const homeLink = freshHome('home-check-link');
  assert.equal(install(kit, homeCopy, '--all', '--copy', '--yes').status, 0);
  assert.equal(install(kit, homeLink, '--all', '--yes').status, 0);
  for (const home of [homeCopy, homeLink]) {
    const r = install(kit, home, '--check');
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /^ok: \d+ installed path\(s\), nothing to fix/m);
  }
});

await check('--check fails on no ledger and on an unparseable ledger, naming the fix', () => {
  const kit = freshKit('kit-check-ledger');
  const home = freshHome('home-check-ledger');
  let r = install(kit, home, '--check');
  assert.equal(r.status, 1);
  assert.match(r.out, /^problem ~\/\.watchdog-kit-install\.json  no ledger; run node scripts\/install\.mjs/m);
  writeFileSync(join(home, '.watchdog-kit-install.json'), '{ not json');
  r = install(kit, home, '--check');
  assert.equal(r.status, 1);
  assert.match(r.out, /^problem ~\/\.watchdog-kit-install\.json  not readable \(.*\); move it aside/m);
});

await check('--check reports a gone path, a broken $KIT, stale and edited copies, and a stale Codex mirror, one line each', () => {
  const kit = freshKit('kit-check-bad');
  const home = freshHome('home-check-bad');
  assert.equal(install(kit, home, '--claude', '--copy', '--yes').status, 0);
  rmSync(join(home, '.claude/skills/watchdog-page'), { recursive: true });
  rmSync(join(home, '.claude/skills/watchdog-build/kit/templates'), { recursive: true });
  appendFileSync(join(kit, skillFile), '\nkit moved on\n');
  appendFileSync(join(home, '.claude/skills/watchdog-review/SKILL.md'), '\nmy own note\n');
  const toml = readdirSync(join(kit, 'codex/agents'))[0];
  appendFileSync(join(kit, 'codex/agents', toml), '\n# drift\n');

  const r = install(kit, home, '--check');
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /^problem ~\/\.claude\/skills\/watchdog-page  in the ledger but gone; re-run node scripts\/install\.mjs --claude --copy --yes$/m);
  assert.match(r.out, /^problem ~\/\.claude\/skills\/watchdog-build\/kit  \$KIT is missing templates; re-run/m);
  assert.match(r.out, /^problem ~\/\.claude\/skills\/watchdog-survey\/SKILL\.md  stale copy, newer in the kit; re-run/m);
  assert.match(r.out, /^problem ~\/\.claude\/skills\/watchdog-review\/SKILL\.md  edited by hand since install; keep it, or delete it and re-run/m);
  assert.match(r.out, new RegExp(`^problem .*codex/agents/${toml.replace('.', '\\.')}  Codex agent mirror out of step with agents/\\*\\.md; run node scripts/sync-codex-agents\\.mjs$`, 'm'));
  assert.match(r.out, new RegExp(`^problem ~/\\.claude/skills/watchdog-build/kit/codex/agents/${toml.replace('.', '\\.')}  stale copy`, 'm'), 'the materialised $KIT copy of the drifted mirror is stale too');
  assert.match(r.out, /^6 problem\(s\)$/m, r.out);
  assert.ok(existsSync(join(home, '.claude/skills/watchdog-review/SKILL.md')), '--check changes nothing');
});

await check('--check reports a symlink whose checkout is gone', () => {
  const kit = freshKit('kit-check-gone');
  const home = freshHome('home-check-gone');
  assert.equal(install(kit, home, '--claude', '--yes').status, 0);
  const moved = `${kit}-moved`;
  cpSync(kit, moved, { recursive: true, verbatimSymlinks: true });
  rmSync(kit, { recursive: true });
  const r = install(moved, home, '--check');
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /^problem ~\/\.claude\/skills\/watchdog-survey  its checkout .* is gone; clone the kit back there/m);
});

done();
