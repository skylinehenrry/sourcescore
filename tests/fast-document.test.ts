import {test,expect} from 'vitest';
import {FastDocument,midiPitch} from '../src/core/fast-document';
import {ScoreDocument} from '../src/core/editor';
import {parseScore,changedEvents} from '../src/core/model';
import {orchestralFixture} from '../scripts/fixtures';
test('semitone arrows always change written MIDI by one, including naturals and octave crossings',()=>{
  const doc=new FastDocument(orchestralFixture());
  for(let i=0;i<20;i++){const before=midiPitch(doc.note('0:0:0').pitch!);doc.semitone(['0:0:0'],1);expect(midiPitch(doc.note('0:0:0').pitch!)).toBe(before+1);}
  for(let i=0;i<20;i++){const before=midiPitch(doc.note('0:0:0').pitch!);doc.semitone(['0:0:0'],-1);expect(midiPitch(doc.note('0:0:0').pitch!)).toBe(before-1);}
});
test('local pitch patches produce exactly the established source-preserving result',()=>{
  const source=orchestralFixture(),fast=new FastDocument(source),reference=new ScoreDocument(source);
  fast.accidental(['0:0:0'],0);reference.setAccidental(['0:0:0'],0);expect(fast.source).toBe(reference.source);
  expect(changedEvents(parseScore(source),parseScore(fast.source))).toEqual(['0:0:0']);fast.undo();expect(fast.source).toBe(source);fast.redo();expect(fast.source).toBe(reference.source);
});
test('local pitch history remains exact across coordinated rhythm rebases',()=>{
  const source=orchestralFixture(),doc=new FastDocument(source);doc.accidental(['0:0:0'],0);const pitch=doc.source;
  doc.duration(doc.planDuration('0:0:0','eighth',0));const duration=doc.source;
  doc.undo();expect(doc.source).toBe(pitch);doc.undo();expect(doc.source).toBe(source);doc.redo();expect(doc.source).toBe(pitch);doc.redo();expect(doc.source).toBe(duration);doc.validateSave();
});
test('local rendering keeps every original note anchor and applies only current note overrides',()=>{
  const doc=new FastDocument(orchestralFixture(12));const before=doc.renderSlice(8,4);doc.accidental(['0:8:0'],0);const after=doc.renderSlice(8,4);
  expect(after.noteIds).toEqual(before.noteIds);expect(after.xml).toContain('<accidental>natural</accidental>');expect(changedEvents(parseScore(before.xml),parseScore(after.xml))).toHaveLength(1);
});
test('rapid edits on 122,250 events avoid a full-score model rebuild',()=>{
  const doc=new FastDocument(orchestralFixture(1000,20)),anchor=doc.model;
  const start=performance.now();for(let i=0;i<30;i++)doc.semitone(['0:999:0'],i%2? -1:1);
  const elapsed=performance.now()-start;expect(doc.model).toBe(anchor);expect(elapsed).toBeLessThan(500);doc.validateSave();
},30000);
