import {test,expect} from 'vitest';
import {FastDocument} from '../src/core/fast-document';
import {orchestralFixture} from '../scripts/fixtures';
import {captureIdentities} from '../src/core/identity';
import {normalizedEvents,parseScore} from '../src/core/model';
import {copyNotes,pasteNotes} from '../src/core/clipboard';
import {newScore} from '../src/core/new-score';
const pitch={step:'C' as const,alter:0,octave:5};
test('note entry splits a rest exactly and leaves later note identities and unrelated source intact',()=>{
  const source=orchestralFixture(2),doc=new FastDocument(source),later=doc.note('0:0:2');
  const old=source.slice(later.node.start,later.node.end);doc.structure(e=>e.input('0:0:1',pitch,'eighth'));
  expect(doc.note('0:0:1').pitch).toEqual(pitch);expect(Number(doc.note('0:0:1').duration)).toBe(0.5);
  expect(doc.note('0:0:2').index).toBe(later.index+1);expect(doc.source.slice(doc.note('0:0:2').node.start,doc.note('0:0:2').node.end)).toBe(old);
  doc.validateSave();const ids=captureIdentities(doc.model),edited=doc.source;doc.undo();expect(doc.source).toBe(source);doc.redo();expect(doc.source).toBe(edited);expect(captureIdentities(doc.model)).toEqual(ids);
});
test('deleting a sounding event inserts a rest without moving any other event',()=>{
  const source=orchestralFixture(),doc=new FastDocument(source),before=normalizedEvents(doc.model);
  doc.structure(e=>e.delete(['0:0:0']));expect(doc.note('0:0:0').rest).toBe(true);
  expect(normalizedEvents(doc.model).filter(n=>n.id!=='0:0:0')).toEqual(before.filter(n=>n.id!=='0:0:0'));doc.validateSave();doc.undo();expect(doc.source).toBe(source);
});
test('chord insertion and root deletion preserve the remaining chord pitches and timeline',()=>{
  const doc=new FastDocument(orchestralFixture()),source=doc.source;
  doc.structure(e=>e.input('3:0:0',pitch,'quarter',0,true));const added=doc.selectionAfter[0];expect(doc.note(added).chord).toBe(true);
  doc.structure(e=>e.delete(['3:0:0']));expect(doc.note('3:0:1').chord).toBe(false);expect(doc.note(added).chord).toBe(true);doc.validateSave();
  doc.undo();doc.undo();expect(doc.source).toBe(source);
});
test('grace input/delete never changes the sounding onset of following notes',()=>{
  const doc=new FastDocument(orchestralFixture()),source=doc.source,before=normalizedEvents(doc.model);
  doc.structure(e=>e.input('0:0:0',pitch,'eighth',0,false,true));const id=doc.selectionAfter[0];expect(doc.note(id).grace).toBe(true);
  expect(normalizedEvents(doc.model).filter(n=>n.id!==id)).toEqual(before);doc.structure(e=>e.delete([id]));expect(doc.source).toBe(source);
});
test('pitch edits remain attached to the right notes through structural undo/redo',()=>{
  const doc=new FastDocument(orchestralFixture()),source=doc.source;
  doc.structure(e=>e.input('0:0:1',pitch,'eighth'));const inserted=doc.source;
  doc.semitone(['0:0:2'],1);const corrected=doc.source;expect(doc.note('0:0:2').pitch?.alter).toBe(1);
  doc.undo();expect(doc.source).toBe(inserted);doc.undo();expect(doc.source).toBe(source);doc.redo();doc.redo();expect(doc.source).toBe(corrected);doc.validateSave();
});
test('new note source is correct in prefixed MusicXML without adding source IDs',()=>{
  const source=orchestralFixture(1,1).replace(/<(\/?)([\w-]+)(?=[\s/>])/g,'<$1m:$2').replace('<m:score-partwise','<m:score-partwise xmlns:m="urn:score"');
  const doc=new FastDocument(source);doc.structure(e=>e.input('0:0:1',pitch,'eighth'));expect(doc.source).toContain('<m:pitch>');expect(doc.source).not.toContain('note:');doc.validateSave();doc.undo();expect(doc.source).toBe(source);
});
test('copy/paste into a rest keeps original note metadata and exact destination timing',()=>{
  const doc=new FastDocument(newScore('Copy test',['Piano'],2));doc.structure(e=>e.input('0:0:0',pitch,'quarter'));const source=doc.source;
  const clip=copyNotes(doc.model,['0:0:0']);doc.structure(e=>pasteNotes(e.model,'0:1:0',clip));expect(doc.note('0:1:0').pitch).toEqual(pitch);doc.validateSave();doc.undo();expect(doc.source).toBe(source);
});
test('deleting a bar preserves later note identities and inherited meter/clefs',()=>{
  const doc=new FastDocument(orchestralFixture()),source=doc.source;doc.structure(e=>e.deleteBar(0));expect(doc.model.measures).toBe(11);expect(doc.note('0:1:0').measureIndex).toBe(0);doc.validateSave();doc.undo();expect(doc.source).toBe(source);
});
test('duration changes create and consume rests without changing other voices',()=>{
  const doc=new FastDocument(orchestralFixture()),source=doc.source;
  doc.structure(e=>e.resize('3:0:0','eighth',0));expect(Number(doc.note('3:0:0').duration)).toBe(0.5);expect(Number(doc.note('3:0:1').duration)).toBe(0.5);
  expect(Number(doc.note('3:0:7').duration)).toBe(1);doc.validateSave();doc.undo();expect(doc.source).toBe(source);
  doc.structure(e=>e.resize('0:0:0','half',0));expect(Number(doc.note('0:0:0').duration)).toBe(2);expect(doc.model.notes.has('0:0:1')).toBe(false);doc.validateSave();doc.undo();expect(doc.source).toBe(source);
});

