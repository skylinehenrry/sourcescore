import type {ScoreModel} from './model';
import type {Patch} from './xml';

export interface IdentitySnapshot { [partId:string]: {id:string;notes:string[]}[] }
export const captureIdentities=(model:ScoreModel):IdentitySnapshot=>Object.fromEntries(model.parts.map(p=>[p.id,p.measures.map(m=>({id:m.id,notes:m.notes.map(n=>n.id)}))]));
export function restoreIdentities(model:ScoreModel, snapshot:IdentitySnapshot) {
  const names=new Map<string,string>();
  for(const part of model.parts)for(const measure of part.measures){
    const ids=snapshot[part.id]?.[measure.index];if(!ids)continue;
    names.set(measure.id,ids.id);measure.id=ids.id;
    for(const note of measure.notes){const id=ids.notes[note.index];if(id){names.set(note.id,id);note.id=id;}}
  }
  finish(model,names);
}
function finish(model:ScoreModel,names:Map<string,string>){
  for(const p of model.parts)for(const m of p.measures)for(const n of m.notes)n.chordRoot=names.get(n.chordRoot)??n.chordRoot;
  model.notes=new Map(model.parts.flatMap(p=>p.measures.flatMap(m=>m.notes.map(n=>[n.id,n] as const))));
  for(const d of model.diagnostics){if(d.noteId)d.noteId=names.get(d.noteId)??d.noteId;const m=model.parts.find(p=>p.id===d.partId)?.measures[d.measureIndex];if(m)d.key=`${d.code}:${d.noteId??`${m.id}:${d.staff??''}:${d.voice??''}`}`;}
}
export function patchedIdentities(before:ScoreModel,after:ScoreModel,patches:Patch[],allocate:(kind:string)=>string,retained:{id:string;start:number;relative?:number}[]=[]){
  const position=(at:number,keep=false)=>{
    let delta=0;
    for(const p of patches){if(p.start<p.end&&p.start<=at&&p.end>at&&!keep)return undefined;if(p.end<=at)delta+=p.text.length-(p.end-p.start);}
    return at+delta;
  };
  const notes=new Map<number,string>(),bars=new Map<number,string>();
  for(const p of before.parts)for(const m of p.measures){const at=position(m.node.start);if(at!==undefined)bars.set(at,m.id);for(const n of m.notes){const x=position(n.node.start);if(x!==undefined)notes.set(x,n.id);}}
  for(const r of retained){const at=position(r.start,true);if(at!==undefined)notes.set(at+(r.relative??0),r.id);}
  const mapping=new Map<string,string>();
  for(const p of after.parts)for(const m of p.measures){const id=bars.get(m.node.start)??allocate('bar');mapping.set(m.id,id);m.id=id;for(const n of m.notes){const id=notes.get(n.node.start)??allocate('note');mapping.set(n.id,id);n.id=id;}}
  finish(after,mapping);
}
