import {test,expect} from 'vitest';
import {FastDocument} from '../src/core/fast-document';
import {NotationEditor} from '../src/core/notation';
import {orchestralFixture} from '../scripts/fixtures';
import {newScore} from '../src/core/new-score';
import {child,children} from '../src/core/xml';

test('new piano score has both staves and supports dotted note input into full-measure rests',()=>{
  const doc=new FastDocument(newScore('Composition',['Piano','Flute'],4));
  expect(doc.model.parts[0].staves).toBe(2);doc.structure(e=>e.input('0:0:0',{step:'C',alter:0,octave:4},'quarter',1));
  const n=doc.note('0:0:0');expect(n.dots).toBe(1);expect(doc.source.indexOf('<dot/>')).toBeLessThan(doc.source.indexOf('<staff>'));doc.validateSave();
});
test('dynamics, articulation, text and lyrics are added, edited and deleted without touching other source',()=>{
  const doc=new FastDocument(orchestralFixture()),source=doc.source;
  for(const [kind,symbol,text] of [['dynamic','ff',''],['articulation','staccato',''],['text','','dolce & calm'],['lyric','','Hello']])doc.structure(e=>new NotationEditor(e.model).marking('0:0:0',kind,symbol,text));
  let items=new NotationEditor(doc.model).items('P1',0);expect(items.some(i=>i.kind==='staccato')).toBe(true);expect(doc.source).toContain('dolce &amp; calm');
  const dynamic=items.find(i=>i.kind==='dynamics'&&i.label.includes('ff'))!;doc.structure(e=>new NotationEditor(e.model).property(dynamic.id,'symbol','mp'));expect(doc.source).toContain('<mp/>');
  const words=new NotationEditor(doc.model).items('P1',0).find(i=>i.kind==='words')!;doc.structure(e=>new NotationEditor(e.model).deleteItem(words.id));expect(doc.source).not.toContain('dolce &amp; calm');doc.validateSave();for(let i=0;i<6;i++)doc.undo();expect(doc.source).toBe(source);
});
test('slur and hairpin endpoints remain correctly anchored across source edits',()=>{
  const doc=new FastDocument(orchestralFixture());doc.structure(e=>new NotationEditor(e.model).span(['0:0:0','0:0:3'],'slur'));doc.structure(e=>new NotationEditor(e.model).span(['0:0:0','0:0:3'],'crescendo'));
  expect(doc.source).toContain('<slur type="start"');expect(doc.source).toContain('<slur type="stop"');expect(doc.source).toContain('<wedge type="crescendo"');expect(doc.source).toContain('<wedge type="stop"');doc.validateSave();
});
test('clef and key edits retain unknown notation and exact undo',()=>{
  const doc=new FastDocument(orchestralFixture()),source=doc.source;
  doc.structure(e=>new NotationEditor(e.model).signature('P1',0,1,'clef',{sign:'C',line:'3'}));
  doc.structure(e=>new NotationEditor(e.model).signature('P1',0,1,'key',{fifths:'-2',mode:'minor'}));expect(doc.source).toContain('<fifths>-2</fifths>');doc.validateSave();doc.undo();doc.undo();expect(doc.source).toBe(source);
});
test('temporary meter errors block saving until repaired',()=>{
  const doc=new FastDocument(orchestralFixture()),source=doc.source;
  doc.structure(e=>new NotationEditor(e.model).signature('P1',0,1,'time',{beats:'3',unit:'4'}));expect(()=>doc.validateSave()).toThrow(/Saving blocked/);doc.undo();expect(doc.source).toBe(source);doc.validateSave();
});
test('new voice and inserted bars preserve original note IDs, other voices and exact history',()=>{
  const doc=new FastDocument(orchestralFixture()),source=doc.source;
  doc.structure(e=>e.createVoice('P1',0,1,'2'));expect(doc.note(doc.selectionAfter[0]).voice).toBe('2');doc.validateSave();
  doc.structure(e=>e.insertBar(1));expect(doc.model.measures).toBe(13);expect(doc.note('0:1:0').measureIndex).toBe(2);doc.validateSave();doc.undo();doc.undo();expect(doc.source).toBe(source);
});
test('triplet creation produces exact ticks and allows pitched entry without damaging tuplet markers',()=>{
  const doc=new FastDocument(orchestralFixture()),source=doc.source;
  doc.structure(e=>e.tuplet('0:0:1',3,2));const first=doc.selectionAfter[0];expect(doc.note(first).ratio).toEqual({actual:3,normal:2});
  doc.structure(e=>e.input(first,{step:'C',alter:0,octave:5},'eighth'));expect(doc.note(first).ratio).toEqual({actual:3,normal:2});expect(doc.source).toContain('<tuplet type="start"');doc.validateSave();doc.undo();doc.undo();expect(doc.source).toBe(source);
});
test('a staff-specific key change leaves the other piano staff key intact',()=>{
  const doc=new FastDocument(orchestralFixture());doc.structure(e=>new NotationEditor(e.model).signature('P4',0,1,'key',{fifths:'-2',mode:'major'}));
  expect(doc.note('3:0:0').keyFifths).toBe(-2);expect(doc.note('3:0:7').keyFifths).toBe(1);doc.validateSave();
});
test('deleting a slur endpoint deletes its partner and preserves other slurs',()=>{
  const doc=new FastDocument(orchestralFixture());doc.structure(e=>new NotationEditor(e.model).span(['0:0:0','0:0:3'],'slur'));doc.structure(e=>new NotationEditor(e.model).span(['0:1:0','0:1:3'],'slur'));
  const item=new NotationEditor(doc.model).items('P1',0).find(i=>i.kind==='slur')!;doc.structure(e=>new NotationEditor(e.model).deleteItem(item.id));
  expect((doc.source.match(/<slur /g)??[]).length).toBe(2);doc.validateSave();
});

