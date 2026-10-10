import {type ScoreModel,type ScoreNote,type Pitch} from './model';
import {child,children,value,field,qualified,setField,scalarPatch,encodeXml,ScoreError,type XmlElement,type Patch} from './xml';
import {append,attribute,remove,removeAttribute,replaceElement,type StructuralEdit} from './structure';
import {PitchLinks,tiedElements,tieTypes} from './pitch-links';
import {notatedTime} from './rational';

export interface PropertyField {key:string;label:string;value:string;options?:string[];readOnly?:boolean}
export interface NotationItem {id:string;kind:string;label:string;partId:string;measureIndex:number;noteId?:string;fields:PropertyField[]}
const names:Record<string,string>={measure:'Bar',direction:'Direction',dynamics:'Dynamics',words:'Text',lyric:'Lyrics',slur:'Slur',tied:'Tie',tuplet:'Tuplet',articulations:'Articulations',ornaments:'Ornaments',technical:'Technique',clef:'Clef',key:'Key signature',time:'Time signature',barline:'Barline / repeat',harmony:'Chord symbol',wedge:'Hairpin',pedal:'Pedal',beam:'Beam',stem:'Stem',notehead:'Notehead','octave-shift':'Octave line','time-modification':'Tuplet ratio'};
const choices:Record<string,string[]>={sign:['G','F','C','percussion','TAB','none'],mode:['major','minor'],'bar-style':['regular','light-light','light-heavy','heavy-light','dashed','dotted','none'],stem:['up','down','none','double'],placement:['above','below'],'print-object':['yes','no'],syllabic:['single','begin','middle','end']};
const spans=new Set(['slur','tied','glissando','slide','wedge','pedal','octave-shift','tuplet']);
export const dynamicVelocities:Record<string,number>={pppp:20,ppp:30,pp:42,p:54,mp:66,mf:80,f:96,ff:112,fff:124,ffff:127,sfz:116,fp:88,sfp:76,rfz:116};
const label=(s:string)=>names[s]??s.replace(/-/g,' ').replace(/^./,x=>x.toUpperCase());
const excluded=new Set(['note','pitch','rest','unpitched','duration','voice','staff','type','dot','accidental','divisions','backup','forward','attributes','print','direction-type']);
export class NotationEditor {
  constructor(readonly model:ScoreModel){}
  note(id:string){const n=this.model.notes.get(id);if(!n)throw new ScoreError('Select a note.');return n;}
  bar(partId:string,index:number){const m=this.model.parts.find(p=>p.id===partId)?.measures[index];if(!m)throw new ScoreError('Select a bar.');return m;}
  items(partId:string,index:number){
    const m=this.bar(partId,index),items:NotationItem[]=[];
    const walk=(node:XmlElement,path:string[],noteId?:string,parentOwnsFields=false)=>{
      if(['pitch','unpitched','rest','duration','voice','staff','accidental','divisions'].includes(node.local))return;
      const fields:PropertyField[]=[];
      for(const [k,v] of Object.entries(node.attributes))if(!k.includes(':')&&k!=='id')fields.push({key:'@'+k,label:label(k),value:v,options:choices[k],readOnly:spans.has(node.local)&&['type','number'].includes(k)});
      if(!node.children.length&&!node.selfClosing)fields.push({key:'.',label:label(node.local),value:value(this.model.source,node),options:choices[node.local]});
      const fieldCounts=new Map<string,number>();for(const c of node.children)if(!c.children.length&&!c.selfClosing&&c.namespace===node.namespace)fieldCounts.set(c.local,(fieldCounts.get(c.local)??0)+1);
      const fieldIndices=new Map<string,number>();for(const c of node.children)if(!c.children.length&&!c.selfClosing&&c.namespace===node.namespace){const i=fieldIndices.get(c.local)??0;fieldIndices.set(c.local,i+1);const repeated=(fieldCounts.get(c.local)??0)>1;fields.push({key:repeated?`${c.local}:${i}`:c.local,label:label(c.local)+(repeated?` ${i+1}`:''),value:value(this.model.source,c),options:choices[c.local]});}
      const eligible=!excluded.has(node.local)&&((fields.length>0)||node.parent?.local==='articulations'||node.parent?.local==='ornaments'||node.parent?.local==='technical'||node.local==='dynamics');
      if(eligible&&!(parentOwnsFields&&!node.children.length&&!Object.keys(node.attributes).length&&!node.selfClosing)){
        if(node.local==='dynamics')fields.push({key:'symbol',label:'Dynamic',value:node.children[0]?.local??'mf',options:['pppp','ppp','pp','p','mp','mf','f','ff','fff','ffff','sfz','fp','sfp','rfz']});
        const owner=noteId?this.model.notes.get(noteId):undefined,context=owner?` · ${owner.pitch?owner.pitch.step+owner.pitch.octave:'Rest'} · Staff ${owner.staff}`:node.attributes.number&&['clef','key','time'].includes(node.local)?` · Staff ${node.attributes.number}`:'';
        items.push({id:JSON.stringify([partId,m.id,noteId??'',path]),kind:node.local,label:label(node.local)+(node.local==='words'?': '+value(this.model.source,node):node.local==='dynamics'?': '+(node.children[0]?.local??''):'')+context,partId,measureIndex:index,noteId,fields});
      }
      const counts=new Map<string,number>();for(const c of node.children){if(c.namespace!==node.namespace)continue;const i=counts.get(c.local)??0;counts.set(c.local,i+1);if(c.local==='note'){const n=m.notes.find(n=>n.node.start===c.start)!;walk(c,[],n.id);}else walk(c,[...path,`${c.local}:${i}`],noteId,eligible);}
    };
    walk(m.node,[]);return items;
  }
  resolve(id:string){
    const [partId,barId,noteId,path]=JSON.parse(id) as [string,string,string,string[]];const p=this.model.parts.find(p=>p.id===partId),m=p?.measures.find(m=>m.id===barId);let node=noteId?this.note(noteId).node:m?.node;
    for(const part of path){const [name,index]=part.split(':');node=node?children(node,name)[Number(index)]:undefined;}
    if(!node)throw new ScoreError('That notation element is no longer available.');return node;
  }
  property(id:string,key:string,next:string):StructuralEdit {
    const node=this.resolve(id),source=this.model.source;let patches:Patch[];
    if(spans.has(node.local)&&['@type','@number'].includes(key))throw new ScoreError('Change this span by deleting it and choosing its new endpoints. Its paired markers must stay coordinated.');
    const fieldName=key.replace(/^@/,'').split(':')[0],options=choices[fieldName];if(options&&!options.includes(next))throw new ScoreError('Choose a supported '+label(fieldName).toLowerCase()+'.');
    if(['actual-notes','normal-notes','staves','line'].includes(fieldName)&&(!Number.isInteger(Number(next))||Number(next)<1))throw new ScoreError('This musical count must be a positive integer.');
    if(fieldName==='fifths'&&(!Number.isInteger(Number(next))||Math.abs(Number(next))>7))throw new ScoreError('Choose a key signature from seven flats to seven sharps.');
    if(key==='symbol'&&node.local==='dynamics'){
      if(!['pppp','ppp','pp','p','mp','mf','f','ff','fff','ffff','sfz','fp','sfp','rfz'].includes(next))throw new ScoreError('Choose a dynamic marking.');
      const old=node.children[0];const markup=`<${qualified(node,next)}/>`;patches=old?[{start:old.start,end:old.end,text:markup,label:'Dynamic marking'}]:[append(source,node,markup)];
    }else if(key.startsWith('@'))patches=[attribute(source,node,key.slice(1),next)];
    else if(key==='.')patches=[scalarPatch(source,node,next,'Edit '+label(node.local))];
    else if(key.includes(':')){const [name,index]=key.split(':'),leaf=children(node,name)[Number(index)];if(!leaf)throw new ScoreError('That property is no longer available.');patches=[scalarPatch(source,leaf,next,'Edit '+label(name))];}
    else patches=[setField(source,node,key,next,node.children.map(c=>c.local),'Edit '+label(key))];
    const direction=this.direction(node),sound=direction?child(direction,'sound'):undefined;
    if(key==='symbol'&&node.local==='dynamics'&&sound?.attributes.dynamics)patches.push(attribute(source,sound,'dynamics',String(Math.round(dynamicVelocities[next]/0.9*100)/100)));
    if(node.local==='metronome'&&['per-minute','beat-unit'].includes(key)&&sound?.attributes.tempo){
      const unit=key==='beat-unit'?next:field(source,node,'beat-unit'),bpm=Number(key==='per-minute'?next:field(source,node,'per-minute')),duration=notatedTime(unit,children(node,'beat-unit-dot').length);
      if(!duration||!Number.isFinite(bpm)||bpm<=0)throw new ScoreError('This tempo needs a positive numeric BPM and an ordinary beat unit.');
      patches.push(attribute(source,sound,'tempo',String(bpm*Number(duration))));
    }
    return {label:'Edit '+label(node.local),patches,allowTiming:node.local==='time',fitRests:node.local==='time'};
  }
  private direction(node:XmlElement){for(let p=node.parent;p;p=p.parent)if(p.local==='direction'&&p.namespace===node.namespace)return p;return undefined;}
  private deleteNode(node:XmlElement):Patch[] {
    const type=node.parent,direction=type?.parent;
    if(type?.local==='direction-type'&&type.children.length===1&&direction?.local==='direction'){
      if(direction.children.every(c=>c===type||['voice','staff','offset'].includes(c.local)))return [remove(direction,'Delete direction')];
      // Keep unrelated sound, editorial and extension fields on their original container.
      const patches=[{start:node.start,end:node.end,text:`<${qualified(node,'words')}/>`,label:'Delete visual direction'}];
      const sound=child(direction,'sound');if(node.local==='dynamics'&&sound)patches.push(...removeAttribute(this.model.source,sound,'dynamics'));return patches;
    }
    return [remove(node)];
  }
  deleteItem(id:string):StructuralEdit {
    const node=this.resolve(id),patches=this.deleteNode(node),spanTag=node.local;
    if(spanTag==='tied'){
      const [, ,noteId]=JSON.parse(id) as string[],n=this.note(noteId),chain=new PitchLinks(this.model).chain(n);
      return {label:'Delete tie chain',patches:chain.flatMap(id=>{const n=this.note(id);return [...children(n.node,'tie'),...tiedElements(n)].filter(e=>e.attributes.type!=='let-ring').map(e=>remove(e,'Delete connected tie'));})};
    }
    if(['slur','tied','glissando','slide','wedge','pedal','octave-shift'].includes(spanTag)){
      const [partId]=JSON.parse(id) as string[],number=node.attributes.number??'1',part=this.model.parts.find(p=>p.id===partId)!;
      const nodes:XmlElement[]=[];const walk=(n:XmlElement)=>{for(const c of n.children){if(c.namespace!==n.namespace)continue;if(c.local===spanTag&&(c.attributes.number??'1')===number)nodes.push(c);walk(c);}};for(const m of part.measures)walk(m.node);
      const startTypes=new Set(['start','crescendo','diminuendo','up','down']),stopTypes=new Set(['stop','discontinue']),at=nodes.findIndex(n=>n.start===node.start);
      const scan=(direction:number)=>{for(let i=at+direction;i>=0&&i<nodes.length;i+=direction){const other=nodes[i],type=other.attributes.type;if((direction===1?stopTypes:startTypes).has(type)){patches.push(...this.deleteNode(other));break;}if(['continue','resume','change'].includes(type))patches.push(...this.deleteNode(other));else break;}};
      if(startTypes.has(node.attributes.type))scan(1);else if(stopTypes.has(node.attributes.type))scan(-1);else {scan(-1);scan(1);}
      if(spanTag==='tied'){for(const marker of [node,...patches.slice(1).map(p=>nodes.find(n=>n.start===p.start)).filter((n):n is XmlElement=>!!n)]){let owner=marker.parent;while(owner&&owner.local!=='note')owner=owner.parent;if(owner)for(const tie of children(owner,'tie'))if(tie.attributes.type===marker.attributes.type)patches.push(remove(tie,'Delete sounding tie'));}}
    }
    return {label:'Delete '+label(node.local),patches};
  }
  private noteNotation(n:ScoreNote,markup:string){const ns=child(n.node,'notations'),before=n.node.children.find(c=>['lyric','play','listen'].includes(c.local)),at=before?.start??n.node.closeStart;return ns?append(this.model.source,ns,markup):{start:at,end:at,text:`<${qualified(n.node,'notations')}>${markup}</${qualified(n.node,'notations')}>`,label:'Add notation'};}
  marking(id:string,kind:string,symbol:string,text=''):StructuralEdit {
    const n=this.note(id),q=(s:string)=>qualified(n.node,s);let markup='',patch:Patch;
    if(['articulation','ornament','technique'].includes(kind)){
      const container=kind==='articulation'?'articulations':kind==='ornament'?'ornaments':'technical';
      const allowed=kind==='articulation'?['staccato','staccatissimo','accent','strong-accent','tenuto','detached-legato','breath-mark','caesura','scoop','plop','doit','falloff']:kind==='ornament'?['trill-mark','turn','inverted-turn','delayed-turn','mordent','inverted-mordent','shake','schleifer','tremolo']:['up-bow','down-bow','open-string','stopped','snap-pizzicato','fingering','pluck','tap','heel','toe'];
      if(!allowed.includes(symbol))throw new ScoreError('Choose a supported marking.');
      markup=['fingering','pluck','tremolo'].includes(symbol)?`<${q(symbol)}>${encodeXml(text||'1')}</${q(symbol)}>`:`<${q(symbol)}/>`;
      const ns=child(n.node,'notations'),existing=ns?child(ns,container):undefined;
      patch=existing?append(this.model.source,existing,markup):this.noteNotation(n,`<${q(container)}>${markup}</${q(container)}>`);
    }else if(kind==='fermata')patch=this.noteNotation(n,`<${q('fermata')}>${encodeXml(symbol||'normal')}</${q('fermata')}>`);
    else if(kind==='lyric')patch={start:n.node.closeStart,end:n.node.closeStart,text:`<${q('lyric')} number="1"><${q('syllabic')}>single</${q('syllabic')}><${q('text')}>${encodeXml(text)}</${q('text')}></${q('lyric')}>`,label:'Add lyrics'};
    else {
      if(kind==='dynamic'){if(!['pppp','ppp','pp','p','mp','mf','f','ff','fff','ffff','sfz','fp','sfp','rfz'].includes(symbol))throw new ScoreError('Choose a dynamic.');markup=`<${q('dynamics')}><${q(symbol)}/></${q('dynamics')}>`;}
      else if(kind==='text')markup=`<${q('words')}>${encodeXml(text)}</${q('words')}>`;
      else if(kind==='tempo'){const bpm=Number(text);if(!Number.isFinite(bpm)||bpm<=0||bpm>1000)throw new ScoreError('Choose a tempo from 1–1000 BPM.');markup=`<${q('metronome')}><${q('beat-unit')}>quarter</${q('beat-unit')}><${q('per-minute')}>${bpm}</${q('per-minute')}></${q('metronome')}>`;}
      else throw new ScoreError('Choose a marking type.');
      patch={start:n.node.start,end:n.node.start,text:`<${q('direction')} placement="${kind==='dynamic'?'below':'above'}"><${q('direction-type')}>${markup}</${q('direction-type')}><${q('voice')}>${encodeXml(n.voice)}</${q('voice')}><${q('staff')}>${n.staff}</${q('staff')}>${kind==='tempo'?`<${q('sound')} tempo="${Number(text)}"/>`:''}</${q('direction')}>`,label:'Add direction'};
    }
    return {label:'Add '+kind,patches:[patch]};
  }
  span(ids:string[],kind:string):StructuralEdit {
    const notes=ids.map(id=>this.note(id)).sort((a,b)=>a.measureIndex-b.measureIndex||a.onset.compare(b.onset)||a.index-b.index),a=notes[0],b=notes.at(-1);if(!a||!b||a.id===b.id||a.partId!==b.partId)throw new ScoreError('Select two endpoints in one instrument.');
    const spanTag=kind==='tie'?'tied':['crescendo','diminuendo'].includes(kind)?'wedge':kind.startsWith('octave-')?'octave-shift':kind,used=new Set<number>();
    const walk=(node:XmlElement)=>{for(const c of node.children){if(c.namespace!==node.namespace)continue;if(c.local===spanTag)used.add(Number(c.attributes.number??1));walk(c);}};for(const m of this.model.parts.find(p=>p.id===a.partId)!.measures)walk(m.node);
    const available=Array.from({length:16},(_,i)=>i+1).find(n=>!used.has(n));if(!available)throw new ScoreError('All 16 span numbers are in use. Edit an existing span.');const number=String(available);
    const patches:Patch[]=[];
    if(kind==='tie'){
      if(!a.pitch||!b.pitch||JSON.stringify(a.pitch)!==JSON.stringify(b.pitch)||a.voice!==b.voice)throw new ScoreError('Ties need the same written pitch and voice.');
      const same=a.measureIndex===b.measureIndex&&a.onset.add(a.duration).equals(b.onset),next=b.measureIndex===a.measureIndex+1&&Number(b.onset)===0&&a.onset.add(a.duration).equals(this.bar(a.partId,a.measureIndex).extent);if(!same&&!next)throw new ScoreError('Tie endpoints must be consecutive in musical time.');
      if(tieTypes(a).has('start')||tieTypes(b).has('stop'))throw new ScoreError('These endpoints already have a tie in that direction. Edit the existing tie.');
      for(const [n,type] of [[a,'start'],[b,'stop']] as const){const q=(s:string)=>qualified(n.node,s);const before=n.node.children.find(c=>['instrument','footnote','level','voice','type','staff','notations'].includes(c.local));patches.push({start:before?.start??n.node.closeStart,end:before?.start??n.node.closeStart,text:`<${q('tie')} type="${type}"/>`,label:'Sounding tie'},this.noteNotation(n,`<${q('tied')} type="${type}" number="${number}"/>`));}
    }else if(['slur','glissando','slide'].includes(kind))for(const [n,type] of [[a,'start'],[b,'stop']] as const)patches.push(this.noteNotation(n,`<${qualified(n.node,kind)} type="${type}" number="${number}"/>`));
    else if(['crescendo','diminuendo','pedal','octave-up','octave-down'].includes(kind))for(const [n,start] of [[a,true],[b,false]] as const){const q=(s:string)=>qualified(n.node,s),tag=kind==='pedal'?'pedal':kind.startsWith('octave-')?'octave-shift':'wedge';const type=!start?'stop':kind==='pedal'?'start':kind==='octave-up'?'down':kind==='octave-down'?'up':kind;const element=`<${q(tag)} type="${type}" number="${number}"${tag==='octave-shift'?' size="8"':''}/>`;patches.push({start:n.node.start,end:n.node.start,text:`<${q('direction')} placement="below"><${q('direction-type')}>${element}</${q('direction-type')}><${q('staff')}>${n.staff}</${q('staff')}></${q('direction')}>`,label:'Add span'});}
    else throw new ScoreError('Choose a span type.');
    return {label:'Add '+kind,patches};
  }
  signature(partId:string,index:number,staff:number,kind:string,values:Record<string,string>):StructuralEdit {
    const m=this.bar(partId,index),q=(s:string)=>qualified(m.node,s);let markup='';
    if(kind==='clef'){if(!['G','F','C','percussion','TAB','none'].includes(values.sign)||!Number.isInteger(Number(values.line))||Number(values.line)<1||Number(values.line)>5)throw new ScoreError('Choose a clef and staff line from 1–5.');markup=`<${q('clef')} number="${staff}"><${q('sign')}>${values.sign}</${q('sign')}><${q('line')}>${values.line}</${q('line')}></${q('clef')}>`;}
    else if(kind==='key'){const fifths=Number(values.fifths);if(!Number.isInteger(fifths)||Math.abs(fifths)>7)throw new ScoreError('Choose a key signature from seven flats to seven sharps.');markup=`<${q('key')} number="${staff}"><${q('fifths')}>${fifths}</${q('fifths')}><${q('mode')}>${values.mode==='minor'?'minor':'major'}</${q('mode')}></${q('key')}>`;}
    else if(kind==='time'){const beats=values.beats,unit=Number(values.unit);if(!/^\d+(\+\d+)*$/.test(beats)||beats.split('+').some(n=>Number(n)<1||Number(n)>128)||![1,2,4,8,16,32,64].includes(unit))throw new ScoreError('Choose a positive time signature.');markup=`<${q('time')}><${q('beats')}>${beats}</${q('beats')}><${q('beat-type')}>${unit}</${q('beat-type')}></${q('time')}>`;}
    else if(kind==='barline'){
      const styles=['regular','light-light','light-heavy','heavy-light','dashed','dotted','none'];if(!styles.includes(values.style)||!['','forward','backward'].includes(values.repeat??''))throw new ScoreError('Choose a barline and repeat direction.');
      const location=values.repeat==='forward'?'left':'right',existing=children(m.node,'barline').find(c=>(c.attributes.location??'right')===location);
      markup=`<${q('barline')} location="${location}"><${q('bar-style')}>${values.style}</${q('bar-style')}>${values.repeat?`<${q('repeat')} direction="${values.repeat}"/>`:''}</${q('barline')}>`;
      const at=location==='left'?m.node.openEnd:m.node.closeStart;
      const patch=existing?replaceElement(this.model,existing,(text,root)=>{
        if(root.selfClosing)return [append(text,root,markup.slice(markup.indexOf('>')+1,markup.lastIndexOf('</')))];
        const changes=[setField(text,root,'bar-style',values.style,['bar-style','footnote','level','wavy-line','segno','coda','fermata','ending','repeat'],'Barline style')],repeat=child(root,'repeat');
        if(repeat){if(values.repeat)changes.push(attribute(text,repeat,'direction',values.repeat));else changes.push(remove(repeat,'Remove repeat'));}
        else if(values.repeat)changes.push(append(text,root,`<${qualified(root,'repeat')} direction="${values.repeat}"/>`));return changes;
      },'Barline'): {start:at,end:at,text:markup,label:'Barline'};
      return {label:'Set barline / repeat',patches:[patch]};
    }
    else throw new ScoreError('Choose a bar property.');
    const attrs=m.node.children.find(c=>c.local==='attributes'&&c.start<(m.notes[0]?.node.start??m.node.closeStart));const part=this.model.parts.find(p=>p.id===partId)!;
    const existing=attrs?children(attrs,kind).find(c=>kind==='time'||kind==='clef'&&Number(c.attributes.number??1)===staff||kind==='key'&&(Number(c.attributes.number)===staff||!c.attributes.number&&part.staves===1)):undefined;
    const order=['divisions','key','time','staves','part-symbol','instruments','clef','staff-details','transpose','directive','measure-style'];
    const before=attrs?.children.find(c=>order.indexOf(c.local)>order.indexOf(kind));
    const changeExisting=(node:XmlElement)=>replaceElement(this.model,node,(text,root)=>{
      if(root.selfClosing)return [append(text,root,markup.slice(markup.indexOf('>')+1,markup.lastIndexOf('</')))];
      if(kind==='key'&&children(root,'key-step').length)throw new ScoreError('This nontraditional key needs coordinated step and alteration editing. Use its notation properties.');
      if(kind==='time'&&children(root,'beats').length>1)throw new ScoreError('Edit the beat groups of this composite time signature in Notation.');
      const fields=kind==='clef'?['sign','line']:kind==='key'?['fifths','mode']:['beats','beat-type'];
      const changes=fields.map(name=>setField(text,root,name,name==='beat-type'?values.unit:values[name],kind==='clef'?['sign','line','clef-octave-change']:kind==='key'?['cancel','fifths','mode','key-octave']:['beats','beat-type','interchangeable'],label(name)));
      if(kind==='time')for(const senza of children(root,'senza-misura'))changes.push(remove(senza));return changes;
    },'Signature');
    const patch=existing?changeExisting(existing):attrs?attrs.selfClosing?append(this.model.source,attrs,markup):{start:before?.start??attrs.closeStart,end:before?.start??attrs.closeStart,text:markup,label:'Signature'}:{start:m.node.openEnd,end:m.node.openEnd,text:`<${q('attributes')}>${markup}</${q('attributes')}>`,label:'Signature'};
    if(kind==='time'&&attrs&&children(attrs,'time').length>1)return {label:'Set '+label(kind),allowTiming:true,fitRests:true,patches:children(attrs,'time').map(changeExisting)};
    return {label:'Set '+label(kind),allowTiming:kind==='time',fitRests:kind==='time',patches:[patch]};
  }
}
