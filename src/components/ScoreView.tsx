import { useEffect, useRef, useState } from 'react';
import { LoaderCircle, AlertTriangle } from 'lucide-react';
import type { EditorSession, Snapshot } from '../core/session';
import { pitchText } from '../core/editor';
import { ScoreRenderer, type HitTarget } from '../renderer/ScoreRenderer';

interface Props {
  engine: EditorSession; score: Snapshot; start: number; count: number; zoom: number;
  partId?: string; focusPart?: string; selection: Set<string>; pending: boolean;
  onSelect: (id: string, extend: boolean, range: boolean) => void;
  onDrag: (id: string, steps: number) => void;
  onReady: (count: number) => void;
}
export default function ScoreView(props: Props) {
  const notation = useRef<HTMLDivElement>(null), renderer = useRef<ScoreRenderer | undefined>(undefined);
  const [targets, setTargets] = useState<HitTarget[]>([]), [loading, setLoading] = useState(true), [error, setError] = useState('');
  const selection = useRef(props.selection); selection.current = props.selection;
  const [mapping, setMapping] = useState({ mapped: 0, total: 0 });
  const drag = useRef<{ id: string; y: number; pointer: number } | undefined>(undefined);
  const callbacks = useRef(props); callbacks.current = props;
  const renderChain = useRef(Promise.resolve());
  useEffect(() => {
    if (!notation.current) return;
    const current = new ScoreRenderer(notation.current); renderer.current = current;
    return () => { current.clear(); renderer.current = undefined; };
  }, []);
  useEffect(() => {
    let cancelled = false;
    setLoading(true); setTargets([]); setError(''); callbacks.current.onReady(0);
    const run = async () => {
      if (cancelled) return;
      try {
        const slice = await props.engine.render(props.start, props.count, props.partId);
        if (cancelled) return;
        const result = await renderer.current!.render(slice, new Map(props.score.notes.map(n => [n.id, n])), props.zoom);
        if (cancelled) return;
        renderer.current!.select(selection.current); setTargets(result.targets);
        setMapping({ mapped: result.mappedCount, total: result.sourceCount }); callbacks.current.onReady(result.targets.length);
      } catch (e) { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); }
      finally { if (!cancelled) setLoading(false); }
    };
    renderChain.current = renderChain.current.catch(() => {}).then(run);
    return () => { cancelled = true; };
  }, [props.engine, props.score.revision, props.start, props.count, props.partId, props.zoom]);
  useEffect(() => { renderer.current?.select(props.selection); }, [props.selection]);
  useEffect(() => {
    const selectedId = [...props.selection].at(-1);
    const selected = targets.find(t => t.id === selectedId && (!props.focusPart || t.partId === props.focusPart));
    const target = selected ?? (props.focusPart ? targets.find(t => t.partId === props.focusPart) : undefined);
    if (target) notation.current?.parentElement?.querySelector(`[data-note-id="${target.id}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [props.focusPart, props.selection, targets]);
  const noteMap = new Map(props.score.notes.map(n => [n.id, n]));
  return <div className="score-viewport" aria-label="Engraved score">
    {loading && <div className="render-loading" role="status"><LoaderCircle size={18} className="spin"/> Engraving measures…</div>}
    {error && <div className="render-error" role="alert"><AlertTriangle size={22}/><strong>The score could not be engraved</strong><p>{error}</p></div>}
    <div className="score-stage" style={{ width: Math.max(880, 1100 * props.zoom), visibility: error ? 'hidden' : 'visible' }}>
      <div className="notation" ref={notation} />
      <div className="note-overlay" data-testid="note-overlay" aria-busy={loading}>
        {targets.map(target => {
          const note = noteMap.get(target.id)!, part = props.score.parts.find(p => p.id === note.partId)!;
          return <button key={target.id} type="button" tabIndex={-1} data-note-id={target.id}
            aria-label={`${note.unpitched ? 'Unpitched note' : pitchText(note.pitch)}, ${part.name}, measure ${note.measureNumber}, staff ${note.staff}, voice ${note.voice}`}
            aria-pressed={props.selection.has(target.id)} disabled={props.pending || loading}
            className={`note-hit ${props.selection.has(target.id) ? 'selected' : ''} ${props.score.diagnostics.some(d => d.noteId === target.id || (d.measureIndex === note.measureIndex && d.partId === note.partId && !d.noteId && (!d.staff || d.staff === note.staff))) ? 'issue' : ''}`}
            style={{ left: target.left, top: target.top, width: target.width, height: target.height }}
            onPointerDown={event => {
              if (event.button !== 0) return;
              event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
              drag.current = { id: target.id, y: event.clientY, pointer: event.pointerId };
              props.onSelect(target.id, event.metaKey || event.ctrlKey, event.shiftKey);
            }}
            onPointerUp={event => {
              const started = drag.current; drag.current = undefined;
              if (!started || started.id !== target.id) return;
              const delta = Math.round((started.y - event.clientY) / (5 * props.zoom));
              if (Math.abs(event.clientY - started.y) >= 5 && delta && note.pitch) props.onDrag(target.id, delta);
            }}
            onPointerCancel={() => { drag.current = undefined; }} />;
        })}
      </div>
    </div>
    {!loading && !error && mapping.mapped < mapping.total && <div className="mapping-warning"><AlertTriangle size={14}/> {mapping.total - mapping.mapped} events could not be mapped by the renderer. They remain preserved and cannot be edited from this view.</div>}
  </div>;
}