test('inserting the first bar and a bar at a meter/divisions change inherits the correct context',()=>{
  let source=newScore('Meters',['Piano'],2);
  source=source.replace('<measure number="2">','<measure number="2"><attributes><divisions>240</divisions><time><beats>3</beats><beat-type>4</beat-type></time></attributes>');
  const at=source.indexOf('<measure number="2">');source=source.slice(0,at)+source.slice(at).replaceAll('<duration>1920</duration>','<duration>720</duration>');
  const doc=new FastDocument(source);doc.structure(e=>e.insertBar(0));
  expect(Number(doc.model.parts[0].measures[0].notes[0].duration)).toBe(4);expect(doc.note('0:0:0').measureIndex).toBe(1);doc.validateSave();doc.undo();expect(doc.source).toBe(source);
  doc.structure(e=>e.insertBar(1));expect(Number(doc.model.parts[0].measures[1].notes[0].duration)).toBe(3);expect(Number(doc.model.parts[0].measures[1].notes[0].divisions)).toBe(240);doc.validateSave();doc.undo();expect(doc.source).toBe(source);
});

const tieChain=()=>`<score-partwise><part-list><score-part id="P"><part-name>Violin</part-name></score-part></part-list><part id="P">${Array.from({length:4},(_,i)=>`<measure number="${i+1}">${i===0?'<attributes><divisions>480</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>':''}<note><pitch><step>C</step><octave>4</octave></pitch><duration>1920</duration>${i>0?'<tie type="stop"/>':''}${i<3?'<tie type="start"/>':''}<voice>1</voice><type>whole</type><notations><tied type="${i===0?'start':i===3?'stop':'continue'}" number="2"/></notations></note></measure>`).join('')}</part></score-partwise>`;
test('deleting a tied segment repairs continuation markers and preserves the remaining tie chain',()=>{
  const source=tieChain(),doc=new FastDocument(source);doc.structure(e=>e.delete(['0:1:0']));
  expect(doc.note('0:0:0').ties).toEqual([]);expect(doc.note('0:2:0').ties).toEqual(['start']);
  const remaining=doc.source.slice(doc.note('0:2:0').node.start,doc.note('0:2:0').node.end);expect(remaining).toContain('<tied type="start" number="2"/>');
  doc.semitone(['0:2:0'],1);expect(doc.note('0:3:0').pitch).toEqual(doc.note('0:2:0').pitch);expect(doc.note('0:0:0').pitch?.alter).toBe(0);doc.validateSave();doc.undo();doc.undo();expect(doc.source).toBe(source);
});

