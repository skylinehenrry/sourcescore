import { test, expect } from 'vitest';
import { FastDocument, midiPitch } from '../src/core/fast-document';
import { parseScore, changedEvents } from '../src/core/model';

const n = (step='F', alter=1, extras='', staff=1, voice='1', duration=4) => `<note><pitch><step>${step}</step><alter>${alter}</alter><octave>4</octave></pitch><duration>${duration}</duration>${extras}<voice>${voice}</voice><type>${duration===4?'whole':'quarter'}</type><staff>${staff}</staff></note>`;
const notation = (type:string) => `<notations><tied type="${type}" number="1" bezier-x="9"/><other-notation type="single">retain</other-notation></notations>`;
const tie = (type:string, step='F', alter=1, staff=1) => n(step,alter,`<tie type="${type}"/>`,staff).replace('</note>',notation(type)+'</note>');
function score(bars:string[], fifths=1) {
  return `<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Violin</part-name></score-part></part-list><part id="P1">${bars.map((bar,i)=>`<measure number="${i+1}">${i===0?`<attributes><divisions>1</divisions><key><fifths>${fifths}</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time></attributes>`:''}${bar}</measure>`).join('')}</part></score-partwise>`;
}
const noteXml = (doc:FastDocument,id:string) => {const note=parseScore(doc.source).notes.get(id)!;return doc.source.slice(note.node.start,note.node.end);};

