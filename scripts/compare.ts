import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { parseScore, changedEvents } from '../src/core/model';
import { decodeSource } from '../src/core/xml';
const [original, edited, ...expected] = process.argv.slice(2);
if (!original || !edited) { console.error('Usage: npm run compare -- original.musicxml edited.musicxml [expected-note-id ...]'); process.exit(2); }
const a = readFileSync(original), b = readFileSync(edited), before = parseScore(decodeSource(a)), after = parseScore(decodeSource(b));
const changes = changedEvents(before, after);
let prefix = 0; while (prefix < Math.min(a.length, b.length) && a[prefix] === b[prefix]) prefix++;
let suffix = 0; while (suffix < Math.min(a.length, b.length) - prefix && a[a.length - suffix - 1] === b[b.length - suffix - 1]) suffix++;
const removed = [...before.notes.keys()].filter(id => !after.notes.has(id));
const added = [...after.notes.keys()].filter(id => !before.notes.has(id));
console.log(JSON.stringify({ byteIdentical: a.equals(b), originalSHA256: createHash('sha256').update(a).digest('hex'), editedSHA256: createHash('sha256').update(b).digest('hex'), untouchedPrefixBytes: prefix, untouchedSuffixBytes: suffix, changedEvents: changes, removedEvents: removed, addedEvents: added, originalDiagnostics: before.diagnostics.length, editedDiagnostics: after.diagnostics.length }, null, 2));
if (expected.length && (changes.some(id => !expected.includes(id)) || expected.some(id => !changes.includes(id)) || removed.length || added.length)) process.exitCode = 1;