test('tuplet creation preserves the original rest attributes, extensions and attached fermata',()=>{
  const source=orchestralFixture(1,1).replace('<score-partwise','<score-partwise xmlns:x="urn:private"').replace('<note><rest/>','<note print-object="yes"><rest/><x:detail>retained</x:detail><notations><fermata>normal</fermata></notations>');
  const doc=new FastDocument(source);doc.structure(e=>e.tuplet('0:0:1',3,2));
  const n=doc.note('0:0:1'),xml=doc.source.slice(n.node.start,n.node.end);expect(xml).toContain('<x:detail>retained</x:detail>');expect(xml).toContain('<fermata>normal</fermata>');expect(xml).toContain('print-object="yes"');expect(children(n.node,'notations')).toHaveLength(1);doc.validateSave();doc.undo();expect(doc.source).toBe(source);
});
test('barline changes reuse their location and preserve endings, repeat count and extensions',()=>{
  const source=newScore('Endings',['Flute'],2).replace('</measure>','<barline location="right" xmlns:x="urn:private"><bar-style>light-heavy</bar-style><!-- keep --><ending number="1" type="stop"/><x:detail>retained</x:detail><repeat direction="backward" times="3"/></barline></measure>');
  const doc=new FastDocument(source);doc.structure(e=>new NotationEditor(e.model).signature('P1',0,1,'barline',{style:'light-light',repeat:'backward'}));
  const m=doc.model.parts[0].measures[0];expect(children(m.node,'barline')).toHaveLength(1);expect(doc.source).toContain('<ending number="1" type="stop"/>');expect(doc.source).toContain('<x:detail>retained</x:detail>');expect(doc.source).toContain('times="3"');
  doc.structure(e=>new NotationEditor(e.model).signature('P1',0,1,'barline',{style:'regular',repeat:''}));expect(doc.source).not.toContain('<repeat ');doc.validateSave();doc.undo();doc.undo();expect(doc.source).toBe(source);
});
test('multiple hairpins use distinct numbers and deleting the stop removes the correct start',()=>{
  const doc=new FastDocument(orchestralFixture());doc.structure(e=>new NotationEditor(e.model).span(['0:0:0','0:0:3'],'crescendo'));doc.structure(e=>new NotationEditor(e.model).span(['0:1:0','0:1:3'],'diminuendo'));
  expect(doc.source).toContain('<wedge type="diminuendo" number="2"/>');
  const stop=new NotationEditor(doc.model).items('P1',0).find(i=>i.kind==='wedge'&&i.fields.some(f=>f.key==='@type'&&f.value==='stop'))!;
  doc.structure(e=>new NotationEditor(e.model).deleteItem(stop.id));expect((doc.source.match(/<wedge /g)??[]).length).toBe(2);expect(doc.source).not.toContain('<wedge type="crescendo"');doc.validateSave();
});
test('clef and key changes retain their display attributes and unknown children',()=>{
  const source=newScore('Fields',['Flute'],2).replace('<clef number="1">','<clef number="1" print-object="no" xmlns:x="urn:private"><x:detail>keep</x:detail>').replace('<key>','<key print-object="no">');
  const doc=new FastDocument(source);doc.structure(e=>new NotationEditor(e.model).signature('P1',0,1,'clef',{sign:'C',line:'3'}));doc.structure(e=>new NotationEditor(e.model).signature('P1',0,1,'key',{fifths:'-2',mode:'minor'}));
  expect(doc.source).toContain('print-object="no"');expect(doc.source).toContain('<x:detail>keep</x:detail>');doc.validateSave();doc.undo();doc.undo();expect(doc.source).toBe(source);
});

