import {FastDocument,midiPitch} from '../src/core/fast-document';
import {child,children,field} from '../src/core/xml';
let doc:FastDocument;
const viewNote=(n:any)=>({id:n.id,partId:n.partId,index:n.index,measureIndex:n.measureIndex,measureNumber:n.measureNumber,staff:n.staff,voice:n.voice,pitch:n.pitch??null,rest:n.rest,unpitched:n.unpitched,grace:n.grace,chord:n.chord,type:n.type,dots:n.dots,onset:Number(n.onset),duration:Number(n.duration),transpose:n.transpose,ties:n.ties,ratio:n.ratio??null});
function instrumentProgram(name:string) {
  const n=name.toLowerCase();
  for(const [words,program] of [[['piccolo'],72],[['flute','flauto'],73],[['oboe'],68],[['clarinet','clarinetto'],71],[['bassoon','fagott'],70],[['horn','corno'],60],[['trumpet','tromba'],56],[['trombone'],57],[['tuba'],58],[['timpani','timpano'],47],[['campan','glock'],9],[['piano','pianoforte'],0],[['violin','violino'],40],[['viola'],41],[['cello','violoncello'],42],[['bass','contrabass'],43],[['harp','arpa'],46]] as [string[],number][]) if(words.some(w=>n.includes(w)))return program;
  return 48;
}
function parts() {
  const source=doc.model.source,list=child(doc.model.root,'part-list');
  return doc.model.parts.map(p=>{
    const meta=list?children(list,'score-part').find(n=>n.attributes.id===p.id):undefined;
    const midi=meta?child(meta,'midi-instrument'):undefined;
    return {id:p.id,name:p.name,staves:p.staves,program:midi?Number(field(source,midi,'midi-program',String(instrumentProgram(p.name)+1)))-1:instrumentProgram(p.name),percussion:midi?field(source,midi,'midi-channel')==='10':false};
  });
}
function state(ids:string[]=[]) {
  return {dirty:doc.dirty,canUndo:doc.canUndo,canRedo:doc.canRedo,revision:doc.revision,label:doc.lastLabel,notes:ids.map(id=>viewNote(doc.note(id)))};
}
function playback() {
  const model=doc.model,lengths=Array.from({length:model.measures},(_,i)=>Math.max(...model.parts.map(p=>{const m=p.measures[i];return m?m.irregular?Number(m.extent):Math.max(Number(m.extent),...Array.from(m.expected.values()).map(r=>r?Number(r):0)):0;})));
  const starts:number[]=[];let total=0;for(const length of lengths){starts.push(total);total+=length;}
  const tempos:{beat:number;bpm:number}[]=[];
  const events:any[]=[];const open=new Map<string,any>();
  const dynamicValues:Record<string,number>={ppp:30,pp:42,p:54,mp:66,mf:80,f:96,ff:112,fff:124,sfz:116,fp:88};
  const dynamicChanges:{partId:string;staff:number;beat:number;velocity:number}[]=[];
  for(const p of model.parts) for(const m of p.measures) {
    for(const direction of children(m.node,'direction')) {const sound=child(direction,'sound');const following=m.notes.find(n=>n.node.start>direction.start);const beat=starts[m.index]+Number(following?.onset??0);const bpm=Number(sound?.attributes.tempo);if(bpm>0)tempos.push({beat,bpm});const dynamics=child(child(direction,'direction-type')??direction,'dynamics');const explicit=Number(sound?.attributes.dynamics);const velocity=explicit>0?Math.round(explicit*0.9):dynamics?dynamicValues[dynamics.children[0]?.local]:undefined;if(velocity)dynamicChanges.push({partId:p.id,staff:Number(field(model.source,direction,'staff','0')),beat,velocity});}
    for(const base of m.notes) {
      const n=doc.note(base.id);if(!n.pitch||n.rest)continue;
      const pitch=midiPitch(n.pitch)+n.transpose;if(pitch<0||pitch>127)continue;
      const beat=starts[m.index]+Number(n.onset),dynamic=dynamicChanges.filter(d=>d.partId===n.partId&&(d.staff===0||d.staff===n.staff)&&d.beat<=beat).at(-1);
      const event={id:n.id,partId:n.partId,measureIndex:n.measureIndex,voice:n.voice,midi:pitch,beat,duration:n.grace?0.15:Number(n.duration),velocity:Math.min(127,Math.max(1,dynamic?.velocity??88)),grace:n.grace};
      const key=`${n.partId}:${n.voice}:${pitch}`;
      if(n.ties.includes('stop')&&open.has(key)){const previous=open.get(key);previous.duration=event.beat+event.duration-previous.beat;if(!n.ties.includes('start'))open.delete(key);continue;}
      events.push(event);if(n.ties.includes('start'))open.set(key,event);
    }
  }
  return {events,tempos,totalBeats:total,measureBeats:starts,parts:parts()};
}
(globalThis as any).SourceScoreCore={call(method:string,args:any={}) {
  try {
    let value:any;
    switch(method){
      case 'open':doc=new FastDocument(args.source);value={title:doc.model.title,measureCount:doc.model.measures,eventCount:doc.model.notes.size,parts:parts(),initialTempo:(()=>{for(const p of doc.model.parts)for(const m of p.measures)for(const d of children(m.node,'direction')){const bpm=Number(child(d,'sound')?.attributes.tempo);if(bpm>0)return bpm;}return 100;})(),diagnostics:doc.model.diagnostics,measureLabels:doc.model.parts[0].measures.map(m=>m.number),...state()};break;
      case 'page':value={...doc.renderSlice(args.start,args.count,args.partId),notes:doc.notes(args.start,args.count,args.partId).map(viewNote),revision:doc.revision};break;
      case 'note':value=viewNote(doc.note(args.id));break;
      case 'adjacent':{const current=args.id?doc.note(args.id):undefined;const list=doc.notes(0,doc.model.measures,current?.partId).filter(n=>!current||(n.staff===current.staff&&n.voice===current.voice));const index=current?list.findIndex(n=>n.id===current.id)+args.delta:0;value=viewNote(list[Math.max(0,Math.min(list.length-1,index))]);break;}
      case 'semitone':doc.semitone(args.ids,args.delta);value=state(args.ids);break;
      case 'octave':doc.octave(args.ids,args.delta);value=state(args.ids);break;
      case 'drag':doc.diatonic(args.ids,args.delta);value=state(args.ids);break;
      case 'pitch':doc.editPitches(new Map([[args.id,args.pitch]]));value=state([args.id]);break;
      case 'accidental':doc.accidental(args.ids,args.alter);value=state(args.ids);break;
      case 'respell':doc.respell(args.id,args.direction);value=state([args.id]);break;
      case 'plan-duration':value=doc.planDuration(args.id,args.type,args.dots);break;
      case 'duration':doc.duration(args.plan);value=state(args.plan.ids);break;
      case 'voice':doc.voice(args.id,args.voice);value=state([args.id]);break;
      case 'undo':doc.undo();value=state(args.ids??[]);break;
      case 'redo':doc.redo();value=state(args.ids??[]);break;
      case 'source':value=doc.source;break;
      case 'validate-save':value=doc.validateSave();break;
      case 'mark-saved':doc.markSaved();value=state();break;
      case 'playback':value=playback();break;
      default:throw new Error('Unknown source operation.');
    }
    return JSON.stringify({ok:true,value});
  }catch(error){return JSON.stringify({ok:false,error:error instanceof Error?error.message:String(error)});}
}};