test('automatic glyphs omit key-signature sharps and ordinary naturals while retaining pitch alteration',()=>{
  const doc=new FastDocument(score([n()]));
  doc.semitone(['0:0:0'],1);expect(noteXml(doc,'0:0:0')).not.toContain('<accidental>');expect(doc.note('0:0:0').pitch).toEqual({step:'G',alter:0,octave:4});
  doc.semitone(['0:0:0'],-1);expect(noteXml(doc,'0:0:0')).not.toContain('<accidental>');expect(noteXml(doc,'0:0:0')).toContain('<alter>1</alter>');
  doc.semitone(['0:0:0'],-1);expect(noteXml(doc,'0:0:0')).toContain('<accidental>natural</accidental>');
});
test('earlier alterations in the same staff/bar require cancellation, including other voices',()=>{
  const source=score([n('G',1,'',1,'1',1)+'<backup><duration>1</duration></backup>'+n('A',0,'',1,'2',1)+n('A',0,'',1,'2',1)+n('B',0,'',1,'2',1)+n('C',0,'',1,'2',1)],0);
  const doc=new FastDocument(source);doc.editPitches(new Map([['0:0:2',{step:'G',alter:0,octave:4}]]));
  expect(noteXml(doc,'0:0:2')).toContain('<accidental>natural</accidental>');
});
test('measure boundaries and mid-measure key changes reset accidental state',()=>{
  const doc=new FastDocument(score([n('G',1),n('A',0)],0));
  doc.editPitches(new Map([['0:1:0',{step:'G',alter:0,octave:4}]]));expect(noteXml(doc,'0:1:0')).not.toContain('<accidental>');
  const inside=new FastDocument(score([n('F',0,'',1,'1',1)+'<attributes><key><fifths>0</fifths></key></attributes>'+n('G',0,'',1,'1',3)]));
  inside.editPitches(new Map([['0:0:1',{step:'F',alter:0,octave:4}]]));expect(noteXml(inside,'0:0:1')).not.toContain('<accidental>');
});
test('a natural earlier in a bar makes the key-signature sharp necessary again',()=>{
  const doc=new FastDocument(score([n('F',1,'',1,'1',1)+n('G',0,'',1,'1',3)]));
  doc.accidental(['0:0:0'],0);
  doc.editPitches(new Map([['0:0:1',{step:'F',alter:1,octave:4}]]));
  expect(noteXml(doc,'0:0:1')).toContain('<accidental>sharp</accidental>');
});
test('flat keys omit their supplied flat but show a cancellation natural',()=>{
  const doc=new FastDocument(score([n('A',0)],-1));
  doc.semitone(['0:0:0'],1);expect(doc.note('0:0:0').pitch).toEqual({step:'B',alter:-1,octave:4});expect(noteXml(doc,'0:0:0')).not.toContain('<accidental>');
  doc.semitone(['0:0:0'],1);expect(noteXml(doc,'0:0:0')).toContain('<accidental>natural</accidental>');
});
test('key context follows musical time through backups and an all-staff change resets staff-specific keys',()=>{
  const source=score([n('C',0,'',1,'1',1)+'<attributes><key><fifths>1</fifths></key></attributes>'+n('C',0,'',1,'1',3)+'<backup><duration>4</duration></backup>'+n('G',0,'',1,'2',1)+n('G',0,'',1,'2',3)],0);
  const doc=new FastDocument(source);expect(doc.note('0:0:2').keyFifths).toBe(0);expect(doc.note('0:0:3').keyFifths).toBe(1);
  doc.editPitches(new Map([['0:0:2',{step:'F',alter:0,octave:4}]]));expect(noteXml(doc,'0:0:2')).not.toContain('<accidental>');
  doc.editPitches(new Map([['0:0:3',{step:'F',alter:0,octave:4}]]));expect(noteXml(doc,'0:0:3')).toContain('<accidental>natural</accidental>');
  const staffSource=score(['<attributes><key number="2"><fifths>-1</fifths></key></attributes>'+n('B',-1,'',2),'<attributes><key><fifths>1</fifths></key></attributes>'+n('G',0,'',2)]);
  const staffDoc=new FastDocument(staffSource);expect(staffDoc.note('0:1:0').keyFifths).toBe(1);
});
test('intentional courtesy flags and unrelated notation survive pitch editing',()=>{
  const source=score([n().replace('</type>','</type><accidental cautionary="yes" parentheses="yes">sharp</accidental>')]);
  const doc=new FastDocument(source);doc.semitone(['0:0:0'],1);
  expect(doc.source).toContain('<accidental cautionary="yes" parentheses="yes">natural</accidental>');doc.undo();expect(doc.source).toBe(source);
});
test('edit a middle tied note atomically updates its complete chain across pages and preserves all tie metadata',()=>{
  const source=score([tie('start'),n('F',1,'<tie type="stop"/><tie type="start"/>').replace('</note>',notation('stop').replace('</notations>','<tied type="start" number="1"/></notations>')+'</note>'),tie('stop'),n('C',0)]);
  const doc=new FastDocument(source);doc.semitone(['0:1:0'],1);
  expect(doc.lastChangedIds.sort()).toEqual(['0:0:0','0:1:0','0:2:0']);
  for(const id of doc.lastChangedIds) expect(doc.note(id).pitch).toEqual({step:'G',alter:0,octave:4});
  expect(changedEvents(parseScore(source),parseScore(doc.source)).sort()).toEqual(['0:0:0','0:1:0','0:2:0']);
  expect((doc.source.match(/bezier-x="9"/g)??[]).length).toBe(3);expect(noteXml(doc,'0:3:0')).toBe(noteXml(new FastDocument(source),'0:3:0'));
  doc.validateSave();const edited=doc.source;doc.undo();expect(doc.source).toBe(source);doc.redo();expect(doc.source).toBe(edited);
});
test('cross-staff ties use voice and exact musical time, including different enharmonic spellings',()=>{
  const source=score([tie('start','F',1,1),tie('stop','G',-1,2)]);
  const doc=new FastDocument(source);doc.semitone(['0:1:0'],1);
  expect(doc.note('0:0:0').pitch).toEqual(doc.note('0:1:0').pitch);expect(midiPitch(doc.note('0:0:0').pitch!)).toBe(67);doc.validateSave();
});
test('unmatched and conflicting tie edits fail without partial changes',()=>{
  const source=score([tie('start'),tie('stop')]),doc=new FastDocument(source);
  expect(()=>doc.editPitches(new Map([['0:0:0',{step:'G',alter:0,octave:4}],['0:1:0',{step:'F',alter:0,octave:4}]]))).toThrow(/conflicting/);expect(doc.source).toBe(source);
  const orphan=score([tie('stop')]),other=new FastDocument(orphan);expect(()=>other.semitone(['0:0:0'],1)).toThrow(/endpoint/);expect(other.source).toBe(orphan);
});
test('notated tie continuations are coordinated even when sounding tie fields are omitted',()=>{
  const source=score([tie('start').replace('<tie type="start"/>',''),n().replace('</note>',notation('continue')+'</note>'),tie('stop').replace('<tie type="stop"/>','')]);
  const doc=new FastDocument(source);doc.semitone(['0:1:0'],1);
  expect(doc.lastChangedIds).toHaveLength(3);expect(doc.source).toContain('type="continue"');doc.undo();expect(doc.source).toBe(source);
});
test('ordinary tablature pitch and fret move together on the existing string, with exact undo',()=>{
  const source=score([n().replace('</note>','<notations><technical><string>1</string><fret>2</fret><fingering>1</fingering></technical></notations></note>')]);
  const doc=new FastDocument(source);doc.semitone(['0:0:0'],1);expect(doc.source).toContain('<fret>3</fret>');expect(doc.source).toContain('<string>1</string>');expect(doc.source).toContain('<fingering>1</fingering>');doc.undo();expect(doc.source).toBe(source);
  const open=new FastDocument(source.replace('<fret>2</fret>','<fret>0</fret>'));expect(()=>open.semitone(['0:0:0'],-1)).toThrow(/open string/);expect(open.source).toBe(source.replace('<fret>2</fret>','<fret>0</fret>'));
});
