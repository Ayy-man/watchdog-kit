/**
 * evals/lib/harness.mjs: the few lines every kit eval shares: an offline
 * guard (any fetch throws), a `check` runner that counts passes and
 * failures, a quiet console.error for expected noise, and the exit.
 */

import assert from 'node:assert/strict';

globalThis.fetch = async (url) => { throw new Error(`offline eval made a network call to ${url}`); };

let passed = 0;
let failed = 0;
// Kept before any eval can call quiet(): a failure is always printed, even
// from a file that silences console.error for expected noise (0.2.0; before,
// eval-self-check.mjs quietened the whole file and hid its own FAIL lines).
const realError = console.error;

export { assert };

export async function check(label, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`PASS: ${label}`);
  } catch (err) {
    failed += 1;
    realError(`FAIL: ${label}\n      ${String(err?.stack || err).split('\n').slice(0, 3).join(' | ')}`);
  }
}

export const quiet = () => { console.error = () => {}; };
export const loud = () => { console.error = realError; };

export function done() {
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

/** The scope the evals run under; nothing in it is a real client. */
export const SCOPE = { installation: 'kit-eval', tenant: null, environment: 'development' };
export const SCOPE_KEY = 'kit-eval/-/development';

/** A UTC instant on 18 Oct 2026 at h:m. */
export const T = (h, m = 0) => new Date(Date.UTC(2026, 9, 18, h, m));
