import type {ScoreModel,Pitch} from './model';
import {Rational} from './rational';
import {children,child,parseXml,qualified,setField,applyPatches,encodeXml,ScoreError} from './xml';
import {newNote,restPieces,remove,removeAttribute,decimal,type StructuralEdit} from './structure';

interface ClipNote {xml:string;prefix:string;type:string;dots:number;duration:[string,string];chord:boolean;grace:boolean}
interface Clip {version:1;voice:string;staff:number;notes:ClipNote[]}
const order=['grace','cue','chord','pitch','unpitched','rest','duration','tie','instrument','footnote','level','voice','type','dot','accidental','time-modification','stem','notehead','notehead-text','staff','beam','notations','lyric','play','listen'];
export function copyNotes(model:ScoreModel,ids:string[]){
  const notes=ids.map(id=>model.notes.get(id)).filter(n=>!!n).sort((a,b)=>a.measureIndex-b.measureIndex||a.index-b.index);
  if(!notes.length)throw new ScoreError('Select notes or rests to copy.');const a=notes[0];
  if(notes.some(n=>n.partId!==a.partId||n.voice!==a.voice||n.staff!==a.staff))throw new ScoreError('Copy one staff and voice at a time.');
  const copied:ClipNote[]=[];let last:typeof a|undefined;
  for(const [i,n] of notes.entries()){
    const chord=n.chord&&last?.chordRoot===n.chordRoot;
    if(last&&!chord&&!n.grace){const measure=model.parts.find(p=>p.id===last!.partId)!.measures[last.measureIndex],end=last.onset.add(last.duration),boundary=measure.expected.get(last.staff)??measure.expected.get(0)??measure.extent;const same=n.measureIndex===last.measureIndex&&end.equals(n.onset),next=n.measureIndex===last.measureIndex+1&&end.equals(measure.irregular?measure.extent:boundary)&&!n.onset.positive;if(!same&&!next)throw new ScoreError('Select a continuous musical passage.');}
    const ns=new Map<string,string>();const parents=[];for(let p=n.node;p;p=p.parent!)parents.push(p);for(const p of parents.reverse())for(const [k,v] of Object.entries(p.attributes))if(k==='xmlns'||k.startsWith('xmlns:'))ns.set(k,v);
    const prefix=`<source-root ${[...ns].map(([k,v])=>`${k}="${encodeXml(v)}"`).join(' ')}>`;
    copied.push({xml:model.source.slice(n.node.start,n.node.end),prefix,type:n.type,dots:n.dots,duration:[String(n.duration.n),String(n.duration.d)],chord:!!chord,grace:n.grace});if(!chord&&!n.grace)last=n;
  }
  return JSON.stringify({version:1,voice:a.voice,staff:a.staff,notes:copied} satisfies Clip);
}
export function pasteNotes(model:ScoreModel,id:string,payload:string):StructuralEdit {
  if(payload.length>2_000_000)throw new ScoreError('This clipboard passage is too large.');const clip=JSON.parse(payload) as Clip;
  if(clip.version!==1||!Array.isArray(clip.notes)||!clip.notes.length||clip.notes.length>512)throw new ScoreError('Copy notes from SourceScore first.');
  const target=model.notes.get(id);if(!target||!target.rest||target.grace||target.ratio)throw new ScoreError('Select an ordinary rest large enough for the copied passage.');
  let total=new Rational();for(const n of clip.notes)if(!n.chord&&!n.grace)total=total.add(new Rational(BigInt(n.duration[0]),BigInt(n.duration[1])));
  if(!total.positive||total.compare(target.duration)>0)throw new ScoreError('This rest is shorter than the copied passage. Choose a larger rest.');
  let xml='';
  for(const c of clip.notes){const text=c.prefix+c.xml+'</source-root>',node=parseXml(text).children[0],patches=[];
    if(node.namespace!==target.node.namespace)throw new ScoreError('This passage uses a different MusicXML namespace. Paste within the same namespace to preserve its musical and extension fields safely.');
    patches.push(setField(text,node,'voice',target.voice,order,'Paste voice'),setField(text,node,'staff',String(target.staff),order,'Paste staff'));
    const duration=new Rational(BigInt(c.duration[0]),BigInt(c.duration[1]));if(!c.grace)patches.push(setField(text,node,'duration',decimal(duration.mul(target.divisions)),order,'Paste duration'));
    for(const t of children(node,'tie'))patches.push(remove(t));
    for(const ns of children(node,'notations'))for(const t of ns.children)if(['tied','slur','glissando','slide','tuplet'].includes(t.local))patches.push(remove(t));
    for(const b of children(node,'beam'))patches.push(remove(b));
    for(const instrument of children(node,'instrument'))patches.push(remove(instrument));
    patches.push(...removeAttribute(text,node,'id'));
    for(const accidental of children(node,'accidental'))if(accidental.attributes.cautionary!=='yes')patches.push(remove(accidental));
    const chord=child(node,'chord');if(chord&&!c.chord)patches.push(remove(chord));
    const changed=applyPatches(text,patches);let entry=changed.slice(c.prefix.length,-'</source-root>'.length);
    // Bind inherited prefix declarations on the pasted note, leaving its contents lexical.
    const declarations=Object.entries(parseXml(text).attributes).filter(([k])=>(k==='xmlns'||k.startsWith('xmlns:'))&&!Object.hasOwn(node.attributes,k)).map(([k,v])=>`${k}="${encodeXml(v)}"`).join(' ');if(declarations)entry=entry.replace(/^<([^\s>]+)/,`<$1 ${declarations}`);
    xml+=entry;
  }
  for(const r of restPieces(target.duration.sub(total)))xml+=newNote(target.node,undefined,r.time,target.divisions,r.type,r.dots,target.staff,target.voice);
  return {label:'Paste musical passage',patches:[{start:target.node.start,end:target.node.end,text:xml,label:'Paste notes'}],retained:[{id:target.id,start:target.node.start}],cursor:{start:target.node.start,relative:0}};
}
