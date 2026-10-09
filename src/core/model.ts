import { Rational, ZERO, notatedTime } from './rational';
import { child, children, field, parseXml, value, ScoreError, type XmlElement } from './xml';

export type Step = 'C' | 'D' | 'E' | 'F' | 'G' | 'A' | 'B';
export interface Pitch { step: Step; alter: number; octave: number }
export interface Diagnostic {
  key: string; code: string; severity: 'error' | 'warning' | 'info'; message: string;
  partId: string; instrument: string; measureIndex: number; measure: string;
  staff?: number; voice?: string; noteId?: string; expected?: string; actual?: string;
}
export interface ScoreNote {
  id: string; index: number; partId: string; measureIndex: number; measureNumber: string;
  node: XmlElement; staff: number; voice: string; pitch?: Pitch; rest: boolean; unpitched: boolean;
  grace: boolean; chord: boolean; chordRoot: string; onset: Rational; duration: Rational;
  divisions: Rational; type: string; dots: number; accidental: string; segment: number;
  ratio?: { actual: number; normal: number }; keyFifths: number; transpose: number;
  ties: string[]; tiedNotation: boolean; beams: boolean; fullMeasureRest: boolean;
  linkedRhythm: boolean; fretted: boolean;
}
export interface ScoreMeasure {
  id: string; partId: string; index: number; number: string; node: XmlElement;
  notes: ScoreNote[]; expected: Map<number, Rational | undefined>;
  irregular: boolean; renderAttributes: string[]; extent: Rational;
}
export interface ScorePart { id: string; name: string; index: number; staves: number; node: XmlElement; measures: ScoreMeasure[] }
export interface ScoreModel {
  source: string; root: XmlElement; title: string; parts: ScorePart[];
  notes: Map<string, ScoreNote>; measures: number; diagnostics: Diagnostic[];
}
const positiveDivisions = (s: string) => { const r = Rational.decimal(s); return r?.positive ? r : undefined; };
const forStaff = <T>(map: Map<number, T>, staff: number) => map.has(staff) ? map.get(staff) : map.get(0);
const descendant = (node: XmlElement, name: string): boolean => node.children.some(c => (c.local === name && c.namespace === node.namespace) || (c.namespace === node.namespace && descendant(c, name)));

