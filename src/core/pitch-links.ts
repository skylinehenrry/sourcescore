import { type Pitch, type ScoreModel, type ScoreNote } from './model';
import { child, children, field, ScoreError, type XmlElement } from './xml';
import { Rational, ZERO } from './rational';

const semis = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
export const writtenMidi = (p: Pitch) => (p.octave + 1) * 12 + semis[p.step] + p.alter;
export const tiedElements = (n: ScoreNote) => children(n.node, 'notations').flatMap(x => children(x, 'tied'));
export function tieTypes(n: ScoreNote) {
  const types=new Set([...n.ties, ...tiedElements(n).map(e => e.attributes.type)].filter(t => t === 'start' || t === 'stop'));
  if(tiedElements(n).some(e=>e.attributes.type==='continue')){types.add('start');types.add('stop');}
  return types;
}
function measureDurations(model: ScoreModel) {
  return Array.from({ length: model.measures }, (_, i) => model.parts.flatMap(p => {
    const m = p.measures[i];
    return !m ? [] : [m.extent, ...(m.irregular ? [] : [...m.expected.values()].filter((x): x is Rational => !!x))];
  }).reduce((a, b) => a.compare(b) > 0 ? a : b, ZERO));
}
export const measureLengths = (model: ScoreModel) => measureDurations(model).map(Number);

/** Build once per source revision. Connect by musical time, voice, sounding pitch and tie number.
 * Cross-staff connections are allowed; ambiguous/unmatched/conditional ties fail atomically.
 */
export class PitchLinks {
  private groups = new Map<string, string[]>();
  private problems = new Set<string>();
  constructor(model: ScoreModel) {
    const starts: Rational[] = []; let total = ZERO;
    for (const length of measureDurations(model)) { starts.push(total); total = total.add(length); }
    for (const part of model.parts) {
      const notes = part.measures.flatMap(m => m.notes).filter(n => n.pitch && tieTypes(n).size);
      const edges = new Map<string, Set<string>>(), incoming = new Map<string, string[]>();
      const timeKey = (n: ScoreNote, time: Rational) => `${n.voice}:${writtenMidi(n.pitch!) + n.transpose}:${time}`;
      const stops = new Map<string, ScoreNote[]>();
      for (const n of notes) {
        edges.set(n.id, new Set());
        if (tieTypes(n).has('stop')) {
          const key = timeKey(n, starts[n.measureIndex].add(n.onset));
          stops.set(key, [...(stops.get(key) ?? []), n]);
        }
        if (children(n.node, 'tie').some(e => e.attributes['time-only']) || n.grace) this.problems.add(n.id);
      }
      const numbers = (n: ScoreNote, type: string) => tiedElements(n).filter(e => e.attributes.type === type || e.attributes.type === 'continue').map(e => e.attributes.number ?? '1');
      for (const n of notes.filter(n => tieTypes(n).has('start'))) {
        const key = timeKey(n, starts[n.measureIndex].add(n.onset).add(n.duration));
        let candidates = (stops.get(key) ?? []).filter(next => next.id !== n.id);
        const ns = numbers(n, 'start');
        candidates = candidates.filter(next => { const nt = numbers(next, 'stop'); return !ns.length || !nt.length || ns.some(x => nt.includes(x)); });
        const sameStaff = candidates.filter(next => next.staff === n.staff);
        if (sameStaff.length === 1) candidates = sameStaff;
        if (candidates.length !== 1) { this.problems.add(n.id); continue; }
        const next = candidates[0];
        edges.get(n.id)!.add(next.id); edges.get(next.id)!.add(n.id);
        incoming.set(next.id, [...(incoming.get(next.id) ?? []), n.id]);
      }
      for (const n of notes) if (tieTypes(n).has('stop') && incoming.get(n.id)?.length !== 1) this.problems.add(n.id);
      const visited = new Set<string>();
      for (const n of notes) {
        if (visited.has(n.id)) continue;
        const component: string[] = [], pending = [n.id];
        while (pending.length) {
          const id = pending.pop()!; if (visited.has(id)) continue;
          visited.add(id); component.push(id); pending.push(...edges.get(id)!);
        }
        for (const id of component) this.groups.set(id, component);
      }
    }
  }
  chain(note: ScoreNote) {
    const ids = this.groups.get(note.id) ?? [note.id];
    if (ids.some(id => this.problems.has(id))) throw new ScoreError('This tie has a missing, ambiguous or repeat-dependent endpoint. Its connected pitches cannot be identified safely; no notes were changed.');
    return ids;
  }
}

export function fretFields(note: XmlElement) {
  return children(note, 'notations').flatMap(n => children(n, 'technical')).flatMap(n => children(n, 'fret').map(fret => ({ technical: n, fret })));
}
export function nextFret(source: string, root: XmlElement, before: Pitch, after: Pitch) {
  const result: { element: XmlElement; value: number }[] = [];
  const delta = writtenMidi(after) - writtenMidi(before);
  if (!delta) return result;
  for (const { technical, fret } of fretFields(root)) {
    const old = Number(field(source, technical, 'fret', 'NaN'));
    const string = Number(field(source, technical, 'string', 'NaN'));
    if (children(technical, 'fret').length !== 1 || children(technical, 'string').length !== 1 || !Number.isSafeInteger(old) || old < 0 || !Number.isSafeInteger(string) || string < 1 || child(technical, 'harmonic') || child(technical, 'bend')) throw new ScoreError('This tablature pitch needs an ordinary integer fret and a known string. Harmonic/bend fingerings need a coordinated fingering edit; no notes were changed.');
    const value = old + delta;
    if (!Number.isInteger(value) || value < 0) throw new ScoreError('That pitch is below the open string. Choose another pitch; changing strings is not supported by this edit.');
    result.push({ element: fret, value });
  }
  return result;
}
