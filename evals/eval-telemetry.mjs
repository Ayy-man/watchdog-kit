#!/usr/bin/env node
/**
 * evals/eval-telemetry.mjs: the telemetry skill's text keeps the promises its
 * users rely on. Offline and read-only: it reads skills/telemetry and the
 * watchdog skills that consume .telemetry/, and nothing else.
 *
 *   node evals/eval-telemetry.mjs
 */

import { assert, check, done } from './lib/harness.mjs';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const kit = dirname(dirname(fileURLToPath(import.meta.url)));
const skill = join(kit, 'skills', 'telemetry');
const read = (...p) => readFileSync(join(...p), 'utf8');
function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(join(dir, d.name)) : [join(dir, d.name)]));
}
const texts = walk(skill).filter((f) => /\.(md|ya?ml)$/.test(f));
const SKILL = read(skill, 'SKILL.md');
const INSTALL = read(skill, 'references', 'install.md');

await check('every path SKILL.md names exists', () => {
  for (const p of ['references/install.md', 'references/thinking.md', 'references/panel-library.md', 'references/rules.md', 'references/design.md', 'templates/SERVICES.md', 'templates/SETUP.md', 'templates/PAGE-PLAN.md']) {
    assert.ok(existsSync(join(skill, p)), `${p} is missing`);
  }
  assert.ok(readdirSync(join(skill, 'references', 'examples')).filter((f) => f.endsWith('.md')).length >= 4, 'fewer than four worked plans');
});

await check('every image a skill file embeds exists', () => {
  for (const f of texts) {
    for (const [, src] of read(f).matchAll(/!\[[^\]]*\]\(([^)]+\.png)\)/g)) {
      assert.ok(existsSync(resolve(dirname(f), src)), `${f} embeds missing ${src}`);
    }
  }
});

await check('no real client, partner or person names in the shipped skill', () => {
  const banned = /\b(leeds|grimsby|hull|dunnrite|fearn|finley|ellen|wasim|hexona|hexos|vitalmeter|setterfi|nesthub)\b/i;
  for (const f of texts) {
    const hit = read(f).match(banned);
    assert.ok(!hit, `${f} names "${hit && hit[0]}"`);
  }
});

await check('the PostHog account is asked every build, never assumed', () => {
  assert.match(INSTALL, /Never assume whose PostHog/);
  for (const q of ['Whose account?', 'New project or an existing one?', 'Which region?', 'Which timezone?']) assert.ok(INSTALL.includes(q), `install.md lost "${q}"`);
  assert.ok(!/America\/New_York/.test(INSTALL), 'install.md hardcodes a timezone');
});

await check('the billing gate blocks and its wording is intact', () => {
  assert.ok(INSTALL.includes("> **Set a billing limit on every PostHog product you're paying for before this goes live.**"), 'billing quote changed');
  assert.match(INSTALL, /Do not mark the install done/);
  assert.match(SKILL, /Stop at the billing gate/);
});

await check('replay waits on masking and the owner, and masks personal data', () => {
  assert.match(INSTALL, /Replay stays off until all four steps are done/);
  for (const w of ['addresses', 'message threads', 'photos', 'PostHogMaskView', 'lawful basis']) assert.ok(INSTALL.includes(w), `replay section lost "${w}"`);
  assert.match(SKILL, /Turns on session replay before the masking is deployed/);
});

await check('the repo is never pushed to production and keys never leave .env', () => {
  assert.match(INSTALL, /never push to the deploy branch/);
  assert.match(SKILL, /pushes to a branch that deploys production/);
  assert.match(SKILL, /Reads `\.env` values, pastes keys into chat/);
});

await check('sign-offs belong to the account owner, not the developer', () => {
  assert.match(SKILL, /a developer recording their own approval is not an approval/);
  assert.match(SKILL, /`\.telemetry\/inbox\/` to the repo's `\.gitignore`/);
});

await check('every stack the README promises has a section', () => {
  for (const h of ['**Next.js 16.**', '**Vite or another single-page app.**', '**Capacitor or Ionic.**', '**Expo or React Native.**', '**Supabase or other Deno edge functions.**']) assert.ok(INSTALL.includes(h), `install.md lost ${h}`);
});

await check('the watchdog reads .telemetry/ where the skill says it does', () => {
  assert.match(read(kit, 'skills', 'watchdog-survey', 'SKILL.md'), /If the repo has `\.telemetry\/`/);
  assert.match(read(kit, 'skills', 'watchdog-explain', 'SKILL.md'), /\.telemetry\/PAGE-PLAN\.md/);
  assert.match(read(kit, 'skills', 'watchdog-page', 'SKILL.md'), /Health tab of the telemetry page/);
});

await check('no em dashes in the skill text', () => {
  for (const f of texts) assert.ok(!read(f).includes('—'), `${f} has an em dash`);
});

done();
