import { parseScore, changedEvents, keyAlteration, type Pitch, type ScoreModel, type ScoreNote, type Step, type Diagnostic } from './model';
import { NOTE_TYPES, Rational, notatedTime, type NoteType } from './rational';
import { applyPatches, child, children, field, insertPatch, qualified, scalarPatch, setField, ScoreError, type Patch } from './xml';
import {captureIdentities,restoreIdentities} from './identity';

const noteOrder = ['grace', 'cue', 'chord', 'pitch', 'unpitched', 'rest', 'duration', 'tie', 'instrument', 'footnote', 'level', 'voice', 'type', 'dot', 'accidental', 'time-modification', 'stem', 'notehead', 'notehead-text', 'staff', 'beam', 'notations', 'lyric', 'play', 'listen'];
const accidentalNames: Record<number, string> = { '-2': 'flat-flat', '-1': 'flat', '0': 'natural', '1': 'sharp', '2': 'double-sharp' };
const steps: Step[] = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
export const pitchText = (pitch?: Pitch) => pitch ? `${pitch.step}${({ '-2': '𝄫', '-1': '♭', '0': '', '1': '♯', '2': '𝄪' } as Record<number, string>)[pitch.alter] ?? `(${pitch.alter})`}${pitch.octave}` : 'Rest';
export const durationText = (type: string, dots: number) => `${dots === 1 ? 'Dotted ' : dots === 2 ? 'Double-dotted ' : ''}${type} ${type ? 'note' : ''}`;
export interface EditRecord { label: string; ids: string[]; forward: Patch[]; inverse: Patch[]; at: string }
export interface EditPlan { label: string; description: string; ids: string[]; patches: Patch[]; revision: number }
const signature = (d: Diagnostic) => `${d.key}:${d.actual ?? ''}:${d.expected ?? ''}`;