test('clipboard retains extension namespaces and rejects incompatible musical namespaces atomically',()=>{
  const original=newScore('Extensions',['Flute'],2).replace('<score-partwise version="4.0">','<score-partwise version="4.0" xmlns:x="urn:private">').replace('<note>','<note custom="owned"><x:detail x:flag="keep">private</x:detail>');
  const doc=new FastDocument(original);doc.structure(e=>e.input('0:0:0',pitch,'quarter'));const clip=copyNotes(doc.model,['0:0:0']);doc.structure(e=>pasteNotes(e.model,'0:1:0',clip));
  const pasted=doc.source.slice(doc.note('0:1:0').node.start,doc.note('0:1:0').node.end);expect(pasted).toContain('xmlns:x="urn:private"');expect(pasted).toContain('<x:detail x:flag="keep">private</x:detail>');doc.validateSave();
  const incompatible=new FastDocument(newScore('Target',['Flute'],2).replace('<score-partwise version="4.0">','<score-partwise version="4.0" xmlns="urn:other">'));const before=incompatible.source;
  expect(()=>incompatible.structure(e=>pasteNotes(e.model,'0:0:0',clip))).toThrow(/namespace/);expect(incompatible.source).toBe(before);
});

test('entering and deleting accidentals repairs later notes without changing their absolute pitches',()=>{
  const source=newScore('Accidentals',['Flute'],1),doc=new FastDocument(source);
  doc.structure(e=>e.input('0:0:0',{step:'F',alter:1,octave:4},'quarter'));let cursor=doc.selectionAfter[0];
  const rest=doc.notes(0,1).find(n=>n.rest)!;doc.structure(e=>e.input(rest.id,{step:'F',alter:0,octave:4},'quarter'));const following=doc.selectionAfter[0];
  expect(doc.note(cursor).accidental).toBe('sharp');expect(doc.note(following).accidental).toBe('natural');
  doc.structure(e=>e.delete([cursor]));expect(doc.note(following).pitch).toEqual({step:'F',alter:0,octave:4});expect(doc.note(following).accidental).toBe('');doc.validateSave();
});

test('pitch movement restores the necessary sharp on a later unchanged note in the bar',()=>{
  const doc=new FastDocument(newScore('Restoration',['Flute'],1));doc.structure(e=>e.input('0:0:0',{step:'F',alter:1,octave:4},'quarter'));
  const rest=doc.notes(0,1).find(n=>n.rest)!;doc.structure(e=>e.input(rest.id,{step:'F',alter:1,octave:4},'quarter'));const next=doc.selectionAfter[0],before=doc.source;
  expect(doc.note(next).accidental).toBe('');doc.semitone(['0:0:0'],-1);expect(doc.note(next).pitch?.alter).toBe(1);expect(doc.note(next).accidental).toBe('sharp');doc.validateSave();doc.undo();expect(doc.source).toBe(before);
});

test('new chord selection survives an accidental inserted on its existing root',()=>{
  const doc=new FastDocument(newScore('Chord accidentals',['Flute'],1));doc.structure(e=>e.input('0:0:0',{step:'F',alter:0,octave:4},'quarter'));
  doc.structure(e=>e.input('0:0:0',{step:'F',alter:1,octave:4},'quarter',0,true));const selected=doc.selectionAfter[0];expect(doc.note(selected).chord).toBe(true);expect(doc.note(selected).pitch?.alter).toBe(1);expect(doc.note('0:0:0').accidental).toBe('natural');doc.validateSave();
});

test('clipboard rejects omitted musical gaps and removes a copied MusicXML unique ID',()=>{
  const doc=new FastDocument(newScore('Copy identities',['Flute'],3));doc.structure(e=>e.input('0:0:0',pitch,'quarter'));
  expect(()=>copyNotes(doc.model,['0:0:0','0:2:0'])).toThrow(/continuous/);
  const source=doc.source.replace('<note>','<note id="original-note">'),withId=new FastDocument(source),clip=copyNotes(withId.model,['0:0:0']);withId.structure(e=>pasteNotes(e.model,'0:1:0',clip));expect((withId.source.match(/id="original-note"/g)??[]).length).toBe(1);withId.validateSave();
});

test('rest entry replaces a chord at the chosen value and fills remaining time in one undo',()=>{
  const doc=new FastDocument(orchestralFixture()),source=doc.source;
  doc.structure(e=>e.input('3:0:1',undefined,'eighth'));expect(doc.note('3:0:0').rest).toBe(true);expect(Number(doc.note('3:0:0').duration)).toBe(0.5);expect(doc.model.notes.has('3:0:1')).toBe(false);expect(doc.model.notes.has('3:0:2')).toBe(false);doc.validateSave();doc.undo();expect(doc.source).toBe(source);
});
