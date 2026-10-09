import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { ScoreDocument } from '../src/core/editor';
import { changedEvents } from '../src/core/model';
import { decodeSource } from '../src/core/xml';
import { orchestralFixture } from './fixtures';

const measured = <T>(fn: () => T) => { const start = performance.now(), value = fn(); return { value, milliseconds: Math.round(performance.now() - start) }; };
const inputs = [
  { name: 'Synthetic 20-part, 1,000-measure orchestral score', source: orchestralFixture(1000, 20) },
];
const local = new URL('../fixtures/local/rachmaninoff-variation18.musicxml', import.meta.url);
if (existsSync(local)) inputs.push({ name: 'Private Rachmaninoff variation 18 workspace copy', source: decodeSource(readFileSync(local)) });
const results = inputs.map(({ name, source }) => {
  const opened = measured(() => new ScoreDocument(source)); const document = opened.value, before = document.model;
  const target = [...before.notes.values()].find(n => n.pitch && !n.ties.length && !n.tiedNotation && Number.isInteger(n.pitch.alter) && Math.abs(n.pitch.alter) < 2)!;
  const edited = measured(() => document.setAccidental([target.id], target.pitch!.alter === 0 ? 1 : 0));
  const changed = changedEvents(before, document.model);
  const undo = measured(() => document.undo());
  if (changed.length !== 1 || changed[0] !== target.id || document.source !== source) throw new Error('Benchmark preservation check failed');
  return { name, sourceBytes: Buffer.byteLength(source), parts: before.parts.length, measures: before.measures, notes: before.notes.size, openMilliseconds: opened.milliseconds, editMilliseconds: edited.milliseconds, undoMilliseconds: undo.milliseconds, initialDiagnostics: before.diagnostics.length, independentChangedEvents: changed.length, exactUndo: true };
});
const report = { runDate: '2026-10-10', platform: `${process.platform} ${process.arch}`, node: process.version, note: 'Single local run, core engine only. Edits reparse and validate the full source in a worker; engraving is windowed. These are measurements, not performance guarantees.', results };
writeFileSync(new URL('../docs/benchmark-results.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
