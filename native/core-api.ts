import {FastDocument,midiPitch} from '../src/core/fast-document';
import {child,children,field} from '../src/core/xml';
import {measureLengths} from '../src/core/pitch-links';
import {NotationEditor,dynamicVelocities} from '../src/core/notation';
import {keyAlteration} from '../src/core/model';
import {newScore} from '../src/core/new-score';
import {notatedTime,Rational} from '../src/core/rational';
import {copyNotes,pasteNotes} from '../src/core/clipboard';
let doc:FastDocument;
const viewNote=(n:any)=>({id:n.id,partId:n.partId,index:n.index,measureIndex:n.measureIndex,measureNumber:n.measureNumber,staff:n.staff,voice:n.voice,pitch:n.pitch??null,rest:n.rest,fullMeasureRest:n.fullMeasureRest,unpitched:n.unpitched,grace:n.grace,chord:n.chord,type:n.type,dots:n.dots,onset:Number(n.onset),duration:Number(n.duration),transpose:n.transpose,ties:n.ties,ratio:n.ratio??null});
function keyboardPitch(id:string,letter:string,alter:number|null) {
  if(!['C','D','E','F','G','A','B'].includes(letter))throw new Error('Choose a note from A–G.');
  const n=doc.note(id),previous=doc.notes(0,doc.model.measures,n.partId).filter(p=>p.staff===n.staff&&p.voice===n.voice&&p.pitch&&(p.measureIndex<n.measureIndex||p.measureIndex===n.measureIndex&&p.index<n.index)).at(-1);
  const reference=n.pitch??previous?.pitch??{step:'C' as const,alter:0,octave:n.staff>1?3:4},natural={C:0,D:2,E:4,F:5,G:7,A:9,B:11}[letter as 'C'];
  const octaves=Array.from({length:3},(_,i)=>reference.octave+i-1).filter(o=>o>=0&&o<=9);octaves.sort((a,b)=>Math.abs((a+1)*12+natural-midiPitch(reference))-Math.abs((b+1)*12+natural-midiPitch(reference)));
  return {step:letter,alter:alter??keyAlteration(n.keyFifths,letter as 'C'),octave:octaves[0]};
}
function instrumentProgram(name:string) {
  const n=name.toLowerCase();
  for(const [words,program] of [[['piccolo'],72],[['flute','flauto'],73],[['oboe'],68],[['clarinet','clarinetto'],71],[['bassoon','fagott'],70],[['horn','corno'],60],[['trumpet','tromba'],56],[['trombone'],57],[['tuba'],58],[['timpani','timpano'],47],[['campan','glock'],9],[['piano','pianoforte'],0],[['violin','violino'],40],[['viola'],41],[['cello','violoncello'],42],[['bass','contrabass'],43],[['harp','arpa'],46]] as [string[],number][]) if(words.some(w=>n.includes(w)))return program;
  return 48;
}
function parts(document=doc) {
  const source=document.model.source,list=child(document.model.root,'part-list');
  return document.model.parts.map(p=>{
    if(!Number.isSafeInteger(p.staves)||p.staves<1)throw new Error('This score contains an invalid staff count. The previous score is still open.');
    const meta=list?children(list,'score-part').find(n=>n.attributes.id===p.id):undefined;
    const midi=meta?child(meta,'midi-instrument'):undefined;
    const requested=midi?Number(field(source,midi,'midi-program'))-1:NaN;
    return {id:p.id,name:p.name,staves:p.staves,program:Number.isInteger(requested)&&requested>=0&&requested<128?requested:instrumentProgram(p.name),percussion:midi?field(source,midi,'midi-channel')==='10':false};
  });
}
function state(ids:string[]=[],document=doc,summary=false) {
  const requested=[...new Set([...ids,...document.lastChangedIds,...document.selectionAfter])].filter(id=>document.model.notes.has(id));
  return {dirty:document.dirty,canUndo:document.canUndo,canRedo:document.canRedo,revision:document.revision,label:document.lastLabel,notes:requested.map(id=>viewNote(document.note(id))),structural:document.lastStructural,selection:document.selectionAfter,...(summary||document.lastStructural?{diagnostics:document.model.diagnostics,measureCount:document.model.measures,eventCount:document.model.notes.size,parts:parts(document),measureLabels:document.model.parts[0].measures.map(m=>m.number)}:{})};
}
function playback() {
  const model=doc.model,lengths=measureLengths(model);
  const starts:number[]=[];let total=0;for(const length of lengths){starts.push(total);total+=length;}
  const tempos:{beat:number;bpm:number}[]=[];
  const events:any[]=[];const open=new Map<string,any>();
  const dynamicValues=dynamicVelocities;
  const dynamicChanges:{partId:string;staff:number;beat:number;velocity:number}[]=[];
  for(const p of model.parts) for(const m of p.measures) {
    for(const direction of children(m.node,'direction')) {const sound=child(direction,'sound');const following=m.notes.find(n=>n.node.start>direction.start);const beat=starts[m.index]+Number(following?.onset??0);const bpm=Number(sound?.attributes.tempo);if(bpm>0)tempos.push({beat,bpm});const dynamics=child(child(direction,'direction-type')??direction,'dynamics');const explicit=Number(sound?.attributes.dynamics);const velocity=explicit>0?Math.round(explicit*0.9):dynamics?dynamicValues[dynamics.children[0]?.local]:undefined;if(velocity)dynamicChanges.push({partId:p.id,staff:Number(field(model.source,direction,'staff','0')),beat,velocity});}
    for(const base of m.notes) {
      const n=doc.note(base.id);if(!n.pitch||n.rest)continue;
      const pitch=midiPitch(n.pitch)+n.transpose;if(pitch<0||pitch>127)continue;
      const beat=starts[m.index]+Number(n.onset),dynamic=dynamicChanges.filter(d=>d.partId===n.partId&&(d.staff===0||d.staff===n.staff)&&d.beat<=beat).at(-1);
      const event={id:n.id,partId:n.partId,measureIndex:n.measureIndex,voice:n.voice,midi:pitch,beat,duration:n.grace?0.15:Number(n.duration),velocity:Math.min(127,Math.max(1,dynamic?.velocity??88)),grace:n.grace,segments:[{id:n.id,beat,duration:n.grace?0.15:Number(n.duration)}]};
      const key=`${n.partId}:${n.voice}:${pitch}`;
      if(n.ties.includes('stop')&&open.has(key)){const previous=open.get(key);previous.duration=event.beat+event.duration-previous.beat;previous.segments.push(...event.segments);if(!n.ties.includes('start'))open.delete(key);continue;}
      events.push(event);if(n.ties.includes('start'))open.set(key,event);
    }
  }
  return {events,tempos,totalBeats:total,measureBeats:starts,parts:parts()};
}
(globalThis as any).SourceScoreCore={call(method:string,args:any={}) {
  try {
    let value:any;
    switch(method){
      case 'open':{const candidate=new FastDocument(args.source);value={title:candidate.model.title,eventCount:candidate.model.notes.size,parts:parts(candidate),initialTempo:(()=>{for(const p of candidate.model.parts)for(const m of p.measures)for(const d of children(m.node,'direction')){const bpm=Number(child(d,'sound')?.attributes.tempo);if(Number.isFinite(bpm)&&bpm>0)return bpm;}return 100;})(),...state([],candidate,true)};doc=candidate;break;}
      case 'new-score':value=newScore(args.title,args.instruments,args.bars,args.beats,args.unit);break;
      case 'page':value={...doc.renderSlice(args.start,args.count,args.partId),start:args.start,notes:doc.notes(args.start,args.count,args.partId).map(viewNote),revision:doc.revision};break;
      case 'note':value=viewNote(doc.note(args.id));break;
      case 'adjacent':{const current=args.id?doc.note(args.id):undefined;const list=doc.notes(0,doc.model.measures,current?.partId).filter(n=>!current||(n.staff===current.staff&&n.voice===current.voice));const index=current?list.findIndex(n=>n.id===current.id)+args.delta:0;value=viewNote(list[Math.max(0,Math.min(list.length-1,index))]);break;}
      case 'input-next':{const current=doc.note(args.id),list=doc.notes(0,doc.model.measures,current.partId).filter(n=>n.voice===current.voice&&n.staff===current.staff&&!n.chord&&!n.grace);value=viewNote(list.find(n=>n.measureIndex>current.measureIndex||n.measureIndex===current.measureIndex&&n.onset.compare(current.onset.add(current.duration))>=0)??current);break;}
      case 'semitone':doc.semitone(args.ids,args.delta);value=state(args.ids);break;
      case 'octave':doc.octave(args.ids,args.delta);value=state(args.ids);break;
      case 'drag':doc.diatonic(args.ids,args.delta);value=state(args.ids);break;
      case 'pitch':doc.editPitches(new Map([[args.id,args.pitch]]));value=state([args.id]);break;
      case 'accidental':doc.accidental(args.ids,args.alter);value=state(args.ids);break;
      case 'respell':doc.respell(args.id,args.direction);value=state([args.id]);break;
      case 'plan-duration':value=doc.planDuration(args.id,args.type,args.dots);break;
      case 'duration':doc.duration(args.plan);value=state(args.plan.ids);break;
      case 'voice':doc.voice(args.id,args.voice);value=state([args.id]);break;
      case 'input':{const n=doc.note(args.id);if(args.letter)args.pitch=keyboardPitch(args.id,args.letter,args.alter??null);if(args.pitch)args.pitch.alter=args.pitch.alter??keyAlteration(n.keyFifths,args.pitch.step);const written=notatedTime(args.type,args.dots??0),desired=n.ratio&&written?written.mul(new Rational(n.ratio.normal,n.ratio.actual)):written;if(args.pitch&&n.pitch&&!args.chord&&!args.grace&&desired?.equals(n.duration)){doc.editPitches(new Map([[n.id,args.pitch]]));}else doc.structure(e=>args.pitch?e.input(args.id,args.pitch,args.type,args.dots??0,args.chord??false,args.grace??false):e.input(args.id,undefined,args.type,args.dots??0));value=state([args.id]);value.selection=args.grace?[args.id]:doc.selectionAfter.length?doc.selectionAfter:doc.model.notes.has(args.id)?[args.id]:[];break;}
      case 'delete':doc.structure(e=>e.delete(args.ids));value=state(args.ids);value.selection=args.ids.filter((id:string)=>doc.model.notes.has(id));break;
      case 'staff':doc.structure(e=>e.moveStaff(args.id,args.staff));value=state([args.id]);break;
      case 'create-voice':doc.structure(e=>e.createVoice(args.partId,args.measureIndex,args.staff,args.voice));value=state();break;
      case 'insert-bar':doc.structure(e=>e.insertBar(args.index));value=state();break;
      case 'delete-bar':doc.structure(e=>e.deleteBar(args.index));value=state();break;
      case 'tuplet':doc.structure(e=>e.tuplet(args.id,args.actual,args.normal));value=state();break;
      case 'resize':doc.structure(e=>e.resize(args.id,args.type,args.dots));value=state();break;
      case 'items':value=new NotationEditor(doc.model).items(args.partId,args.measureIndex);break;
      case 'copy':value=copyNotes(parseCurrent(),args.ids);break;
      case 'paste':doc.structure(e=>pasteNotes(e.model,args.id,args.payload));value=state();break;
      case 'item-property':doc.structure(e=>new NotationEditor(e.model).property(args.id,args.key,args.value));value=state();break;
      case 'delete-item':doc.structure(e=>new NotationEditor(e.model).deleteItem(args.id));value=state();break;
      case 'marking':doc.structure(e=>new NotationEditor(e.model).marking(args.id,args.kind,args.symbol??'',args.text??''));value=state([args.id]);break;
      case 'span':doc.structure(e=>new NotationEditor(e.model).span(args.ids,args.kind));value=state(args.ids);break;
      case 'signature':doc.structure(e=>{if(args.kind!=='time')return new NotationEditor(e.model).signature(args.partId,args.index,args.staff,args.kind,args.values);const plans=e.model.parts.map(p=>new NotationEditor(e.model).signature(p.id,args.index,1,args.kind,args.values));return {label:'Set score time signature',allowTiming:true,fitRests:true,patches:plans.flatMap(p=>p.patches)};});value=state();break;
      case 'undo':doc.undo();value=state(args.ids??[]);break;
      case 'redo':doc.redo();value=state(args.ids??[]);break;
      case 'source':value=doc.source;break;
      case 'validate-save':value=doc.validateSave();break;
      case 'mark-saved':doc.markSaved();value=state();break;
      case 'playback':value=playback();break;
      default:throw new Error('Unknown source operation.');
    }
    if(value&&typeof value==='object'&&'dirty' in value&&Array.isArray(value.notes)&&Array.isArray(args.selectionIds)){
      const selected=(value.selection?.length?value.selection:args.selectionIds).filter((id:string)=>doc.model.notes.has(id));
      value.selection=selected;
      value.notes=[...new Set([...value.notes.map((n:any)=>n.id),...selected])].map(id=>viewNote(doc.note(id as string)));
    }
    return JSON.stringify({ok:true,value});
  }catch(error){return JSON.stringify({ok:false,error:error instanceof Error?error.message:String(error)});}
}};
function parseCurrent(){doc.structure(()=>({label:'Prepare clipboard',patches:[]}));return doc.model;}
