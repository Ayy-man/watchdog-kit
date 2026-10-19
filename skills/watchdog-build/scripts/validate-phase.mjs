#!/usr/bin/env node
/**
 * validate-phase.mjs <phase> [repo root | --repo <root>]
 *
 * Reads .watchdog/journal.jsonl, takes the last entry for the phase and applies
 * the shared "phase done" predicate in journal-lib.mjs: ISO timestamps, not
 * blocked, every required artefact recorded, every recorded artefact reads
 * back from disk with its recorded sha256, the inputs and decisions read at
 * "started" unchanged, every catalogue decision of the phase approved or
 * answered by a human, and the content checks (sections present and
 * non-empty, no template placeholders left, the contract's doors table, the
 * incident rows, the holdout, the gates). Prints every failure with its
 * remedy and exits 1 once. A journal line that is not JSON stops it at once
 * with the line number. Plain node, no dependencies.
 */
import { PhaseError, REQUIRED, currentEntry, journalPath, kitRevWarning, parseRoot, phaseStatus, readJournal } from './journal-lib.mjs';

const fail = (msg) => { console.error(`validate-phase: ${msg}`); process.exit(1); };
const USAGE = 'usage: validate-phase.mjs <phase 0-8> [repo root | --repo <root>]';
let parsed;
try { parsed = parseRoot(process.argv.slice(2), 1); } catch (err) { fail(`${err.message}\n${USAGE}`); }
const { root, rest } = parsed;
const phase = Number(rest[0]);
if (rest[0] === undefined || rest.length > 2 || !Number.isInteger(phase) || !(phase in REQUIRED)) fail(USAGE);

let journal;
try { journal = readJournal(root); } catch (err) { if (err instanceof PhaseError) fail(err.message); throw err; }
if (!journal.exists) fail(`no journal at ${journalPath(root)}; on a first run, create it with \`journal-append.mjs init\`, then run phase 0`);
const warning = kitRevWarning(journal.meta);
if (warning) console.warn(`validate-phase: ${warning}`);

const entry = currentEntry(journal.entries, phase);
const s = phaseStatus(root, phase, entry, journal.entries);
if (!s.done) {
  const n = s.problems.length;
  fail(`phase ${phase} is ${s.status}, ${n} problem${n === 1 ? '' : 's'}:\n${s.problems.map((p) => `- ${p.msg}\n  fix: ${p.fix}`).join('\n')}`);
}
console.log(`validate-phase: phase ${phase} ok (${entry.artefacts.length} artefacts verified, journal line ${entry._line})`);
