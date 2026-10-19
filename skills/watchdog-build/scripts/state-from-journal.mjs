#!/usr/bin/env node
/**
 * state-from-journal.mjs [repo root | --repo <root>]
 *
 * Regenerates .watchdog/STATE.md from .watchdog/journal.jsonl, creating
 * .watchdog/ if it is missing. STATE.md is a view and is never edited by hand:
 * the journal is the record, and each phase's status comes from the same
 * predicate validate-phase.mjs applies (journal-lib.mjs). journal-append.mjs
 * calls the same writer after every append, so running this by hand is only
 * needed after editing the journal or an artefact. Prints the orientation
 * line first. Plain node, no dependencies.
 */
import { PhaseError, kitRevWarning, parseRoot, readJournal, writeState } from './journal-lib.mjs';

let root;
let journal;
try {
  const parsed = parseRoot(process.argv.slice(2), 0);
  if (parsed.rest.length > 1) throw new PhaseError('usage: state-from-journal.mjs [repo root | --repo <root>]');
  root = parsed.root;
  journal = readJournal(root);
} catch (err) {
  if (err instanceof PhaseError) { console.error(`state-from-journal: ${err.message}`); process.exit(1); }
  throw err;
}
const warning = kitRevWarning(journal.meta);
if (warning) console.warn(`state-from-journal: ${warning}`);
const { firstOpen, orientation } = writeState(root, journal.entries, journal.meta);
const note = journal.exists ? `${journal.entries.length} journal entries` : 'no journal yet; create it with `journal-append.mjs init`';
// The orientation line comes first: it is what --status shows the human.
console.log(`${orientation}\nstate-from-journal: wrote .watchdog/STATE.md (${note}); current phase ${firstOpen ?? 'none, all done'}`);