test('notation properties group scalar fields, keep repeated beat groups distinct and route pitches through Notes',()=>{
  const source=newScore('Groups',['Flute'],1).replace('<beats>4</beats><beat-type>4</beat-type>','<beats>2</beats><beat-type>4</beat-type><beats>4</beats><beat-type>8</beat-type>');
  const doc=new FastDocument(source);doc.structure(e=>e.input('0:0:0',{step:'C',alter:0,octave:4},'quarter'));
  const items=new NotationEditor(doc.model).items('P1',0),time=items.find(i=>i.kind==='time')!;
  expect(items.some(i=>['step','octave','fifths','beats','sign'].includes(i.kind))).toBe(false);expect(time.fields.filter(f=>f.key.startsWith('beats:')).map(f=>f.value)).toEqual(['2','4']);expect(new Set(time.fields.map(f=>f.key)).size).toBe(time.fields.length);
  doc.structure(e=>new NotationEditor(e.model).property(time.id,'beats:1','2'));expect(doc.source).toContain('<beats>2</beats><beat-type>8</beat-type>');expect(()=>doc.validateSave()).toThrow();doc.undo();doc.validateSave();
});

test('deleting a newly added direction removes its wrapper instead of leaving invalid empty direction types',()=>{
  const doc=new FastDocument(newScore('Directions',['Flute'],2)),source=doc.source;
  doc.structure(e=>new NotationEditor(e.model).marking('0:0:0','dynamic','ff'));
  const item=new NotationEditor(doc.model).items('P1',0).find(i=>i.kind==='dynamics')!;doc.structure(e=>new NotationEditor(e.model).deleteItem(item.id));expect(doc.source).toBe(source);doc.validateSave();
});

test('editing displayed dynamics and tempo updates their linked playback fields and preserves unrelated sound settings',()=>{
  const source=newScore('Performance',['Flute'],2).replace('<note>','<direction><direction-type><dynamics><mf/></dynamics></direction-type><sound dynamics="90" tempo="100"/></direction><direction><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>100</per-minute></metronome></direction-type><sound tempo="100"/></direction><note>');
  const doc=new FastDocument(source),items=new NotationEditor(doc.model).items('P1',0),dynamic=items.find(i=>i.kind==='dynamics')!,tempo=items.find(i=>i.kind==='metronome')!;
  doc.structure(e=>new NotationEditor(e.model).property(dynamic.id,'symbol','ff'));expect(doc.source).toContain('dynamics="124.44" tempo="100"');
  doc.structure(e=>new NotationEditor(e.model).property(tempo.id,'per-minute','120'));expect(doc.source).toContain('<sound tempo="120"/>');
  doc.structure(e=>new NotationEditor(e.model).deleteItem(dynamic.id));expect(doc.source).not.toContain('dynamics="');expect(doc.source).toContain('<sound tempo="100"/>');expect(doc.source).toContain('<words/>');doc.validateSave();for(let i=0;i<3;i++)doc.undo();expect(doc.source).toBe(source);
});

test('changing meter fits empty piano bars and voice backups while retaining exact undo and note IDs',()=>{
  const source=newScore('Meter entry',['Piano'],3),doc=new FastDocument(source);
  doc.structure(e=>new NotationEditor(e.model).signature('P1',0,1,'time',{beats:'3',unit:'4'}));
  expect(doc.notes().every(n=>Number(n.duration)===3&&Number(n.onset)===0)).toBe(true);expect(doc.source).not.toContain('<duration>1920</duration>');doc.validateSave();
  const ids=doc.notes().map(n=>n.id);doc.undo();expect(doc.source).toBe(source);doc.redo();expect(doc.notes().map(n=>n.id)).toEqual(ids);doc.validateSave();
});

test('meter fitting also handles ordinary empty rest sequences without silently dropping a marked rest',()=>{
  const doc=new FastDocument(newScore('Meter rests',['Flute'],1));doc.structure(e=>e.input('0:0:0',undefined,'quarter'));
  const before=doc.source;doc.structure(e=>new NotationEditor(e.model).signature('P1',0,1,'time',{beats:'3',unit:'4'}));expect(Number(doc.model.parts[0].measures[0].extent)).toBe(3);doc.validateSave();doc.undo();expect(doc.source).toBe(before);
  const last=doc.notes().at(-1)!;doc.structure(e=>new NotationEditor(e.model).marking(last.id,'fermata','normal'));doc.structure(e=>new NotationEditor(e.model).signature('P1',0,1,'time',{beats:'1',unit:'4'}));expect(doc.source).toContain('<fermata>normal</fermata>');expect(()=>doc.validateSave()).toThrow();
});
