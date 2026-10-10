import {type ScoreModel,type ScoreNote,type Pitch,type Step} from './model';
import {Rational,ZERO,notatedTime,typeTime} from './rational';
import {child,children,field,value,parseXml,qualified,applyPatches,setField,scalarPatch,encodeXml,ScoreError,type Patch,type XmlElement} from './xml';
import {PitchLinks,tiedElements} from './pitch-links';

export interface StructuralEdit {label:string;patches:Patch[];retained?:{id:string;start:number;relative?:number}[];cursor?:{start:number;relative:number};allowTiming?:boolean;fitRests?:boolean}
const order=['grace','cue','chord','pitch','unpitched','rest','duration','tie','instrument','footnote','level','voice','type','dot','accidental','time-modification','stem','notehead','notehead-text','staff','beam','notations','lyric','play','listen'];
const attributeOrder=['footnote','level','divisions','key','time','staves','part-symbol','instruments','clef','staff-details','transpose','for-part','directive','measure-style'];
export function inheritedAttributes(items:string[]){
  const rank=(xml:string)=>{const name=xml.match(/^<(?:[^:\s>]+:)?([\w-]+)/)?.[1]??'',at=attributeOrder.indexOf(name);return at<0?attributeOrder.length:at;};
  return items.map((xml,index)=>({xml,index})).sort((a,b)=>rank(a.xml)-rank(b.xml)||a.index-b.index).map(x=>x.xml).join('');
}
export const raw=(model:ScoreModel,node:XmlElement)=>model.source.slice(node.start,node.end);
export const remove=(node:XmlElement,label='Remove item'):Patch=>({start:node.start,end:node.end,text:'',label});
export function attribute(source:string,node:XmlElement,name:string,next:string):Patch {
  if(!/^[\w-]+$/.test(name)||name==='xmlns')throw new ScoreError('That property cannot be changed.');
  const opening=source.slice(node.start,node.openEnd),match=new RegExp(`\\s${name}\\s*=\\s*(["'])(.*?)\\1`).exec(opening);
  if(match){const start=node.start+match.index,end=start+match[0].length;return {start,end,text:` ${name}="${encodeXml(next)}"`,label:'Change '+name};}
  const at=node.openEnd-(node.selfClosing?2:1);return {start:at,end:at,text:` ${name}="${encodeXml(next)}"`,label:'Set '+name};
}
export function removeAttribute(source:string,node:XmlElement,name:string):Patch[] {
  if(!/^[\w-]+$/.test(name)||name==='xmlns')throw new ScoreError('That property cannot be removed.');
  const opening=source.slice(node.start,node.openEnd),match=new RegExp(`\\s${name}\\s*=\\s*(["'])(.*?)\\1`).exec(opening);
  return match?[{start:node.start+match.index,end:node.start+match.index+match[0].length,text:'',label:'Remove '+name}]:[];
}
export function append(source:string,parent:XmlElement,markup:string,label='Add item'):Patch {
  if(parent.selfClosing)return {start:parent.start,end:parent.end,text:source.slice(parent.start,parent.end).replace(/\/\s*>$/, '>')+markup+`</${parent.name}>`,label};
  return {start:parent.closeStart,end:parent.closeStart,text:markup,label};
}
export function decimal(r:Rational){
  let d=r.d,a=0,b=0;while(d%2n===0n){d/=2n;a++;}while(d%5n===0n){d/=5n;b++;}
  if(d!==1n)throw new ScoreError('This duration needs a coordinated divisions change. Choose a representable duration or create a tuplet.');
  const digits=Math.max(a,b),scaled=r.n*(10n**BigInt(digits))/r.d,sign=scaled<0n?'-':'',s=(scaled<0n?-scaled:scaled).toString().padStart(digits+1,'0');
  return digits?sign+(s.slice(0,-digits)+'.'+s.slice(-digits)).replace(/\.?0+$/,''):sign+s;
}
export function restPieces(duration:Rational){
  const possibilities=Object.keys(typeTime).flatMap(type=>[0,1,2].map(dots=>({type,dots,time:notatedTime(type,dots)!}))).sort((a,b)=>b.time.compare(a.time));
  const result:{type:string;dots:number;time:Rational}[]=[];let left=duration;
  while(left.positive){const next=possibilities.find(p=>p.time.compare(left)<=0);if(!next||result.length>256)throw new ScoreError('This rest cannot be split exactly into ordinary note values. Use its tuplet duration.');result.push(next);left=left.sub(next.time);}
  return result;
}
export function newNote(parent:XmlElement,pitch:Pitch|undefined,time:Rational,divisions:Rational,type:string,dots=0,staff=1,voice='1',chord=false,grace=false,ratio?:{actual:number;normal:number}){
  const tag=(s:string)=>qualified(parent,s);let xml=`<${tag('note')}>`;
  if(grace)xml+=`<${tag('grace')} slash="yes"/>`;if(chord)xml+=`<${tag('chord')}/>`;
  xml+=pitch?`<${tag('pitch')}><${tag('step')}>${pitch.step}</${tag('step')}>${pitch.alter?`<${tag('alter')}>${pitch.alter}</${tag('alter')}>`:''}<${tag('octave')}>${pitch.octave}</${tag('octave')}></${tag('pitch')}>`:`<${tag('rest')}/>`;
  if(!grace)xml+=`<${tag('duration')}>${decimal(time.mul(divisions))}</${tag('duration')}>`;
  xml+=`<${tag('voice')}>${encodeXml(voice)}</${tag('voice')}><${tag('type')}>${type}</${tag('type')}>`+`<${tag('dot')}/>` .repeat(dots);
  if(ratio)xml+=`<${tag('time-modification')}><${tag('actual-notes')}>${ratio.actual}</${tag('actual-notes')}><${tag('normal-notes')}>${ratio.normal}</${tag('normal-notes')}></${tag('time-modification')}>`;
  return xml+`<${tag('staff')}>${staff}</${tag('staff')}></${tag('note')}>`;
}
export function wrappedElement(model:ScoreModel,node:XmlElement){
  const namespaces=new Map<string,string>();const nodes:XmlElement[]=[];for(let p:XmlElement|undefined=node;p;p=p.parent)nodes.push(p);
  for(const p of nodes.reverse())for(const [k,v] of Object.entries(p.attributes))if(k==='xmlns'||k.startsWith('xmlns:'))namespaces.set(k,v);
  const prefix=`<source-root ${[...namespaces].map(([k,v])=>`${k}="${encodeXml(v)}"`).join(' ')}>`;
  const text=prefix+raw(model,node)+'</source-root>';return {text,root:parseXml(text).children[0],prefix};
}
const wrapped=(model:ScoreModel,n:ScoreNote)=>wrappedElement(model,n.node);
export function replaceElement(model:ScoreModel,node:XmlElement,mutate:(text:string,root:XmlElement)=>Patch[],label:string):Patch {
  const {text,root,prefix}=wrappedElement(model,node);
  return {start:node.start,end:node.end,text:applyPatches(text,mutate(text,root)).slice(prefix.length,-'</source-root>'.length),label};
}
function rewriteKind(model:ScoreModel,n:ScoreNote,pitch:Pitch|undefined,type:string,dots:number,time:Rational){
  const {text,root,prefix}=wrapped(model,n),patches:Patch[]=[];
  const kinds=['pitch','unpitched','rest'];const kind=child(root,pitch?'pitch':'rest');
  if(pitch){
    if(kind){patches.push(setField(text,kind,'step',pitch.step,['step','alter','octave'],'Pitch step'),setField(text,kind,'octave',String(pitch.octave),['step','alter','octave'],'Octave'));if(pitch.alter||child(kind,'alter'))patches.push(setField(text,kind,'alter',String(pitch.alter),['step','alter','octave'],'Pitch alteration'));}
  }
  for(const k of kinds)for(const e of children(root,k))if(k!==(pitch?'pitch':'rest'))patches.push(remove(e));
  if(!kind){const before=root.children.find(c=>order.indexOf(c.local)>order.indexOf(pitch?'pitch':'rest'));const name=qualified(root,pitch?'pitch':'rest');const markup=pitch?`<${name}><${qualified(root,'step')}>${pitch.step}</${qualified(root,'step')}>${pitch.alter?`<${qualified(root,'alter')}>${pitch.alter}</${qualified(root,'alter')}>`:''}<${qualified(root,'octave')}>${pitch.octave}</${qualified(root,'octave')}></${name}>`:`<${name}/>`;patches.push({start:before?.start??root.closeStart,end:before?.start??root.closeStart,text:markup,label:'Replace note kind'});}
  if(kind?.local==='rest'&&kind.attributes.measure)patches.push({start:kind.start,end:kind.end,text:`<${kind.name}/>`,label:'Ordinary rest'});
  if(!n.grace)patches.push(setField(text,root,'duration',decimal(time.mul(n.divisions)),order,'Duration'));
  const typeNode=child(root,'type');
  const typePatch=setField(text,root,'type',type,order,'Note value');
  if(!typeNode&&dots)typePatch.text+=`<${qualified(root,'dot')}/>` .repeat(dots);
  patches.push(typePatch);
  for(const e of children(root,'dot'))patches.push(remove(e));
  if(dots&&typeNode){const at=typeNode.end;patches.push({start:at,end:at,text:`<${qualified(root,'dot')}/>` .repeat(dots),label:'Dots'});}
  for(const e of children(root,'accidental'))patches.push(remove(e));
  if(!pitch&&!n.rest){
    for(const name of ['tie','stem','notehead'])for(const e of children(root,name))patches.push(remove(e));
    for(const ns of children(root,'notations'))for(const e of ns.children)if(['tied','slur','glissando','slide','articulations','ornaments','technical','arpeggiate','non-arpeggiate'].includes(e.local))patches.push(remove(e));
    for(const e of children(root,'lyric'))patches.push(remove(e));
  }
  const changed=applyPatches(text,patches);return changed.slice(prefix.length,-'</source-root>'.length);
}
export class StructureEditor {
  constructor(readonly model:ScoreModel){}
  note(id:string){const n=this.model.notes.get(id);if(!n)throw new ScoreError('Select a note or rest.');return n;}
  group(n:ScoreNote){return this.model.parts.find(p=>p.id===n.partId)!.measures[n.measureIndex].notes.filter(x=>x.chordRoot===n.chordRoot);}
  input(id:string,pitch:Pitch|undefined,type:string,dots=0,chord=false,grace=false):StructuralEdit {
    const n=this.note(id),group=this.group(n);
    if(pitch&&(!['C','D','E','F','G','A','B'].includes(pitch.step)||!Number.isInteger(pitch.octave)||pitch.octave<0||pitch.octave>9||!Number.isInteger(pitch.alter)||Math.abs(pitch.alter)>2))throw new ScoreError('Choose an ordinary written pitch.');
    if(chord){if(!pitch||n.rest||n.unpitched)throw new ScoreError('Select a pitched note to add a chord pitch.');const end=group.at(-1)!;const xml=newNote(n.node,pitch,n.duration,n.divisions,n.type,n.dots,n.staff,n.voice,true,n.grace,n.ratio);return {label:'Add chord pitch',patches:[{start:end.node.end,end:end.node.end,text:xml,label:'Chord pitch'}],cursor:{start:end.node.end,relative:0}};}
    if(grace){if(!pitch)throw new ScoreError('Grace-note input needs a pitch.');const xml=newNote(n.node,pitch,ZERO,n.divisions,type,dots,n.staff,n.voice,false,true);return {label:'Add grace note',patches:[{start:n.node.start,end:n.node.start,text:xml,label:'Grace note'}],cursor:{start:n.node.start,relative:0}};}
    const written=notatedTime(type,dots);if(!written)throw new ScoreError('Choose a supported note value.');const desired=n.ratio?written.mul(new Rational(n.ratio.normal,n.ratio.actual)):written;
    if(!pitch&&!n.rest){
      if(n.grace)return this.delete(group.map(n=>n.id));
      const root=group[0];if(desired.compare(root.duration)>0)throw new ScoreError('The rest is longer than this event. Lengthen it in the duration editor first.');
      const plan=this.delete(group.map(n=>n.id));let xml=rewriteKind(this.model,root,undefined,type,dots,desired);
      const ratio=root.ratio?new Rational(root.ratio.normal,root.ratio.actual):new Rational(1);for(const r of restPieces(root.duration.sub(desired).div(ratio)))xml+=newNote(root.node,undefined,r.time.mul(ratio),root.divisions,r.type,r.dots,root.staff,root.voice,false,false,root.ratio);
      const replacement=plan.patches.find(p=>p.start===root.node.start&&p.end===root.node.end)!;replacement.text=xml;return {...plan,label:'Enter rest',cursor:{start:root.node.start,relative:0}};
    }
    if(group.length>1||n.ties.length||n.tiedNotation||n.fretted||n.linkedRhythm||n.beams){
      if(!desired.equals(n.duration))throw new ScoreError('Keep this linked event’s duration when replacing it, or edit its rhythm as a group.');
    }
    if(desired.compare(n.duration)>0)throw new ScoreError('The new note is longer than this event. Select a larger rest or use the duration editor first.');
    if(n.grace)throw new ScoreError('Use pitch editing for this grace note, or delete it and input a new grace note.');
    let xml=rewriteKind(this.model,n,pitch,type,dots,desired);
    if(desired.compare(n.duration)<0){const ratio=n.ratio?new Rational(n.ratio.normal,n.ratio.actual):new Rational(1);for(const p of restPieces(n.duration.sub(desired).div(ratio)))xml+=newNote(n.node,undefined,p.time.mul(ratio),n.divisions,p.type,p.dots,n.staff,n.voice,false,false,n.ratio);}
    return {label:pitch?'Enter note':'Enter rest',patches:[{start:n.node.start,end:n.node.end,text:xml,label:'Note entry'}],retained:[{id:n.id,start:n.node.start}],cursor:{start:n.node.start,relative:0}};
  }
  createVoice(partId:string,measureIndex:number,staff:number,voice:string):StructuralEdit {
    const p=this.model.parts.find(p=>p.id===partId),m=p?.measures[measureIndex];if(!m)throw new ScoreError('Select a bar.');
    if(!Number.isInteger(staff)||staff<1||staff>p!.staves||!/^[1-8]$/.test(voice))throw new ScoreError('Choose an existing staff and voice 1–8.');
    if(m.notes.some(n=>n.voice===voice&&n.staff===staff))throw new ScoreError('This voice already has events in this bar. Select one to enter notes.');
    const duration=m.expected.get(staff)??m.expected.get(0)??m.extent;if(!duration.positive)throw new ScoreError('Set the bar’s time signature first.');
    const divisions=m.notes.at(-1)?.divisions??new Rational(480),cursor=m.endCursor??m.extent,tag=(s:string)=>qualified(m.node,s);
    let xml=cursor.positive?`<${tag('backup')}><${tag('duration')}>${decimal(cursor.mul(divisions))}</${tag('duration')}></${tag('backup')}>`:'';
    const relative=xml.length;for(const r of restPieces(duration))xml+=newNote(m.node,undefined,r.time,divisions,r.type,r.dots,staff,voice);
    return {label:'Add voice',patches:[{start:m.node.closeStart,end:m.node.closeStart,text:xml,label:'Voice rests'}],cursor:{start:m.node.closeStart,relative}};
  }
  moveStaff(id:string,staff:number):StructuralEdit {
    const n=this.note(id),p=this.model.parts.find(p=>p.id===n.partId)!;if(!Number.isInteger(staff)||staff<1||staff>p.staves)throw new ScoreError('Choose a staff in this instrument.');
    return {label:'Move note to staff '+staff,patches:[setField(this.model.source,n.node,'staff',String(staff),order,'Staff')]};
  }
  fitEmptyBars(changed?:Set<string>):StructuralEdit {
    const patches:Patch[]=[],retained:{id:string;start:number}[]=[];
    for(const part of this.model.parts)for(const m of part.measures){
      if(changed&&!changed.has(m.id)||m.irregular||!m.notes.length||m.notes.some(n=>!n.rest||n.pitch||n.grace||n.chord||n.ratio||n.beams)||m.node.children.some(c=>c.local==='forward'||c.local==='attributes'&&c.start>m.notes[0].node.start))continue;
      const divisions=m.notes[0].divisions;if(m.notes.some(n=>!n.divisions.equals(divisions)))continue;
      const groups=new Map<string,ScoreNote[]>();for(const n of m.notes){const key=n.voice+':'+n.staff;groups.set(key,[...(groups.get(key)??[]),n]);}
      let safe=true;const local:Patch[]=[],kept:{id:string;start:number}[]=[],durations=new Map<string,Rational>();
      for(const notes of groups.values()){
        const target=m.expected.get(notes[0].staff)??m.expected.get(0);if(!target?.positive){safe=false;break;}
        let end=ZERO;for(const n of notes){if(!n.onset.equals(end)){safe=false;break;}end=end.add(n.duration);}if(!safe)break;
        for(const [i,n] of notes.entries()){
          let duration=target.sub(n.onset);if(duration.compare(ZERO)<0)duration=ZERO;if(i<notes.length-1&&duration.compare(n.duration)>0)duration=n.duration;
          durations.set(n.id,duration);if(duration.equals(n.duration))continue;
          if(!duration.positive){
            if(n.node.attributes.id||n.node.children.some(c=>c.namespace!==n.node.namespace||!['rest','duration','voice','type','dot','staff','stem'].includes(c.local))){safe=false;break;}
            local.push(remove(n.node,'Trim empty bar'));continue;
          }
          if(n.fullMeasureRest)local.push(setField(this.model.source,n.node,'duration',decimal(duration.mul(divisions)),order,'Full-bar rest duration'));
          else {let xml='';for(const [j,r] of restPieces(duration).entries())xml+=j===0?rewriteKind(this.model,n,undefined,r.type,r.dots,r.time):newNote(n.node,undefined,r.time,divisions,r.type,r.dots,n.staff,n.voice);local.push({start:n.node.start,end:n.node.end,text:xml,label:'Fit rest to meter'});kept.push({id:n.id,start:n.node.start});}
        }
        if(!safe)break;
      }
      if(!safe)continue;
      let oldCursor=ZERO,newCursor=ZERO;for(const node of m.node.children){
        const n=m.notes.find(n=>n.node.start===node.start);if(n){oldCursor=oldCursor.add(n.duration);newCursor=newCursor.add(durations.get(n.id)!);}
        else if(node.local==='backup'&&node.namespace===m.node.namespace){const ticks=Rational.decimal(field(this.model.source,node,'duration'));if(!ticks||!oldCursor.sub(ticks.div(divisions)).equals(ZERO)||!newCursor.positive){safe=false;break;}local.push(setField(this.model.source,node,'duration',decimal(newCursor.mul(divisions)),['duration','footnote','level'],'Fit voice backup'));oldCursor=ZERO;newCursor=ZERO;}
      }
      if(safe){patches.push(...local);retained.push(...kept);}
    }
    return {label:'Fit empty bars to meter',patches,retained};
  }
  resize(id:string,type:string,dots:number):StructuralEdit {
    const n=this.note(id),group=this.group(n),written=notatedTime(type,dots);if(!written)throw new ScoreError('Choose a note value.');
    if(n.grace||n.ties.length||n.tiedNotation||n.linkedRhythm&& !n.ratio)throw new ScoreError('This linked rhythm needs an explicit group transformation. Its notation has been preserved.');
    const desired=n.ratio?written.mul(new Rational(n.ratio.normal,n.ratio.actual)):written,delta=desired.sub(group[0].duration),patches:Patch[]=[],retained:{id:string;start:number}[]=[];
    for(const note of group){const {text,root,prefix}=wrapped(this.model,note),changes:Patch[]=[];
      changes.push(setField(text,root,'duration',decimal(desired.mul(note.divisions)),order,'Duration'));
      const node=child(root,'type'),p=setField(text,root,'type',type,order,'Note value');if(!node&&dots)p.text+=`<${qualified(root,'dot')}/>` .repeat(dots);changes.push(p);
      for(const dot of children(root,'dot'))changes.push(remove(dot));if(node&&dots)changes.push({start:node.end,end:node.end,text:`<${qualified(root,'dot')}/>` .repeat(dots),label:'Dots'});
      if(note.fullMeasureRest){const rest=child(root,'rest')!;changes.push({start:rest.start,end:rest.end,text:`<${rest.name}/>`,label:'Rest value'});}
      if(['whole','half','quarter','breve','long','maxima'].includes(type))for(const beam of children(root,'beam'))changes.push(remove(beam));
      patches.push({start:note.node.start,end:note.node.end,text:applyPatches(text,changes).slice(prefix.length,-'</source-root>'.length),label:'Resize event'});retained.push({id:note.id,start:note.node.start});
    }
    const last=group.at(-1)!,q=(s:string)=>qualified(n.node,s);
    if(delta.compare(ZERO)<0){const ratio=n.ratio?new Rational(n.ratio.normal,n.ratio.actual):new Rational(1);let rests='';for(const r of restPieces(delta.mul(new Rational(-1)).div(ratio)))rests+=newNote(n.node,undefined,r.time.mul(ratio),n.divisions,r.type,r.dots,n.staff,n.voice,false,false,n.ratio);patches.push({start:last.node.end,end:last.node.end,text:rests,label:'Fill freed time with rests'});}
    if(delta.positive){
      const m=this.model.parts.find(p=>p.id===n.partId)!.measures[n.measureIndex];let left=delta,end=n.onset.add(n.duration),previous=last;
      while(left.positive){const next=m.notes[previous.index+1];if(!next||!next.rest||next.grace||next.chord||next.ratio||next.voice!==n.voice||next.staff!==n.staff||!next.onset.equals(end))throw new ScoreError('Lengthening would overwrite another note or voice. Delete the affected notes first, then fill their rests.');
        if(m.node.children.some(c=>c.start>previous.node.start&&c.start<next.node.start))throw new ScoreError('A marking occurs before the next rest. Preserve its timing by editing that rest separately.');
        let remainder=next.duration.sub(left);if(remainder.compare(ZERO)<0)remainder=ZERO;
        const metadata=next.node.children.some(c=>c.namespace!==next.node.namespace||!['rest','duration','voice','type','dot','staff','beam','stem'].includes(c.local));
        if(!remainder.positive&&metadata)throw new ScoreError('The following rest owns a marking or extension. Move or remove that object before consuming the rest.');
        let xml='';for(const [i,r] of restPieces(remainder).entries())xml+=i===0?rewriteKind(this.model,next,undefined,r.type,r.dots,r.time):newNote(next.node,undefined,r.time,next.divisions,r.type,r.dots,next.staff,next.voice);
        patches.push({start:next.node.start,end:next.node.end,text:xml,label:'Consume following rest'});if(xml)retained.push({id:next.id,start:next.node.start});left=left.sub(next.duration);end=next.onset.add(next.duration);previous=next;
      }
    }
    return {label:'Change duration to '+type,patches,retained,cursor:{start:n.node.start,relative:0}};
  }
  insertBar(index:number):StructuralEdit {
    if(!Number.isInteger(index)||index<0||index>this.model.measures)throw new ScoreError('Choose a bar position in this score.');
    const patches:Patch[]=[];for(const p of this.model.parts){const ref=p.measures[Math.min(index,p.measures.length-1)];if(!ref)continue;const divisions=(index<p.measures.length?ref.notes[0]:ref.notes.at(-1))?.divisions??new Rational(480),tag=qualified(p.node,'measure'),q=(s:string)=>qualified(p.node,s);
      const base=`${ref.number}${index<p.measures.length?'a':'b'}`,used=new Set(p.measures.map(m=>m.number));let label=base,suffix=2;while(used.has(label))label=base+(suffix++);
      let body=ref.renderAttributes.length?`<${q('attributes')}>${inheritedAttributes(ref.renderAttributes)}</${q('attributes')}>`:'';
      const first=ref.notes[0]?.node.start??ref.node.closeStart;
      for(const attrs of children(ref.node,'attributes'))if(index>=p.measures.length||attrs.start<first)body+=raw(this.model,attrs);
      if(!body.includes('divisions'))body+=`<${q('attributes')}><${q('divisions')}>${decimal(divisions)}</${q('divisions')}></${q('attributes')}>`;
      let previous=ZERO;for(let staff=1;staff<=p.staves;staff++){const duration=ref.expected.get(staff)??ref.expected.get(0)??ref.extent;if(!duration.positive)throw new ScoreError('Set the bar duration before inserting a new bar.');
        if(staff>1)body+=`<${q('backup')}><${q('duration')}>${decimal(previous.mul(divisions))}</${q('duration')}></${q('backup')}>`;
        body+=`<${q('note')}><${q('rest')} measure="yes"/><${q('duration')}>${decimal(duration.mul(divisions))}</${q('duration')}><${q('voice')}>${staff}</${q('voice')}><${q('staff')}>${staff}</${q('staff')}></${q('note')}>`;previous=duration;
      }
      const at=index<p.measures.length?p.measures[index].node.start:p.node.closeStart;patches.push({start:at,end:at,text:`<${tag} number="${encodeXml(label)}">${body}</${tag}>`,label:'Insert bar'});
    }return {label:'Insert bar in all instruments',patches};
  }
  deleteBar(index:number):StructuralEdit {
    if(this.model.measures<=1)throw new ScoreError('Keep at least one bar in the score. Delete its notes to make it empty.');
    const bars=this.model.parts.flatMap(p=>p.measures[index]?[p.measures[index]]:[]),ids=bars.flatMap(m=>m.notes.map(n=>n.id));
    const unlink=this.delete(ids).patches.filter(p=>!bars.some(m=>p.start>=m.node.start&&p.end<=m.node.end));
    const patches:Patch[]=[...unlink];
    for(const part of this.model.parts){const m=part.measures[index];if(!m)continue;patches.push(remove(m.node,'Delete bar'));
      const next=part.measures[index+1];if(next&&children(m.node,'attributes').length){const q=qualified(next.node,'attributes');patches.push({start:next.node.openEnd,end:next.node.openEnd,text:`<${q}>${inheritedAttributes(next.renderAttributes)}</${q}>`,label:'Preserve inherited attributes'});}
    }
    return {label:'Delete bar in all instruments',patches};
  }
  tuplet(id:string,actual:number,normal:number):StructuralEdit {
    const n=this.note(id);if(!n.rest||n.ratio||n.grace||!Number.isInteger(actual)||!Number.isInteger(normal)||actual<2||actual>16||normal<1||normal>16)throw new ScoreError('Select an ordinary rest and a tuplet ratio from 2–16 over 1–16.');
    const time=n.duration.div(new Rational(actual)),written=time.mul(new Rational(actual,normal));const representation=Object.keys(typeTime).flatMap(type=>[0,1,2].map(dots=>({type,dots,time:notatedTime(type,dots)!}))).find(r=>r.time.equals(written));if(!representation)throw new ScoreError('This span cannot be expressed with that tuplet ratio. Select another rest span.');
    decimal(time.mul(n.divisions));let xml='';for(let i=0;i<actual;i++){
      let entry=i===0?rewriteKind(this.model,n,undefined,representation.type,representation.dots,time):newNote(n.node,undefined,time,n.divisions,representation.type,representation.dots,n.staff,n.voice,false,false,{actual,normal});
      if(i===0){const {prefix}=wrapped(this.model,n),text=prefix+entry+'</source-root>',root=parseXml(text).children[0],before=root.children.find(c=>order.indexOf(c.local)>order.indexOf('time-modification')),q=(s:string)=>qualified(root,s);entry=applyPatches(text,[{start:before?.start??root.closeStart,end:before?.start??root.closeStart,text:`<${q('time-modification')}><${q('actual-notes')}>${actual}</${q('actual-notes')}><${q('normal-notes')}>${normal}</${q('normal-notes')}></${q('time-modification')}>`,label:'Tuplet ratio'}]).slice(prefix.length,-'</source-root>'.length);}
      if(i===0||i===actual-1){const {prefix}=wrapped(this.model,n),text=prefix+entry+'</source-root>',root=parseXml(text).children[0],ns=child(root,'notations'),q=(s:string)=>qualified(root,s),mark=`<${q('tuplet')} type="${i===0?'start':'stop'}" number="1"/>`,before=root.children.find(c=>order.indexOf(c.local)>order.indexOf('notations'));const patch=ns?append(text,ns,mark):{start:before?.start??root.closeStart,end:before?.start??root.closeStart,text:`<${q('notations')}>${mark}</${q('notations')}>`,label:'Tuplet bracket'};entry=applyPatches(text,[patch]).slice(prefix.length,-'</source-root>'.length);}
      xml+=entry;
    }
    return {label:'Create '+actual+':'+normal+' tuplet',patches:[{start:n.node.start,end:n.node.end,text:xml,label:'Tuplet rests'}],retained:[{id:n.id,start:n.node.start}],cursor:{start:n.node.start,relative:0}};
  }
  delete(ids:string[]):StructuralEdit {
    const selected=new Set(ids),patches:Patch[]=[],retained:{id:string;start:number}[]=[];
    const unlink=new Map<number,XmlElement>(),tieSides=new Map<ScoreNote,Set<string>>(),links=new PitchLinks(this.model);
    for(const id of ids){const n=this.note(id);if(n.rest)continue;const group=this.group(n),remaining=group.filter(x=>!selected.has(x.id));
      if(n.grace||remaining.length){patches.push(remove(n.node,'Delete note'));if(n.id===n.chordRoot&&remaining.length){const flag=child(remaining[0].node,'chord');if(flag)patches.push(remove(flag,'Promote chord root'));}}
      else if(n.id===n.chordRoot){const xml=rewriteKind(this.model,n,undefined,n.type,n.dots,n.duration);patches.push({start:n.node.start,end:n.node.end,text:xml,label:'Replace deleted event with rest'});retained.push({id:n.id,start:n.node.start});}
      else patches.push(remove(n.node,'Delete chord member'));
      if(n.ties.length||tiedElements(n).some(e=>e.attributes.type!=='let-ring')){
        const chain=links.chain(n).map(id=>this.note(id)).sort((a,b)=>a.measureIndex-b.measureIndex||a.onset.compare(b.onset)||a.index-b.index);
        for(let i=0;i<chain.length-1;i++)if(selected.has(chain[i].id)||selected.has(chain[i+1].id)){
          for(const [linked,type] of [[chain[i],'start'],[chain[i+1],'stop']] as const)if(!selected.has(linked.id)){const sides=tieSides.get(linked)??new Set<string>();sides.add(type);tieSides.set(linked,sides);}
        }
      }
    }
    for(const p of this.model.parts){const open=new Map<string,{id:string;node:XmlElement}[]>();
      for(const n of p.measures.flatMap(m=>m.notes).sort((a,b)=>a.measureIndex-b.measureIndex||a.onset.compare(b.onset)||a.index-b.index))for(const ns of children(n.node,'notations'))for(const e of ns.children){
        if(!['slur','glissando','slide'].includes(e.local))continue;const key=e.local+':'+(e.attributes.number??'1');
        if(e.attributes.type==='start')open.set(key,[{id:n.id,node:e}]);else if(open.has(key)){const items=open.get(key)!;items.push({id:n.id,node:e});if(e.attributes.type==='stop'){if(items.some(x=>selected.has(x.id)))for(const x of items)if(!selected.has(x.id))unlink.set(x.node.start,x.node);open.delete(key);}}
      }
    }
    for(const [n,sides] of tieSides)for(const e of [...children(n.node,'tie'),...tiedElements(n)]){
      if(sides.has(e.attributes.type))unlink.set(e.start,e);
      else if(e.local==='tied'&&e.attributes.type==='continue'){
        if(sides.size===2)unlink.set(e.start,e);
        else patches.push(attribute(this.model.source,e,'type',sides.has('start')?'stop':'start'));
      }
    }
    for(const e of unlink.values())patches.push(remove(e,'Unlink deleted span'));
    return {label:'Delete notes',patches,retained};
  }
}
