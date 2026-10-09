import { ScoreDocument } from './editor';
import { viewModel, type Snapshot, type RenderSlice } from './session';
import { qualified } from './xml';
import type { NoteType } from './rational';
import type { Pitch } from './model';
let document: ScoreDocument | undefined;
const snapshot = (): Snapshot => ({ ...viewModel(document!.model), dirty: document!.dirty, canUndo: document!.canUndo, canRedo: document!.canRedo, revision: document!.revision, undoLabel: document!.undoLabel, changes: document!.changes.map(c => ({ label: c.label, ids: c.ids, patchCount: c.forward.length, at: c.at })) });

function renderSlice(start: number, count: number, partId?: string): RenderSlice {
  const model = document!.model, source = model.source;
  const header = model.root.children.filter(c => c.local !== 'part').map(c => source.slice(c.start, c.end)).join('\n');
  let xml = source.slice(model.root.start, model.root.openEnd) + header;
  const noteIds: string[] = [];
  for (const part of model.parts.filter(p => !partId || p.id === partId)) {
    xml += source.slice(part.node.start, part.node.openEnd);
    for (const [i, measure] of part.measures.slice(start, start + count).entries()) {
      let raw = source.slice(measure.node.start, measure.node.end);
      if (i === 0 && start > 0 && measure.renderAttributes.length) {
        const tag = qualified(measure.node, 'attributes');
        const at = measure.node.openEnd - measure.node.start;
        // This separate presentation document never participates in saving.
        raw = raw.slice(0, at) + `<${tag}>${measure.renderAttributes.join('')}</${tag}>` + raw.slice(at);
      }
      xml += raw; noteIds.push(...measure.notes.map(n => n.id));
    }
    xml += `</${part.node.name}>`;
  }
  return { xml: xml + `</${model.root.name}>`, noteIds };
}

self.onmessage = (event: MessageEvent) => {
  const { requestId, method, args } = event.data;
  try {
    let result: unknown;
    if (method === 'open') { document = new ScoreDocument(args.source); result = snapshot(); }
    else {
      if (!document) throw new Error('Open a score first.');
      switch (method) {
        case 'source': result = document.source; break;
        case 'render': result = renderSlice(args.start, args.count, args.partId); break;
        case 'validate-save': result = document.validateSave(); break;
        case 'plan-duration': result = document.planDuration(args.id, args.type as NoteType, args.dots); break;
        case 'pitch': document.editPitches(new Map<string, Pitch>(args.updates)); result = snapshot(); break;
        case 'move-pitch': document.movePitch(args.ids, args.delta, args.octave); result = snapshot(); break;
        case 'accidental': document.setAccidental(args.ids, args.alter); result = snapshot(); break;
        case 'respell': document.respell(args.id, args.direction); result = snapshot(); break;
        case 'duration': document.applyPlan(args.plan); result = snapshot(); break;
        case 'voice': document.changeVoice(args.id, args.voice); result = snapshot(); break;
        case 'undo': document.undo(); result = snapshot(); break;
        case 'redo': document.redo(); result = snapshot(); break;
        case 'mark-saved': document.markSaved(); result = snapshot(); break;
        default: throw new Error('Unknown editor operation.');
      }
    }
    self.postMessage({ requestId, result });
  } catch (error) { self.postMessage({ requestId, error: { message: error instanceof Error ? error.message : String(error), code: (error as { code?: string }).code } }); }
};