export function parseScore(source: string): ScoreModel {
  const root = parseXml(source);
  if (root.local !== 'score-partwise') throw new ScoreError('Open a score-partwise .musicxml or .xml file. Timewise and compressed scores are not supported in this version.', 'UNSUPPORTED_FORMAT');
  const names = new Map(children(child(root, 'part-list') ?? root, 'score-part').map(p => [p.attributes.id, field(source, p, 'part-name', p.attributes.id)]));
  const title = field(source, child(root, 'work') ?? root, 'work-title') || field(source, root, 'movement-title', 'Untitled score');
  const score: ScoreModel = { source, root, title, parts: [], notes: new Map(), measures: 0, diagnostics: [] };
  const partIds = new Set<string>();
  for (const [partIndex, partNode] of children(root, 'part').entries()) {
    const id = partNode.attributes.id;
    if (!id || partIds.has(id)) throw new ScoreError('The score contains a missing or duplicate part identifier.', 'INVALID_STRUCTURE');
    partIds.add(id);
    const part: ScorePart = { id, index: partIndex, name: names.get(id) ?? id, node: partNode, staves: 1, measures: [] };
    score.parts.push(part);
    let divisions = new Rational(1), hasDivisions = false, transpose = 0;
    const timeState = new Map<number, Rational | undefined>();
    const keyState = new Map<number, number>();
    const attributeState = new Map<string, string>();
    for (const [measureIndex, measureNode] of children(partNode, 'measure').entries()) {
      const measure: ScoreMeasure = { id: `${partIndex}:${measureIndex}`, partId: id, index: measureIndex, number: measureNode.attributes.number ?? String(measureIndex + 1), node: measureNode, notes: [], expected: new Map(timeState), irregular: measureNode.attributes.implicit === 'yes' || measureNode.attributes['non-controlling'] === 'yes', renderAttributes: [...attributeState.values()], extent: ZERO };
      part.measures.push(measure);
      let cursor = ZERO, segment = 0, lastNote: ScoreNote | undefined;
      const forwards: { staff: number; end: Rational }[] = [];
      const divisionsChanges: Rational[] = [];
      const add = (code: string, message: string, note?: ScoreNote, detail: Partial<Diagnostic> = {}) => {
        const location = note?.id ?? `${measure.id}:${detail.staff ?? ''}:${detail.voice ?? ''}`;
        score.diagnostics.push({ key: `${code}:${location}`, code, severity: 'error', message, partId: id, instrument: part.name, measureIndex, measure: measure.number, staff: note?.staff, voice: note?.voice, noteId: note?.id, ...detail });
      };
      const readDuration = (element: XmlElement) => {
        const raw = field(source, element, 'duration');
        const ticks = positiveDivisions(raw);
        if (!ticks) { add('DURATION', 'Duration must be a positive decimal value.'); return ZERO; }
        if (!hasDivisions) add('DIVISIONS', 'A duration occurs before a valid divisions value.');
        return ticks.div(divisions);
      };
      for (const element of measureNode.children.filter(c => c.namespace === root.namespace)) {
        if (element.local === 'attributes') {
          for (const attribute of element.children.filter(c => c.namespace === root.namespace)) {
            const number = Number(attribute.attributes.number ?? 0);
            attributeState.set(`${attribute.local}:${number}`, source.slice(attribute.start, attribute.end));
            if (attribute.local === 'divisions') {
              const next = positiveDivisions(value(source, attribute));
              if (!next) add('DIVISIONS', 'Divisions must be a positive decimal value.');
              else { if (!divisions.equals(next) && cursor.positive) divisionsChanges.push(cursor); divisions = next; hasDivisions = true; segment++; }
            }
            if (attribute.local === 'staves') part.staves = Math.max(part.staves, Number(value(source, attribute)) || 1);
            if (attribute.local === 'transpose') transpose = Number(field(source, attribute, 'chromatic', '0')) + 12 * Number(field(source, attribute, 'octave-change', '0'));
            if (attribute.local === 'key') keyState.set(number, Number(field(source, attribute, 'fifths', '0')));
            if (attribute.local === 'time') {
              if (child(attribute, 'senza-misura') || child(attribute, 'interchangeable')) timeState.set(number, undefined);
              else {
                const beats = children(attribute, 'beats'); const units = children(attribute, 'beat-type');
                let total = ZERO, valid = beats.length > 0 && beats.length === units.length;
                beats.forEach((beat, i) => {
                  const terms = value(source, beat).split('+'); const denominator = Number(value(source, units[i]));
                  if (terms.some(t => !/^\s*\d+\s*$/.test(t)) || !Number.isSafeInteger(denominator) || denominator <= 0) valid = false;
                  else total = total.add(new Rational(terms.reduce((s, t) => s + Number(t), 0) * 4, denominator));
                });
                if (!valid || !total.positive) { add('TIME', 'The time signature cannot be interpreted safely.'); timeState.set(number, undefined); }
                else timeState.set(number, total);
              }
            }
          }
          measure.expected = new Map(timeState);
          lastNote = undefined;
        } else if (element.local === 'backup' || element.local === 'forward') {
          const duration = readDuration(element);
          const next = element.local === 'backup' ? cursor.sub(duration) : cursor.add(duration);
          if (next.compare(ZERO) < 0) add('BACKUP', 'A backup moves before the beginning of the measure.', undefined, { actual: next.wholeNotes() });
          if (element.local === 'backup' && divisionsChanges.some(point => point.compare(next) > 0 && point.compare(cursor) <= 0)) add('BACKUP_DIVISIONS', 'A backup crosses a mid-measure divisions change.');
          const forwardStaff = Number(field(source, element, 'staff', '1'));
          if (element.local === 'forward') forwards.push({ staff: forwardStaff, end: next });
          const expected = forStaff(timeState, forwardStaff);
          if (!measure.irregular && expected && next.compare(expected) > 0) add('FORWARD', 'A forward moves beyond the measure boundary.', undefined, { actual: next.wholeNotes(), expected: expected.wholeNotes() });
          cursor = next; segment++; lastNote = undefined;
          if (cursor.compare(measure.extent) > 0) measure.extent = cursor;
        } else if (element.local === 'note') {
          const grace = !!child(element, 'grace'), chord = !!child(element, 'chord');
          const pitchNode = child(element, 'pitch');
          const pitch = pitchNode ? { step: field(source, pitchNode, 'step') as Step, alter: Number(field(source, pitchNode, 'alter', '0')), octave: Number(field(source, pitchNode, 'octave', '-99')) } : undefined;
          const staff = Number(field(source, element, 'staff', '1')), voice = field(source, element, 'voice', '1');
          const duration = grace ? ZERO : readDuration(element);
          const noteId = `${partIndex}:${measureIndex}:${measure.notes.length}`;
          const modification = child(element, 'time-modification');
          const ratio = modification ? { actual: Number(field(source, modification, 'actual-notes')), normal: Number(field(source, modification, 'normal-notes')) } : undefined;
          const note: ScoreNote = {
            id: noteId, index: measure.notes.length, partId: id, measureIndex, measureNumber: measure.number, node: element, staff, voice, pitch,
            rest: !!child(element, 'rest'), unpitched: !!child(element, 'unpitched'), grace, chord,
            chordRoot: chord && lastNote ? lastNote.chordRoot : noteId,
            onset: chord && lastNote ? lastNote.onset : cursor, duration, divisions,
            type: field(source, element, 'type'), dots: children(element, 'dot').length, accidental: field(source, element, 'accidental'), segment,
            ratio, keyFifths: keyState.get(staff) ?? keyState.get(0) ?? 0, transpose,
            ties: children(element, 'tie').map(t => t.attributes.type), tiedNotation: descendant(element, 'tied'),
            beams: children(element, 'beam').length > 0, fullMeasureRest: child(element, 'rest')?.attributes.measure === 'yes',
            linkedRhythm: descendant(element, 'tuplet') || descendant(element, 'tremolo'), fretted: descendant(element, 'fret'),
          };
          measure.notes.push(note); score.notes.set(noteId, note); part.staves = Math.max(part.staves, staff);
          const singular = ['pitch', 'rest', 'unpitched', 'duration', 'voice', 'type', 'accidental', 'time-modification', 'staff', 'chord', 'grace'];
          if (singular.some(name => children(element, name).length > 1) || (pitchNode && ['step', 'alter', 'octave'].some(name => children(pitchNode, name).length > 1))) add('NOTE_CARDINALITY', 'A note has duplicate musical fields. Its meaning is ambiguous; local edits are blocked.', note);
          if ([pitchNode, child(element, 'rest'), child(element, 'unpitched')].filter(Boolean).length !== 1) add('NOTE_KIND', 'A note must have exactly one pitch, rest or unpitched value.', note);
          if (pitch && (!['C', 'D', 'E', 'F', 'G', 'A', 'B'].includes(pitch.step) || !Number.isInteger(pitch.octave) || pitch.octave < 0 || pitch.octave > 9 || !Number.isFinite(pitch.alter))) add('PITCH', 'This note has an invalid pitch representation.', note);
          if (!Number.isInteger(staff) || staff < 1) add('STAFF', 'Staff numbers must be positive integers.', note);
          if (chord && (!lastNote || lastNote.voice !== voice || lastNote.grace !== grace || (lastNote.rest || note.rest) || duration.compare(score.notes.get(note.chordRoot)!.duration) > 0)) add('CHORD', 'A chord member must follow a note in the same voice and cannot outlast its root.', note);
          if (ratio && (![ratio.actual, ratio.normal].every(n => Number.isSafeInteger(n) && n > 0))) add('TUPLET_RATIO', 'Tuplet ratios must be positive integers.', note);
          let written = notatedTime(note.type, note.dots);
          if (written && ratio && ratio.actual > 0 && ratio.normal > 0) written = written.mul(new Rational(ratio.normal, ratio.actual));
          if (!grace && !note.fullMeasureRest && written && !written.equals(duration) && !descendant(element, 'tremolo')) add('NOTATION_DURATION', ratio ? 'The note type, dots and tuplet ratio disagree with its duration.' : 'Written and sounding durations differ; verify whether this is intentional.', note, { severity: ratio ? 'error' : 'warning', expected: written.wholeNotes(), actual: duration.wholeNotes() });
          if (!chord && !grace) cursor = cursor.add(duration);
          const end = note.onset.add(duration);
          if (end.compare(measure.extent) > 0) measure.extent = end;
          lastNote = note;
        }
      }
      // Budget each staff by temporal extent, not the sum of simultaneous notes.
      // Partial secondary voices and cross-staff passages need no artificial rests.
      for (const staff of new Set(measure.notes.map(n => n.staff))) {
        const notes = measure.notes.filter(n => n.staff === staff && !n.grace);
        const expected = forStaff(timeState, staff);
        if (!notes.length || !expected || measure.irregular) continue;
        const actual = [...notes.map(n => n.onset.add(n.duration)), ...forwards.filter(f => f.staff === staff).map(f => f.end)].reduce((end, time) => time.compare(end) > 0 ? time : end, ZERO);
        if (actual.compare(expected) > 0) add('OVERFILLED', 'The staff extends beyond the time signature.', undefined, { staff, expected: expected.wholeNotes(), actual: actual.wholeNotes() });
        // A cross-staff voice may complete elsewhere; forward explicitly represents silent time.
        const crossStaff = notes.some(n => measure.notes.some(o => o.voice === n.voice && o.staff !== staff));
        const startsAtZero = notes.some(n => n.onset.equals(ZERO));
        if (actual.compare(expected) < 0 && startsAtZero && !crossStaff) add('INCOMPLETE', 'The staff ends before the expected measure duration.', undefined, { staff, expected: expected.wholeNotes(), actual: actual.wholeNotes() });
      }
      for (const voice of new Set(measure.notes.map(n => n.voice))) {
        const events = measure.notes.filter(n => n.voice === voice && !n.chord && !n.grace).sort((a, b) => a.onset.compare(b.onset));
        let end = ZERO;
        for (const note of events) { if (note.onset.compare(end) < 0) add('VOICE_OVERLAP', 'Independent events overlap in this voice without a chord relationship.', note); if (note.onset.add(note.duration).compare(end) > 0) end = note.onset.add(note.duration); }
      }
    }
    score.measures = Math.max(score.measures, part.measures.length);
    // Sounding ties are checked conservatively by written pitch and voice across measures.
    const openTies = new Map<string, ScoreNote>();
    for (const measure of part.measures) for (const note of measure.notes) {
      if (!note.pitch || note.grace) continue;
      const key = `${note.voice}:${note.pitch.step}:${note.pitch.alter}:${note.pitch.octave}`;
      if (note.ties.includes('stop')) {
        if (!openTies.has(key)) score.diagnostics.push({ key: `TIE:${note.id}`, code: 'TIE', severity: 'warning', message: 'Tie stop has no earlier matching written pitch in this voice.', partId: id, instrument: part.name, measureIndex: note.measureIndex, measure: note.measureNumber, staff: note.staff, voice: note.voice, noteId: note.id });
        openTies.delete(key);
      }
      if (note.ties.includes('start')) openTies.set(key, note);
    }
  }
  if (!score.parts.length || !score.measures) throw new ScoreError('No parts or measures were found.', 'INVALID_STRUCTURE');
  return score;
}

export const keyAlteration = (fifths: number, step: Step) => {
  const order = fifths > 0 ? ['F', 'C', 'G', 'D', 'A', 'E', 'B'] : ['B', 'E', 'A', 'D', 'G', 'C', 'F'];
  return order.slice(0, Math.min(7, Math.abs(fifths))).includes(step) ? Math.sign(fifths) : 0;
};
export function normalizedEvents(score: ScoreModel) {
  return [...score.notes.values()].map(n => ({ id: n.id, part: n.partId, measure: n.measureNumber, staff: n.staff, voice: n.voice, onset: n.onset.toString(), duration: n.duration.toString(), pitch: n.pitch, transpose: n.transpose, keyFifths: n.keyFifths, accidental: n.accidental, rest: n.rest, grace: n.grace, chord: n.chord, type: n.type, dots: n.dots, ratio: n.ratio, ties: n.ties }));
}
export function changedEvents(before: ScoreModel, after: ScoreModel) {
  const previous = new Map(normalizedEvents(before).map(e => [e.id, JSON.stringify(e)]));
  return normalizedEvents(after).filter(e => previous.get(e.id) !== JSON.stringify(e)).map(e => e.id);
}
