import { keyAlteration, type Pitch, type ScoreModel, type ScoreNote } from './model';
import { child } from './xml';
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