/** The renderer is never consulted by this editor or by the save path. */
export class ScoreDocument {
  model: ScoreModel;
  private savedSource: string;
  private baseline: Set<string>;
  private history: EditRecord[] = [];
  private cursor = 0;
  revision = 0;
  constructor(source: string) {
    this.model = parseScore(source); this.savedSource = source;
    this.baseline = new Set(this.model.diagnostics.filter(d => d.severity === 'error').map(signature));
  }
  get source() { return this.model.source; }
  get dirty() { return this.source !== this.savedSource; }
  get canUndo() { return this.cursor > 0; }
  get canRedo() { return this.cursor < this.history.length; }
  get changes() { return this.history.slice(0, this.cursor); }
  get undoLabel() { return this.history[this.cursor - 1]?.label; }
  note(id: string) { const note = this.model.notes.get(id); if (!note) throw new ScoreError('The selected note is no longer available.'); return note; }
  private unambiguous(note: ScoreNote) {
    if (this.model.diagnostics.some(d => d.code === 'NOTE_CARDINALITY' && d.noteId === note.id)) throw new ScoreError('This note has duplicate musical fields. Its meaning is ambiguous; no edit was applied.');
  }
  markSaved() { this.savedSource = this.source; this.baseline = new Set(this.model.diagnostics.filter(d => d.severity === 'error').map(signature)); }
  validateSave() {
    const invalid = this.model.diagnostics.filter(d => d.severity === 'error' && !this.baseline.has(signature(d)));
    if (invalid.length) throw new ScoreError(`Saving is blocked by a new validation error: ${invalid[0].message}`);
    return { existing: this.model.diagnostics.filter(d => d.severity === 'error').length };
  }
  private commit(plan: EditPlan) {
    if (plan.revision !== this.revision) throw new ScoreError('The score changed while this operation was being previewed. Choose the duration again.');
    const before = this.model;
    const patches = plan.patches.filter(p => before.source.slice(p.start, p.end) !== p.text).sort((a, b) => a.start - b.start || a.end - b.end);
    if (!patches.length) return;
    const source = applyPatches(before.source, patches);
    const after = parseScore(source);
    restoreIdentities(after,captureIdentities(before));
    const existing = new Set(before.diagnostics.filter(d => d.severity === 'error').map(signature));
    const introduced = after.diagnostics.find(d => d.severity === 'error' && !existing.has(signature(d)));
    if (introduced) throw new ScoreError(`The edit was not applied: ${introduced.instrument}, measure ${introduced.measure}: ${introduced.message}`);
    const allowed = new Set(plan.ids);
    if (changedEvents(before, after).some(id => !allowed.has(id))) throw new ScoreError('The edit would change another musical event. It has been rejected.');
    let offset = 0;
    const inverse = patches.map(p => {
      const start = p.start + offset; offset += p.text.length - (p.end - p.start);
      return { start, end: start + p.text.length, text: before.source.slice(p.start, p.end), label: p.label };
    });
    this.history.splice(this.cursor);
    this.history.push({ label: plan.label, ids: plan.ids, forward: patches, inverse, at: new Date().toISOString() });
    this.cursor++; this.model = after; this.revision++;
  }
  undo() {
    if (!this.canUndo) return;
    const ids=captureIdentities(this.model);this.model = parseScore(applyPatches(this.source, this.history[this.cursor - 1].inverse));restoreIdentities(this.model,ids);
    this.cursor--; this.revision++;
  }
  redo() {
    if (!this.canRedo) return;
    const ids=captureIdentities(this.model);this.model = parseScore(applyPatches(this.source, this.history[this.cursor].forward));restoreIdentities(this.model,ids);
    this.cursor++; this.revision++;
  }
  editPitches(updates: Map<string, Pitch>) {
    const patches: Patch[] = [];
    for (const [id, pitch] of updates) {
      const note = this.note(id);
      this.unambiguous(note);
      if (!note.pitch) throw new ScoreError('Select a pitched note to change its pitch.');
      if (note.fretted) throw new ScoreError('This pitch has an explicit tablature fret. Coordinating pitch and fret changes is not supported yet.');
      if (note.ties.length || note.tiedNotation) throw new ScoreError('This note belongs to a tie. Editing a complete tie chain is not supported yet; no pitches were changed.');
      if (!Number.isInteger(note.pitch.alter) || !accidentalNames[note.pitch.alter]) throw new ScoreError('Microtonal pitch editing is not supported. The original spelling is preserved.');
      if (!steps.includes(pitch.step) || !Number.isInteger(pitch.octave) || pitch.octave < 0 || pitch.octave > 9 || !accidentalNames[pitch.alter]) throw new ScoreError('Choose a written pitch from octave 0–9 with a natural, sharp, flat or double accidental.');
      if (pitch.step === note.pitch.step && pitch.alter === note.pitch.alter && pitch.octave === note.pitch.octave) continue;
      const element = child(note.node, 'pitch')!;
      patches.push(setField(this.source, element, 'step', pitch.step, ['step', 'alter', 'octave'], 'Written pitch step'));
      if (pitch.alter !== 0 || child(element, 'alter')) patches.push(setField(this.source, element, 'alter', String(pitch.alter), ['step', 'alter', 'octave'], 'Written pitch alteration'));
      patches.push(setField(this.source, element, 'octave', String(pitch.octave), ['step', 'alter', 'octave'], 'Written octave'));
      patches.push(setField(this.source, note.node, 'accidental', accidentalNames[pitch.alter], noteOrder, 'Explicit accidental'));
    }
    this.commit({ label: updates.size === 1 ? `Change pitch to ${pitchText([...updates.values()][0])}` : `Change ${updates.size} pitches`, description: '', ids: [...updates.keys()], patches, revision: this.revision });
  }
  movePitch(ids: string[], delta: number, octave = false) {
    const updates = new Map<string, Pitch>();
    for (const id of ids) {
      const note = this.note(id); if (!note.pitch) continue;
      const absolute = note.pitch.octave * 7 + steps.indexOf(note.pitch.step) + (octave ? delta * 7 : delta);
      const step = steps[((absolute % 7) + 7) % 7];
      if (!octave && step !== note.pitch.step && (note.nonTraditionalKey || !Number.isInteger(note.keyFifths))) throw new ScoreError('This key signature needs an explicit pitch choice. Use the step and accidental controls; automatic diatonic movement is unavailable for this key.');
      updates.set(id, { step, octave: Math.floor(absolute / 7), alter: octave || step === note.pitch.step ? note.pitch.alter : keyAlteration(note.keyFifths, step) });
    }
    this.editPitches(updates);
  }
  setAccidental(ids: string[], alter: number) {
    this.editPitches(new Map(ids.filter(id => this.note(id).pitch).map(id => [id, { ...this.note(id).pitch!, alter }])));
  }
  respell(id: string, direction = 1) {
    const note = this.note(id); if (!note.pitch) throw new ScoreError('Select a pitched note.');
    const semitones: Record<Step, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
    const absolute = note.pitch.octave * 7 + steps.indexOf(note.pitch.step) + direction;
    const step = steps[(absolute % 7 + 7) % 7], octave = Math.floor(absolute / 7);
    const target = note.pitch.octave * 12 + semitones[note.pitch.step] + note.pitch.alter;
    const alter = target - (octave * 12 + semitones[step]);
    this.editPitches(new Map([[id, { step, octave, alter }]]));
  }
  private rhythmPatches(note: ScoreNote, type: NoteType, dots: number, ticks: bigint): Patch[] {
    const duration = child(note.node, 'duration'), typeNode = child(note.node, 'type');
    if (!duration || !typeNode) throw new ScoreError('This event has no explicit note type and duration. Editing its rhythm is not supported.');
    const patches = [scalarPatch(this.source, duration, String(ticks), 'Duration ticks'), scalarPatch(this.source, typeNode, type, 'Note type')];
    const oldDots = children(note.node, 'dot');
    if (dots < oldDots.length) for (const dot of oldDots.slice(dots)) patches.push({ start: dot.start, end: dot.end, text: '', label: 'Remove augmentation dot' });
    if (dots > oldDots.length) {
      const next = note.node.children.find(c => c.start >= (oldDots.at(-1)?.end ?? typeNode.end));
      const tag = qualified(note.node, 'dot');
      patches.push(insertPatch(this.source, note.node, next, `<${tag}/>` .repeat(dots - oldDots.length), 'Add augmentation dots'));
    }
    return patches;
  }
  planDuration(id: string, type: NoteType, dots: number): EditPlan {
    const note = this.note(id);
    if (!NOTE_TYPES.includes(type) || ![0, 1, 2].includes(dots)) throw new ScoreError('Choose a supported duration and up to two dots.');
    const measure = this.model.parts.find(p => p.id === note.partId)!.measures[note.measureIndex];
    const group = measure.notes.filter(n => n.chordRoot === note.chordRoot);
    group.forEach(n => this.unambiguous(n));
    if (group.some(n => n.grace || n.ratio || n.linkedRhythm || n.ties.length || n.tiedNotation || n.beams || n.fullMeasureRest)) throw new ScoreError('Duration editing of grace notes, tuplets, tremolos, ties, beamed groups and whole-measure rests requires coordinated notation changes. These rhythms are preserved in this version.');
    if (group.some(n => !n.duration.equals(group[0].duration) || !n.divisions.equals(note.divisions))) throw new ScoreError('Unequal chord durations cannot be changed safely.');
    const desired = notatedTime(type, dots)!;
    const ticks = desired.mul(note.divisions);
    if (!ticks.integer) throw new ScoreError('This edit needs fractional duration ticks. This version edits integer ticks only, so the rhythm cannot be exactly representable by this operation without changing divisions.');
    const delta = desired.sub(group[0].duration);
    const ids = group.map(n => n.id);
    const patches = group.flatMap(n => this.rhythmPatches(n, type, dots, ticks.n));
    let description = `Change ${group.length > 1 ? `all ${group.length} notes in this chord` : note.rest ? 'this rest' : 'this note'} to ${durationText(type, dots).toLowerCase()}.`;
    if (delta.n !== 0n) {
      const next = measure.notes[group.at(-1)!.index + 1];
      if (!next || !next.rest || next.chord || next.grace || next.ratio || next.linkedRhythm || next.beams || next.fullMeasureRest || next.voice !== note.voice || next.staff !== group[0].staff || next.segment !== note.segment || !next.onset.equals(group[0].onset.add(group[0].duration))) {
        throw new ScoreError(`${delta.positive ? 'Lengthening' : 'Shortening'} this event would change the timing of later events or leave the measure unbalanced. Select an event followed immediately by an ordinary rest in the same voice. No rhythm was changed.`);
      }
      this.unambiguous(next);
      const between = measure.node.children.filter(c => c.start > group.at(-1)!.node.start && c.start < next.node.start);
      if (between.length) throw new ScoreError('A direction or another musical element occurs before the following rest. Its timing cannot be preserved by this operation.');
      const remainder = next.duration.sub(delta);
      let representation: { type: NoteType; dots: number } | undefined;
      for (const restType of NOTE_TYPES) for (const restDots of [0, 1, 2]) if (notatedTime(restType, restDots)!.equals(remainder)) representation = { type: restType, dots: restDots };
      if (!representation || !remainder.positive) throw new ScoreError('The following rest would need to be removed or split into several events. That structural operation is not supported yet.');
      const restTicks = remainder.mul(next.divisions);
      if (!restTicks.integer) throw new ScoreError('The compensating rest duration cannot be represented exactly.');
      patches.push(...this.rhythmPatches(next, representation.type, representation.dots, restTicks.n)); ids.push(next.id);
      description += ` Resize the following rest from ${durationText(next.type, next.dots).toLowerCase()} to ${durationText(representation.type, representation.dots).toLowerCase()}. The end of this pair and every other event keep their timing.`;
    }
    return { label: `Change duration to ${durationText(type, dots).toLowerCase()}`, description, ids, patches, revision: this.revision };
  }
  applyPlan(plan: EditPlan) { this.commit(plan); }
  changeVoice(id: string, voice: string) {
    if (!/^[1-8]$/.test(voice)) throw new ScoreError('Choose a voice from 1 to 8.');
    const note = this.note(id), measure = this.model.parts.find(p => p.id === note.partId)!.measures[note.measureIndex];
    const group = measure.notes.filter(n => n.chordRoot === note.chordRoot);
    group.forEach(n => this.unambiguous(n));
    if (group.some(n => n.ties.length || n.tiedNotation || n.ratio || n.linkedRhythm || n.beams || n.grace)) throw new ScoreError('This voice assignment has linked notation and cannot be changed safely yet.');
    if (measure.notes.some(n => !group.includes(n) && !n.grace && n.voice === voice && n.onset.compare(note.onset.add(note.duration)) < 0 && n.onset.add(n.duration).compare(note.onset) > 0)) throw new ScoreError('Another event overlaps this time in the target voice. The assignment was not changed.');
    this.commit({ label: `Assign voice ${voice}`, description: '', revision: this.revision, ids: group.map(n => n.id), patches: group.map(n => setField(this.source, n.node, 'voice', voice, noteOrder, 'Voice assignment')) });
  }
}
