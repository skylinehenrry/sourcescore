import type { Pitch, Diagnostic, ScoreModel, ScoreNote } from './model';
import type { EditPlan } from './editor';
import { ScoreError } from './xml';

export type ViewNote = Omit<ScoreNote, 'node' | 'onset' | 'duration' | 'divisions'> & { onset: string; duration: string; divisions: string };
export interface ViewPart { id: string; name: string; staves: number; measures: { index: number; number: string; id: string }[] }
export interface Snapshot {
  title: string; parts: ViewPart[]; notes: ViewNote[]; measures: number; diagnostics: Diagnostic[];
  dirty: boolean; canUndo: boolean; canRedo: boolean; revision: number; undoLabel?: string;
  changes: { label: string; ids: string[]; patchCount: number; at: string }[];
}
export interface RenderSlice { xml: string; noteIds: string[] }
export function viewModel(model: ScoreModel) {
  return {
    title: model.title, measures: model.measures, diagnostics: model.diagnostics,
    parts: model.parts.map(p => ({ id: p.id, name: p.name, staves: p.staves, measures: p.measures.map(m => ({ index: m.index, number: m.number, id: m.id })) })),
    notes: [...model.notes.values()].map(({ node: _node, onset, duration, divisions, ...note }) => ({ ...note, onset: onset.toString(), duration: duration.toString(), divisions: String(divisions) })),
  };
}
/** Parsing, validation and mutation run in a worker to keep the desktop UI responsive. */
export class EditorSession {
  private worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  private next = 0;
  private pending = new Map<number, { resolve: (value: unknown) => void; reject: (reason: Error) => void }>();
  constructor() {
    this.worker.onmessage = (event: MessageEvent) => {
      const { requestId, result, error } = event.data; const promise = this.pending.get(requestId);
      if (!promise) return; this.pending.delete(requestId);
      if (error) promise.reject(new ScoreError(error.message, error.code)); else promise.resolve(result);
    };
    this.worker.onerror = () => { for (const promise of this.pending.values()) promise.reject(new Error('The editing engine stopped. Reopen the score; its disk file has not been modified.')); this.pending.clear(); };
  }
  request<T>(method: string, args: unknown = {}): Promise<T> {
    const requestId = ++this.next;
    return new Promise((resolve, reject) => { this.pending.set(requestId, { resolve: resolve as (value: unknown) => void, reject }); this.worker.postMessage({ requestId, method, args }); });
  }
  open(source: string) { return this.request<Snapshot>('open', { source }); }
  edit(method: string, args: unknown = {}) { return this.request<Snapshot>(method, args); }
  pitch(updates: [string, Pitch][]) { return this.edit('pitch', { updates }); }
  planDuration(id: string, type: string, dots: number) { return this.request<EditPlan>('plan-duration', { id, type, dots }); }
  render(start: number, count: number, partId?: string) { return this.request<RenderSlice>('render', { start, count, partId }); }
  source() { return this.request<string>('source'); }
  validateSave() { return this.request<{ existing: number }>('validate-save'); }
  markSaved() { return this.edit('mark-saved'); }
  dispose() { this.worker.terminate(); for (const p of this.pending.values()) p.reject(new Error('The score was closed.')); this.pending.clear(); }
}
