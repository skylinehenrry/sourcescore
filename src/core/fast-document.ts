import { ScoreDocument, pitchText, type EditPlan } from './editor';
import { parseScore, changedEvents, keyAlteration, type Pitch, type ScoreNote, type Step } from './model';
import { applyPatches, child, children, encodeXml, field, parseXml, qualified, setField, scalarPatch, ScoreError, type Patch } from './xml';
import { PitchLinks, tieTypes, tiedElements, nextFret } from './pitch-links';
import { automaticAccidental,printedAccidentalPatches,structuralAccidentals } from './accidentals';
import {captureIdentities,restoreIdentities,patchedIdentities,type IdentitySnapshot} from './identity';
import {StructureEditor,inheritedAttributes,type StructuralEdit} from './structure';
import {octaveShiftContext} from './render-spans';

const order = ['grace','cue','chord','pitch','unpitched','rest','duration','tie','instrument','footnote','level','voice','type','dot','accidental','time-modification','stem','notehead','notehead-text','staff','beam','notations','lyric','play','listen'];
const accidentals: Record<number,string> = { '-2':'flat-flat','-1':'flat','0':'natural','1':'sharp','2':'double-sharp' };
const steps: Step[] = ['C','D','E','F','G','A','B'];
const semis: Record<Step,number> = {C:0,D:2,E:4,F:5,G:7,A:9,B:11};
export const midiPitch = (pitch: Pitch) => (pitch.octave + 1) * 12 + semis[pitch.step] + pitch.alter;
export function chromaticPitch(note: ScoreNote, delta: number): Pitch {
  if (!note.pitch) throw new ScoreError('Select a pitched note.');
  const midi = midiPitch(note.pitch) + delta;
  const candidates: {pitch:Pitch; cost:number}[] = [];
  const prefer = note.keyFifths ? Math.sign(note.keyFifths) : Math.sign(delta);
  for (let octave = Math.floor(midi / 12) - 2; octave <= Math.floor(midi / 12); octave++) for (const step of steps) {
    const alter = midi - ((octave + 1) * 12 + semis[step]);
    if (octave < 0 || octave > 9 || Math.abs(alter) > 2) continue;
    const inKey = !note.nonTraditionalKey && alter === keyAlteration(note.keyFifths,step);
    const cost = (inKey ? 0 : 8) + Math.abs(alter)*3 + (alter && Math.sign(alter)!==prefer ? 2 : 0);
    candidates.push({pitch:{step,alter,octave},cost});
  }
  candidates.sort((a,b)=>a.cost-b.cost);
  if (!candidates.length) throw new ScoreError('This pitch is outside the supported octave range.');
  return candidates[0].pitch;
}
interface LocalState { xml:string; pitch:Pitch; accidental:string }
type History = { kind:'pitch'; label:string; before:Map<string,LocalState>; after:Map<string,LocalState> } | { kind:'full'; label:string; before:string; after:string;beforeIds:IdentitySnapshot;afterIds:IdentitySnapshot };

