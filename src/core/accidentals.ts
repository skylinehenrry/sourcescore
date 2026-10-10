import { keyAlteration, type Pitch, type ScoreModel, type ScoreNote } from './model';
import { child,setField,ScoreError,type Patch } from './xml';
import { tieTypes } from './pitch-links';

const names: Record<number, string> = { '-2': 'flat-flat', '-1': 'flat', 0: 'natural', 1: 'sharp', 2: 'double-sharp' };
export function courtesyAccidental(note: ScoreNote) {
  const a = child(note.node, 'accidental');
  return !!a && ['cautionary', 'editorial', 'parentheses', 'bracket'].some(k => a.attributes[k] === 'yes');
}
/** The alter field is absolute pitch; accidental is only the printed symbol. */
export function automaticAccidental(model: ScoreModel, note: ScoreNote, pitch: Pitch, currentPitch: (n: ScoreNote) => Pitch | undefined) {
  if (courtesyAccidental(note) || note.nonTraditionalKey) return names[pitch.alter];
  if (tieTypes(note).has('stop')) return '';
  const measure = model.parts.find(p => p.id === note.partId)!.measures[note.measureIndex];
  const samePosition = (n: ScoreNote) => {
    const p = currentPitch(n);
    return n.staff === note.staff && n.keyContext === note.keyContext && p?.step === pitch.step && p.octave === pitch.octave;
  };
  const simultaneous = measure.notes.filter(n => n.id !== note.id && samePosition(n) && !n.grace && !note.grace && n.onset.equals(note.onset));
  if (simultaneous.some(n => currentPitch(n)!.alter !== pitch.alter)) return names[pitch.alter];
  const previous = measure.notes.filter(n => samePosition(n) && (n.onset.compare(note.onset) < 0 || n.grace && n.index < note.index && n.onset.equals(note.onset)) && (!tieTypes(n).has('stop') || courtesyAccidental(n))).sort((a, b) => a.onset.compare(b.onset) || a.index - b.index);
  let active: number | undefined = keyAlteration(note.keyFifths, pitch.step);
  const last = previous.at(-1);
  if (last) {
    const values = new Set(previous.filter(n => n.onset.equals(last.onset)).map(n => currentPitch(n)!.alter));
    active = values.size === 1 ? [...values][0] : undefined;
  }
  return active === pitch.alter ? '' : names[pitch.alter];
}

const noteOrder=['grace','cue','chord','pitch','unpitched','rest','duration','tie','instrument','footnote','level','voice','type','dot','accidental','time-modification','stem','notehead','notehead-text','staff','beam','notations','lyric','play','listen'];
export function printedAccidentalPatches(source:string,node:ScoreNote['node'],current:string,required:string):Patch[] {
  if(current===required)return [];
  if(required)return [setField(source,node,'accidental',required,noteOrder,'Printed accidental')];
  const printed=child(node,'accidental');if(!printed)return [];
  if(/<!--|<!\[CDATA\[/.test(source.slice(printed.start,printed.end))||printed.children.length)throw new ScoreError('The redundant accidental contains annotations and cannot be removed safely.');
  return [{start:printed.start,end:printed.end,text:'',label:'Remove redundant accidental'}];
}

/** Structural changes can alter the accidental needed by an otherwise unchanged later note. */
export function structuralAccidentals(before:ScoreModel,after:ScoreModel):Patch[] {
  const changed=new Set<string>(),bars=new Map(after.parts.flatMap(p=>p.measures.map(m=>[m.id,m] as const)));
  for(const n of after.notes.values()){
    const old=before.notes.get(n.id);
    if(!old||JSON.stringify(old.pitch)!==JSON.stringify(n.pitch)||old.staff!==n.staff||old.keyFifths!==n.keyFifths||!old.onset.equals(n.onset))changed.add(after.parts.find(p=>p.id===n.partId)!.measures[n.measureIndex].id);
  }
  for(const n of before.notes.values())if(n.pitch&&!after.notes.has(n.id))changed.add(before.parts.find(p=>p.id===n.partId)!.measures[n.measureIndex].id);
  const patches:Patch[]=[];
  for(const id of changed){const bar=bars.get(id);if(!bar)continue;for(const n of bar.notes){
    if(!n.pitch||!Number.isInteger(n.pitch.alter)||Math.abs(n.pitch.alter)>2)continue;
    const old=before.notes.get(n.id),required=automaticAccidental(after,n,n.pitch,n=>n.pitch)??'';
    const previous=old?.pitch?automaticAccidental(before,old,old.pitch,n=>n.pitch):undefined;
    if(!old?.pitch||JSON.stringify(old.pitch)!==JSON.stringify(n.pitch)||old.staff!==n.staff||old.keyFifths!==n.keyFifths||previous!==required)patches.push(...printedAccidentalPatches(after.source,n.node,n.accidental,required));
  }}
  return patches;
}
