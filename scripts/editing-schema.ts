import {mkdirSync,writeFileSync,existsSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
import {FastDocument} from '../src/core/fast-document';
import {newScore} from '../src/core/new-score';
import {NotationEditor} from '../src/core/notation';
import {copyNotes,pasteNotes} from '../src/core/clipboard';

// The optional official MusicXML 4.0 schema and its local imports are never used to rewrite XML.
const schema=resolve(process.argv[2]??'work/schema/musicxml.xsd');
if(!existsSync(schema)){console.log('SKIP MusicXML XSD: supply a local MusicXML 4.0 schema path.');process.exit(0);}
mkdirSync('work/editing-schema',{recursive:true});
const doc=new FastDocument(newScore('Editing validation',['Piano','Flute'],4));
let count=0;
function validate(label:string){
  doc.validateSave();const file=resolve(`work/editing-schema/${++count}.musicxml`);writeFileSync(file,doc.source);
  const result=spawnSync('/usr/bin/xmllint',['--nonet','--noout','--schema',schema,file],{encoding:'utf8'});
  assert.equal(result.status,0,`${label}: ${result.stderr}`);
}
validate('New composition');
doc.structure(e=>e.input('0:0:0',{step:'C',alter:0,octave:4},'quarter'));validate('Quarter note and split full rest');
doc.structure(e=>e.resize('0:0:0','half',0));validate('Lengthen note into a rest');
doc.structure(e=>e.resize('0:0:0','quarter',0));validate('Shorten note and add rest');
const a='0:0:0';let cursor=a;
for(const step of ['D','E','F'] as const){const n=doc.note(cursor),next=doc.notes(0,4,n.partId).find(p=>p.staff===n.staff&&p.voice===n.voice&&!p.chord&&!p.grace&&(p.measureIndex>n.measureIndex||p.measureIndex===n.measureIndex&&p.onset.compare(n.onset.add(n.duration))>=0))!;doc.structure(e=>e.input(next.id,{step,alter:0,octave:4},'quarter'));cursor=next.id;}
validate('Four-note entry');
doc.structure(e=>e.input(a,{step:'E',alter:0,octave:4},'quarter',0,true));validate('Chord');
doc.structure(e=>e.input(a,{step:'D',alter:0,octave:4},'eighth',0,false,true));validate('Grace');
for(const [kind,symbol,text] of [['lyric','','Hello'],['articulation','staccato',''],['ornament','trill-mark',''],['technique','up-bow',''],['fermata','normal',''],['dynamic','mf',''],['text','','dolce'],['tempo','','100']]){doc.structure(e=>new NotationEditor(e.model).marking(a,kind,symbol,text));validate(kind);}
doc.structure(e=>e.input('0:1:0',{step:'F',alter:0,octave:4},'quarter'));doc.structure(e=>new NotationEditor(e.model).span([cursor,'0:1:0'],'tie'));validate('Cross-bar tie');
doc.structure(e=>new NotationEditor(e.model).span([a,'0:1:0'],'slur'));validate('Slur');
doc.structure(e=>new NotationEditor(e.model).span([a,'0:1:0'],'crescendo'));validate('Hairpin');
const after=doc.notes(1,1,'P1').find(p=>p.staff===1&&p.voice==='1'&&p.rest)!;
doc.structure(e=>e.tuplet(after.id,3,2));validate('Tuplet');
doc.structure(e=>e.createVoice('P1',0,1,'3'));validate('Additional voice');
const clip=copyNotes(doc.model,[a]);doc.structure(e=>pasteNotes(e.model,'0:2:0',clip));validate('Clipboard');
doc.structure(e=>new NotationEditor(e.model).signature('P1',0,1,'barline',{style:'light-heavy',repeat:'backward'}));validate('Repeat');
doc.structure(e=>new NotationEditor(e.model).signature('P1',0,1,'clef',{sign:'C',line:'3'}));validate('Clef');
doc.structure(e=>new NotationEditor(e.model).signature('P1',0,1,'key',{fifths:'-2',mode:'minor'}));validate('Staff key');
const dynamic=new NotationEditor(doc.model).items('P1',0).find(p=>p.kind==='dynamics')!;doc.structure(e=>new NotationEditor(e.model).deleteItem(dynamic.id));validate('Delete dynamic');
const stop=new NotationEditor(doc.model).items('P1',1).find(p=>p.kind==='wedge')!;doc.structure(e=>new NotationEditor(e.model).deleteItem(stop.id));validate('Delete hairpin endpoint');
doc.structure(e=>e.insertBar(0));validate('Insert first bar');
doc.structure(e=>e.deleteBar(1));validate('Delete bar and unlink affected spans');
console.log(`PASS MusicXML 4.0 XSD: ${count} generated editing stages; source model validation also passed.`);
const empty=new FastDocument(newScore('Meter validation',['Piano'],3));empty.structure(e=>new NotationEditor(e.model).signature('P1',0,1,'time',{beats:'3',unit:'4'}));empty.validateSave();
const meterFile=resolve('work/editing-schema/meter.musicxml');writeFileSync(meterFile,empty.source);const meter=spawnSync('/usr/bin/xmllint',['--nonet','--noout','--schema',schema,meterFile],{encoding:'utf8'});assert.equal(meter.status,0,meter.stderr);console.log('PASS MusicXML 4.0 XSD: empty piano meter change and synchronized voice backups.');