/** Persistent source anchors plus note-local overrides. No score-wide parse on pitch input. */
export class FastDocument {
  base: ScoreDocument;
  private overrides = new Map<string,LocalState>();
  private history:History[]=[];
  private cursor=0;
  private saved:string;
  private savedIds:IdentitySnapshot;
  private composed?:string;
  private dirtyState=false;
  revision=0;
  lastLabel='';
  lastChangedIds:string[]=[];
  private links?:PitchLinks;
  private nextIdentity=1;
  lastStructural=false;
  selectionAfter:string[]=[];
  constructor(source:string) { this.base=new ScoreDocument(source); this.saved=source;this.savedIds=captureIdentities(this.model); }
  get model() { return this.base.model; }
  get dirty() { return this.dirtyState; }
  get canUndo() { return this.cursor>0; }
  get canRedo() { return this.cursor<this.history.length; }
  get source() { return this.composed ??= this.sourceRange(0,this.model.source.length); }
  sourceRange(start:number,end:number) {
    const patches = [...this.overrides].flatMap(([id,state])=>{
      const node=this.base.note(id).node;
      return node.start>=start && node.end<=end ? [{start:node.start-start,end:node.end-start,text:state.xml,label:'Local note correction'}] : [];
    });
    return applyPatches(this.model.source.slice(start,end),patches);
  }
  note(id:string):ScoreNote {
    const original=this.base.note(id), updated=this.overrides.get(id);
    return updated ? {...original,pitch:{...updated.pitch},accidental:updated.accidental} : original;
  }
  notes(start=0,count=this.model.measures,partId?:string) {
    return this.model.parts.filter(p=>!partId||p.id===partId).flatMap(p=>p.measures.slice(start,start+count).flatMap(m=>m.notes.map(n=>this.note(n.id))));
  }
  private local(id:string):LocalState {
    const note=this.note(id);
    if (!note.pitch) throw new ScoreError('Select a pitched note.');
    return this.overrides.get(id) ?? {xml:this.model.source.slice(note.node.start,note.node.end),pitch:{...note.pitch},accidental:note.accidental};
  }
  private wrapper(note:ScoreNote) {
    const namespaces = new Map<string,string>();
    const ancestors=[]; for(let n=note.node.parent;n;n=n.parent) ancestors.push(n);
    for(const n of ancestors.reverse()) for(const [key,v] of Object.entries(n.attributes)) if(key==='xmlns'||key.startsWith('xmlns:')) namespaces.set(key,v);
    return `<source-root ${[...namespaces].map(([key,v])=>`${key}="${encodeXml(v)}"`).join(' ')}>`;
  }
  editPitches(updates:Map<string,Pitch>) {
    this.lastStructural=false;this.selectionAfter=[];
    this.lastChangedIds=[];
    const coordinated=new Map<string,Pitch>();
    for(const [id,pitch] of updates) {
      const note=this.note(id);
      if(note.tiedNotation&&(!tiedElements(note).length||tiedElements(note).some(e=>!['start','stop','continue','let-ring'].includes(e.attributes.type))))throw new ScoreError('This note has unrecognized tie notation. Its original pitch and notation were preserved.');
      const chain=tieTypes(note).size ? (this.links??=new PitchLinks(this.model)).chain(note) : [id];
      for(const linked of chain) {
        const other=coordinated.get(linked);
        if(other&&midiPitch(other)!==midiPitch(pitch)) throw new ScoreError('The selected tie notes request conflicting pitches. Select one note in the chain; no notes were changed.');
        if(!other)coordinated.set(linked,pitch);
      }
    }
    const before=new Map<string,LocalState>(),after=new Map<string,LocalState>();
    for(const [id,pitch] of coordinated) {
      const note=this.note(id), current=this.local(id);
      if(!Number.isInteger(note.pitch!.alter)||!accidentals[note.pitch!.alter]) throw new ScoreError('Microtonal pitch editing is not supported.');
      if(this.model.diagnostics.some(d=>['NOTE_CARDINALITY','NOTE_KIND','PITCH'].includes(d.code)&&d.noteId===id)) throw new ScoreError('Invalid or duplicate note fields make this event ambiguous.');
      if(!steps.includes(pitch.step)||!Number.isInteger(pitch.octave)||pitch.octave<0||pitch.octave>9||!accidentals[pitch.alter]) throw new ScoreError('Choose an exactly representable written pitch.');
      if(JSON.stringify(current.pitch)===JSON.stringify(pitch)) continue;
      const prefix=this.wrapper(note), text=prefix+current.xml+'</source-root>', root=parseXml(text).children[0];
      const pitchNode=child(root,'pitch'); if(!pitchNode) throw new ScoreError('This event has no editable pitch.');
      const accidental=automaticAccidental(this.model,note,pitch,n=>coordinated.get(n.id)??this.note(n.id).pitch);
      const patches:Patch[]=[setField(text,pitchNode,'step',pitch.step,['step','alter','octave'],'Step'),setField(text,pitchNode,'octave',String(pitch.octave),['step','alter','octave'],'Octave')];
      const printed=child(root,'accidental');
      if(accidental)patches.push(setField(text,root,'accidental',accidental,order,'Printed accidental'));
      else if(printed){if(/<!--|<!\[CDATA\[/.test(text.slice(printed.start,printed.end))||printed.children.length)throw new ScoreError('The redundant accidental contains annotations and cannot be removed safely.');patches.push({start:printed.start,end:printed.end,text:'',label:'Remove redundant accidental'});}
      for(const fret of nextFret(text,root,current.pitch,pitch)) patches.push(scalarPatch(text,fret.element,String(fret.value),'Coordinated fret'));
      if(pitch.alter!==0||child(pitchNode,'alter')) patches.push(setField(text,pitchNode,'alter',String(pitch.alter),['step','alter','octave'],'Alteration'));
      const candidate=applyPatches(text,patches); const checked=parseXml(candidate).children[0], checkedPitch=child(checked,'pitch')!;
      if(field(candidate,checkedPitch,'step')!==pitch.step||Number(field(candidate,checkedPitch,'alter','0'))!==pitch.alter||Number(field(candidate,checkedPitch,'octave'))!==pitch.octave) throw new ScoreError('The local pitch patch failed validation.');
      before.set(id,current); after.set(id,{xml:candidate.slice(prefix.length,-'</source-root>'.length),pitch:{...pitch},accidental});
    }
    const bars=new Map<string,ScoreNote[]>();
    for(const id of after.keys()){const n=this.note(id),key=`${n.partId}:${n.measureIndex}:${n.staff}`;bars.set(key,this.model.parts.find(p=>p.id===n.partId)!.measures[n.measureIndex].notes.filter(p=>p.staff===n.staff));}
    for(const notes of bars.values())for(const n of notes){
      if(after.has(n.id)||!n.pitch||!Number.isInteger(n.pitch.alter)||Math.abs(n.pitch.alter)>2)continue;
      const pitch=this.note(n.id).pitch!,was=automaticAccidental(this.model,n,pitch,n=>this.note(n.id).pitch),required=automaticAccidental(this.model,n,pitch,n=>coordinated.get(n.id)??this.note(n.id).pitch);
      if(was===required)continue;
      const current=this.local(n.id),prefix=this.wrapper(n),text=prefix+current.xml+'</source-root>',root=parseXml(text).children[0],patches=printedAccidentalPatches(text,root,current.accidental,required??'');
      if(!patches.length)continue;
      const changed=applyPatches(text,patches);before.set(n.id,current);after.set(n.id,{xml:changed.slice(prefix.length,-'</source-root>'.length),pitch:{...pitch},accidental:required??''});
    }
    if(!after.size) return;
    const label=coordinated.size===1?`Pitch ${pitchText([...coordinated.values()][0])}`:`Change ${coordinated.size} connected pitches`;
    this.record({kind:'pitch',label,before,after});
    this.applyStates(after); this.dirtyState=true;
  }
  private record(record:History) { this.history.splice(this.cursor); this.history.push(record); this.cursor++; this.lastLabel=record.label; }
  private applyStates(states:Map<string,LocalState>) {
    this.lastChangedIds=[...states.keys()];
    for(const [id,state] of states) {
      const node=this.base.note(id).node;
      if(state.xml===this.model.source.slice(node.start,node.end)) this.overrides.delete(id); else this.overrides.set(id,state);
    }
    this.composed=undefined; this.revision++;
  }
  semitone(ids:string[],delta:number) { this.editPitches(new Map(ids.filter(id=>this.note(id).pitch).map(id=>[id,chromaticPitch(this.note(id),delta)]))); }
  octave(ids:string[],delta:number) { this.editPitches(new Map(ids.filter(id=>this.note(id).pitch).map(id=>[id,{...this.note(id).pitch!,octave:this.note(id).pitch!.octave+delta}]))); }
  diatonic(ids:string[],delta:number) {
    const updates=new Map<string,Pitch>();
    for(const id of ids) { const n=this.note(id); if(!n.pitch) continue; const index=n.pitch.octave*7+steps.indexOf(n.pitch.step)+delta; const step=steps[((index%7)+7)%7]; updates.set(id,{step,octave:Math.floor(index/7),alter:step===n.pitch.step?n.pitch.alter:keyAlteration(n.keyFifths,step)}); }
    this.editPitches(updates);
  }
  accidental(ids:string[],alter:number) { this.editPitches(new Map(ids.filter(id=>this.note(id).pitch).map(id=>[id,{...this.note(id).pitch!,alter}]))); }
  respell(id:string,direction=1) {
    const note=this.note(id); if(!note.pitch) throw new ScoreError('Select a pitched note.');
    const index=note.pitch.octave*7+steps.indexOf(note.pitch.step)+direction,step=steps[((index%7)+7)%7],octave=Math.floor(index/7);
    this.editPitches(new Map([[id,{step,octave,alter:midiPitch(note.pitch)-((octave+1)*12+semis[step])}]]));
  }
  private rebase(source:string,ids:IdentitySnapshot=captureIdentities(this.model)) { this.base=new ScoreDocument(source);restoreIdentities(this.model,ids); this.links=undefined; this.lastChangedIds=[]; this.overrides.clear(); this.composed=source; this.revision++; }
  private flush() { if(this.overrides.size) this.rebase(this.source); }
  planDuration(id:string,type:string,dots:number) { this.flush(); return {...this.base.planDuration(id,type as any,dots),revision:this.revision}; }
  duration(plan:EditPlan) { if(plan.revision!==this.revision)throw new ScoreError('The score changed while this operation was being previewed. Choose the duration again.');const before=this.source,beforeIds=captureIdentities(this.model); this.base.applyPlan({...plan,revision:this.base.revision}); const after=this.base.source; if(before!==after) {this.record({kind:'full',label:plan.label,before,after,beforeIds,afterIds:captureIdentities(this.model)});this.rebase(after);this.lastStructural=true;this.selectionAfter=plan.ids;this.dirtyState=true;} }
  voice(id:string,voice:string) { this.flush(); const before=this.source,beforeIds=captureIdentities(this.model); this.base.changeVoice(id,voice); const after=this.base.source; if(before!==after) {this.record({kind:'full',label:`Voice ${voice}`,before,after,beforeIds,afterIds:captureIdentities(this.model)});this.rebase(after);this.lastStructural=true;this.selectionAfter=[id];this.dirtyState=true;} }
  undo() { if(!this.canUndo)return;const record=this.history[--this.cursor];this.lastStructural=record.kind==='full';this.selectionAfter=[];if(record.kind==='pitch')this.applyStates(record.before);else this.rebase(record.before,record.beforeIds);this.lastLabel='Undo '+record.label;this.dirtyState=this.source!==this.saved; }
  redo() { if(!this.canRedo)return;const record=this.history[this.cursor++];this.lastStructural=record.kind==='full';this.selectionAfter=[];if(record.kind==='pitch')this.applyStates(record.after);else this.rebase(record.after,record.afterIds);this.lastLabel='Redo '+record.label;this.dirtyState=this.source!==this.saved; }
  structure(operation:(editor:StructureEditor)=>StructuralEdit){this.flush();this.lastStructural=false;this.selectionAfter=[];this.lastChangedIds=[];this.applyStructure(operation(new StructureEditor(this.model)));}
  applyStructure(plan:StructuralEdit){
    const before=this.source,beforeModel=this.model,beforeIds=captureIdentities(beforeModel);let after=applyPatches(before,plan.patches);if(after===before)return;
    let candidate=parseScore(after);patchedIdentities(beforeModel,candidate,plan.patches,kind=>`${kind}:${this.nextIdentity++}`,plan.retained);
    let cursorId:string|undefined;if(plan.cursor){const delta=plan.patches.filter(p=>p.start<plan.cursor!.start&&p.end<=plan.cursor!.start).reduce((sum,p)=>sum+p.text.length-(p.end-p.start),0);const at=plan.cursor.start+delta+plan.cursor.relative;cursorId=[...candidate.notes.values()].find(n=>n.node.start===at)?.id;}
    if(plan.fitRests){const previousBars=new Map(beforeModel.parts.flatMap(p=>p.measures.map(m=>[m.id,m] as const))),changed=new Set<string>();for(const p of candidate.parts)for(const m of p.measures){const old=previousBars.get(m.id);if(old&&[...new Set([...old.expected.keys(),...m.expected.keys()])].some(staff=>String(old.expected.get(staff))!==String(m.expected.get(staff))))changed.add(m.id);}
      const fit=new StructureEditor(candidate).fitEmptyBars(changed);if(fit.patches.length){const fitted=applyPatches(after,fit.patches);if(fitted!==after){const previous=candidate;candidate=parseScore(fitted);patchedIdentities(previous,candidate,fit.patches,kind=>`${kind}:${this.nextIdentity++}`,fit.retained);after=fitted;}}}
    const accidentalChanges=structuralAccidentals(beforeModel,candidate);if(accidentalChanges.length){const ids=captureIdentities(candidate);after=applyPatches(after,accidentalChanges);candidate=parseScore(after);restoreIdentities(candidate,ids);}
    const signature=(d:any)=>`${d.key}:${d.actual??''}:${d.expected??''}`,old=new Set(beforeModel.diagnostics.filter(d=>d.severity==='error').map(signature));
    const timing=new Set(['INCOMPLETE','OVERFILLED','FORWARD','VOICE_OVERLAP','NOTATION_DURATION']);
    const added=candidate.diagnostics.find(d=>d.severity==='error'&&!old.has(signature(d))&&!(plan.allowTiming&&timing.has(d.code)));if(added)throw new ScoreError('Edit rejected: '+added.message);
    const afterIds=captureIdentities(candidate);this.record({kind:'full',label:plan.label,before,after,beforeIds,afterIds});this.rebase(after,afterIds);this.lastStructural=true;this.dirtyState=true;this.selectionAfter=[];
    if(cursorId&&this.model.notes.has(cursorId))this.selectionAfter=[cursorId];
    this.lastChangedIds=this.selectionAfter;
  }
  validateSave() {
    const candidate=parseScore(this.source), initial=parseScore(this.saved);
    restoreIdentities(candidate,captureIdentities(this.model));restoreIdentities(initial,this.savedIds);
    const signature=(d:any)=>`${d.key}:${d.actual??''}:${d.expected??''}`;
    const old=new Set(initial.diagnostics.filter(d=>d.severity==='error').map(signature));
    const added=candidate.diagnostics.find(d=>d.severity==='error'&&!old.has(signature(d)));
    if(added)throw new ScoreError(`Saving blocked: ${added.message}`);
    return {existing:candidate.diagnostics.filter(d=>d.severity==='error').length};
  }
  markSaved(){this.saved=this.source;this.savedIds=captureIdentities(this.model);this.dirtyState=false;}
  renderSlice(start:number,count:number,partId?:string) {
    const model=this.model,source=model.source;
    let xml=source.slice(model.root.start,model.root.openEnd)+model.root.children.filter(c=>c.local!=='part').map(c=>source.slice(c.start,c.end)).join('');
    const noteIds:string[]=[];
    for(const part of model.parts.filter(p=>!partId||p.id===partId)) {
      xml+=source.slice(part.node.start,part.node.openEnd);
      const visible=part.measures.slice(start,start+count),spans=octaveShiftContext(source,part,start,count);
      for(const [i,measure] of visible.entries()) {
        let raw=this.sourceRange(measure.node.start,measure.node.end);
        if(i===0) {const tag=qualified(measure.node,'attributes'),at=measure.node.openEnd-measure.node.start;const attributes=start>0&&measure.renderAttributes.length?`<${tag}>${inheritedAttributes(measure.renderAttributes)}</${tag}>`:'';raw=raw.slice(0,at)+attributes+spans.opening+raw.slice(at);}
        if(i===visible.length-1&&spans.closing) {const at=raw.lastIndexOf(`</${measure.node.name}>`);raw=raw.slice(0,at)+spans.closing+raw.slice(at);}
        xml+=raw;noteIds.push(...measure.notes.map(n=>n.id));
      }
      xml+=`</${part.node.name}>`;
    }
    return {xml:xml+`</${model.root.name}>`,noteIds};
  }
}
