import { useEffect, useRef, useState, type ReactNode } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { FolderOpen, Save, Undo2, Redo2, Minus, Plus, ChevronLeft, ChevronRight, Music2, PanelRightClose, PanelRightOpen, ShieldCheck, AlertTriangle, Check, X, ListMusic, Search, Clock3, ArrowUp, ArrowDown, LoaderCircle, Keyboard, FileMusic, Focus, ArrowRight, Download } from 'lucide-react';
import { EditorSession, type Snapshot, type ViewNote } from './core/session';
import { pitchText, durationText, type EditPlan } from './core/editor';
import { NOTE_TYPES, type NoteType } from './core/rational';
import { decodeSource } from './core/xml';
import { chooseFile, readNative, saveNative, saveAsNative, releaseFile, confirmDiscard, downloadSource, desktop, type FileReference } from './io/files';
import ScoreView from './components/ScoreView';
import DurationIcon from './components/DurationIcon';
import example from '../fixtures/orchestral-study.musicxml?raw';

const accidentalOptions = [{ alter: -2, symbol: '𝄫', label: 'Double flat' }, { alter: -1, symbol: '♭', label: 'Flat' }, { alter: 0, symbol: '♮', label: 'Natural' }, { alter: 1, symbol: '♯', label: 'Sharp' }, { alter: 2, symbol: '𝄪', label: 'Double sharp' }];
function ToolButton({ children, label, onClick, disabled, active, className = '' }: { children: ReactNode; label: string; onClick: () => void; disabled?: boolean; active?: boolean; className?: string }) {
  return <button type="button" title={label} aria-label={label} onClick={onClick} disabled={disabled} className={`tool-button ${active ? 'active' : ''} ${className}`}>{children}</button>;
}
function Modal({ title, children, onClose, footer }: { title: string; children: ReactNode; onClose: () => void; footer?: ReactNode }) {
  useEffect(() => { const close = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); }; window.addEventListener('keydown', close); return () => window.removeEventListener('keydown', close); }, [onClose]);
  return <div className="modal-backdrop" onClick={onClose}><section className="modal" role="dialog" aria-modal="true" aria-label={title} onClick={e => e.stopPropagation()}><div className="modal-heading"><h2>{title}</h2><button className="icon-button" aria-label="Close dialog" onClick={onClose}><X size={18}/></button></div><div className="modal-body">{children}</div>{footer && <div className="modal-footer">{footer}</div>}</section></div>;
}

export default function App() {
  const [engine, setEngine] = useState<EditorSession>(), [score, setScore] = useState<Snapshot>();
  const [file, setFile] = useState<FileReference>(), [selection, setSelection] = useState(new Set<string>());
  const [start, setStart] = useState(0), [count, setCount] = useState(8), [zoom, setZoom] = useState(0.9);
  const [focusPart, setFocusPart] = useState<string>(), [soloPart, setSoloPart] = useState<string>();
  const [inspector, setInspector] = useState(true), [panel, setPanel] = useState<'issues' | 'history' | undefined>();
  const [busy, setBusy] = useState(''), [status, setStatus] = useState('Ready to open a score');
  const [error, setError] = useState(''), [durationPlan, setDurationPlan] = useState<EditPlan>();
  const [help, setHelp] = useState(false), [measureSearch, setMeasureSearch] = useState('');
  const [mappedCount, setMappedCount] = useState(0), [conflict, setConflict] = useState(false);
  const [instrumentSearch, setInstrumentSearch] = useState('');
  const input = useRef<HTMLInputElement>(null), pending = useRef(false);
  const current = useRef({ engine, score, file, selection }); current.current = { engine, score, file, selection };
  const actions = useRef<Record<string, () => void>>({});
  const notes = new Map(score?.notes.map(n => [n.id, n]));
  const primary = notes.get([...selection].at(-1) ?? '');
  const selectedPart = score?.parts.find(p => p.id === primary?.partId);
  const issueCount = score?.diagnostics.filter(d => d.severity !== 'info').length ?? 0;
  const editable = !!primary && !busy;

  async function load(source: string, reference: FileReference) {
    if (pending.current) return;
    if (current.current.score?.dirty && !await confirmDiscard()) { await releaseFile(reference); return; }
    pending.current = true; setBusy('Reading and validating score…');
    const next = new EditorSession();
    try {
      const opened = await next.open(source);
      current.current.engine?.dispose(); await releaseFile(current.current.file);
      setEngine(next); setScore(opened); setFile(reference); setSelection(new Set()); setStart(0); setFocusPart(undefined); setSoloPart(undefined); setConflict(false); setInstrumentSearch('');
      setStatus(`Opened ${reference.name}`); setPanel(opened.diagnostics.some(d => d.severity === 'error') ? 'issues' : undefined);
    } catch (e) { next.dispose(); await releaseFile(reference); setError(e instanceof Error ? e.message : String(e)); }
    finally { pending.current = false; setBusy(''); }
  }
  async function openPath(path: string) {
    if (pending.current) return;
    try { const result = await readNative(path); await load(result.source, result.file); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }
  async function open() {
    if (pending.current) return;
    if (!desktop) { input.current?.click(); return; }
    try { const path = await chooseFile(); if (path) await openPath(path); } catch (e) { setError(String(e)); }
  }
  async function edit(method: string, args: unknown = {}) {
    if (!engine || pending.current) return;
    pending.current = true; setBusy('Applying edit…');
    try { const next = await engine.edit(method, args); setScore(next); setStatus(next.changes.at(-1)?.label ?? 'Changes undone'); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { pending.current = false; setBusy(''); }
  }
  async function save(as = false) {
    if (!engine || !file || pending.current) return;
    pending.current = true; setBusy('Validating and saving…');
    try {
      const validation = await engine.validateSave(), source = await engine.source();
      if (!desktop) { downloadSource(file.name, source); setScore(await engine.markSaved()); setStatus('Downloaded MusicXML copy'); }
      else if (as || !file.sessionId) {
        const nextFile = await saveAsNative(file, source);
        if (nextFile) { await releaseFile(file); setFile(nextFile); setScore(await engine.markSaved()); setConflict(false); setStatus(`Saved ${nextFile.name}`); }
      } else {
        const result = await saveNative(file, source);
        setFile({ ...file, hash: result.hash }); setScore(await engine.markSaved()); setConflict(false);
        setStatus(result.unchanged ? 'Saved • no source changes' : 'Saved • recoverable backup created');
      }
      if (validation.existing) setStatus(s => `${s} • ${validation.existing} pre-existing issues retained`);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { pending.current = false; setBusy(''); }
  }
  async function requestDuration(type: NoteType, dots: number) {
    if (!engine || !primary || pending.current) return;
    try { setDurationPlan(await engine.planDuration(primary.id, type, dots)); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }
  function select(id: string, extend: boolean, range: boolean) {
    const note = notes.get(id); if (!note) return;
    if (range && primary && primary.partId === note.partId) {
      const partNotes = score!.notes.filter(n => n.partId === note.partId);
      const a = partNotes.findIndex(n => n.id === primary.id), b = partNotes.findIndex(n => n.id === id);
      const span = partNotes.slice(Math.min(a, b), Math.max(a, b) + 1).map(n => n.id);
      setSelection(new Set([...selection, ...span.filter(n => n !== id), id]));
    } else if (extend) { const next = new Set(selection); if (next.has(id)) next.delete(id); else next.add(id); setSelection(next); }
    else setSelection(new Set([id]));
  }
  function navigate(index: number, noteId?: string, partId?: string) {
    if (!score) return;
    index = Math.max(0, Math.min(score.measures - 1, index));
    if (index < start || index >= start + count) setStart(Math.floor(index / count) * count);
    if (partId) { setFocusPart(partId); if (soloPart && soloPart !== partId) setSoloPart(partId); }
    if (noteId) setSelection(new Set([noteId]));
    else {
      const first = score.notes.find(n => n.measureIndex === index && (!partId || n.partId === partId));
      if (first) { setSelection(new Set([first.id])); setFocusPart(first.partId); }
    }
    setTimeout(() => {
      const target = noteId ?? score.notes.find(n => n.measureIndex === index && (!partId || n.partId === partId))?.id;
      if (target) document.querySelector(`[data-note-id="${target}"]`)?.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
    }, 120);
  }
  function goToMeasure() {
    if (!score || !measureSearch.trim()) return;
    const search = measureSearch.trim(), part = score.parts.find(p => p.id === focusPart) ?? score.parts[0];
    const exact = part.measures.find(m => m.number === search);
    const index = exact?.index ?? (/^\d+$/.test(search) ? Number(search) - 1 : -1);
    if (index < 0 || index >= score.measures) { setError(`Measure “${search}” was not found. Enter a source measure label or a position from 1 to ${score.measures}.`); return; }
    navigate(index, undefined, focusPart); setMeasureSearch('');
  }
  function adjacentNote(delta: number) {
    if (!score) return;
    const partNotes = score.notes.filter(n => n.partId === (primary?.partId ?? score.parts[0].id) && (!primary || (n.staff === primary.staff && n.voice === primary.voice)));
    const index = primary ? partNotes.findIndex(n => n.id === primary.id) + delta : 0;
    const next = partNotes[Math.max(0, Math.min(partNotes.length - 1, index))];
    if (next) navigate(next.measureIndex, next.id, next.partId);
  }
  actions.current = {
    open: () => void open(), save: () => void save(), 'save-as': () => void save(true), undo: () => void edit('undo'), redo: () => void edit('redo'),
    quit: () => void (async () => { if (!pending.current && (!current.current.score?.dirty || await confirmDiscard())) await invoke('exit_app'); })(),
  };
  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      const isField = (event.target as HTMLElement).closest('input, select, textarea, [contenteditable=true]');
      const command = event.metaKey || event.ctrlKey;
      if (command && !desktop) {
        const key = event.key.toLowerCase();
        if (key === 'o' || key === 's' || (key === 'z' && !isField)) { event.preventDefault(); actions.current[key === 'o' ? 'open' : key === 's' ? event.shiftKey ? 'save-as' : 'save' : event.shiftKey ? 'redo' : 'undo'](); }
        return;
      }
      if (isField || command || error || help || durationPlan || busy) return;
      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') { event.preventDefault(); void edit('move-pitch', { ids: [...selection], delta: event.key === 'ArrowUp' ? 1 : -1, octave: event.shiftKey }); }
      else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); adjacentNote(event.key === 'ArrowRight' ? 1 : -1); }
      else if (/^[1-7]$/.test(event.key)) { event.preventDefault(); void requestDuration(NOTE_TYPES[7 - Number(event.key)], primary?.dots ?? 0); }
      else if (event.key === '.') { event.preventDefault(); if (primary) void requestDuration(primary.type as NoteType, (primary.dots + 1) % 3); }
      else if (event.key === 'Escape') setSelection(new Set());
    };
    window.addEventListener('keydown', keyboard); return () => window.removeEventListener('keydown', keyboard);
  });
  useEffect(() => {
    if (!desktop) return;
    const cleanup: (() => void)[] = []; let disposed = false;
    const register = async () => {
      const removers = await Promise.all([
        listen<string>('menu-action', event => actions.current[event.payload]?.()),
        listen<string>('open-path', event => void openPath(event.payload)),
        getCurrentWindow().onCloseRequested(async event => { event.preventDefault(); actions.current.quit?.(); }),
        getCurrentWindow().onDragDropEvent(event => { if (event.payload.type === 'drop' && event.payload.paths[0]) void openPath(event.payload.paths[0]); }),
      ]);
      if (disposed) removers.forEach(remove => remove()); else cleanup.push(...removers);
      const path = await invoke<string | null>('take_pending_file'); if (!disposed && path) await openPath(path);
    };
    void register().catch(e => setError(String(e)));
    return () => { disposed = true; cleanup.forEach(remove => remove()); };
  }, []);
  useEffect(() => {
    if (desktop) void getCurrentWindow().setTitle(`${file?.name ?? 'SourceScore'}${score?.dirty ? ' • Edited' : ''} — SourceScore`);
    document.title = `${file?.name ?? 'SourceScore'}${score?.dirty ? ' • Edited' : ''}`;
  }, [file?.name, score?.dirty]);
  useEffect(() => {
    const prevent = (event: BeforeUnloadEvent) => { if (current.current.score?.dirty) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', prevent); return () => window.removeEventListener('beforeunload', prevent);
  }, []);
  useEffect(() => {
    if (!desktop || !file?.sessionId) return;
    const sessionId = file.sessionId;
    const check = () => { if (!pending.current) void invoke<boolean>('check_score', { sessionId }).then(changed => { if (current.current.file?.sessionId === sessionId) setConflict(changed); }).catch(() => {}); };
    const interval = window.setInterval(check, 10000); window.addEventListener('focus', check);
    return () => { clearInterval(interval); window.removeEventListener('focus', check); };
  }, [file?.sessionId]);

  return <div className="application">
    <input ref={input} type="file" accept=".musicxml,.xml" hidden data-testid="file-input" onChange={event => {
      const uploaded = event.target.files?.[0]; event.target.value = '';
      if (uploaded) void uploaded.arrayBuffer().then(bytes => load(decodeSource(new Uint8Array(bytes)), { name: uploaded.name })).catch(e => setError(String(e)));
    }}/>
    <header className={`titlebar ${desktop ? 'native' : ''}`} data-tauri-drag-region>
      <div className="brand" data-tauri-drag-region><span className="brand-symbol"><Music2 size={18}/></span><span>SourceScore</span></div>
      <div className="document-title" data-tauri-drag-region>{file?.name ?? 'MusicXML Editor'}{score?.dirty && <span className="dirty-dot" title="Unsaved changes"/>}</div>
      <button className="icon-button" onClick={() => setHelp(true)} aria-label="Keyboard shortcuts"><Keyboard size={18}/></button>
    </header>
    <div className="toolbar">
      <div className="tool-group file-tools"><button className="text-tool" onClick={() => void open()} disabled={!!busy}><FolderOpen size={17}/>Open</button><button className="text-tool save-tool" onClick={() => void save()} disabled={!score || !!busy}>{desktop ? <Save size={17}/> : <Download size={17}/>} {desktop ? 'Save' : 'Download'}</button></div>
      <div className="tool-group"><ToolButton label="Undo (⌘Z)" onClick={() => void edit('undo')} disabled={!score?.canUndo || !!busy}><Undo2 size={18}/></ToolButton><ToolButton label="Redo (⇧⌘Z)" onClick={() => void edit('redo')} disabled={!score?.canRedo || !!busy}><Redo2 size={18}/></ToolButton></div>
      <div className="tool-group durations" aria-label="Note duration">{NOTE_TYPES.map((type, i) => <ToolButton key={type} label={`${durationText(type, 0)} (${7 - i})`} active={primary?.type === type} onClick={() => void requestDuration(type, primary?.dots ?? 0)} disabled={!editable} className="music-symbol"><DurationIcon type={type}/></ToolButton>)}<ToolButton label="Augmentation dots (.)" active={!!primary?.dots} onClick={() => { if (primary) void requestDuration(primary.type as NoteType, (primary.dots + 1) % 3); }} disabled={!editable} className="dot-tool">{primary?.dots === 2 ? '··' : '·'}</ToolButton></div>
      <div className="tool-group accidentals">{accidentalOptions.map(option => <ToolButton key={option.alter} label={option.label} active={primary?.pitch?.alter === option.alter} onClick={() => void edit('accidental', { ids: [...selection], alter: option.alter })} disabled={!editable || !primary?.pitch} className="music-symbol">{option.symbol}</ToolButton>)}</div>
      <div className="toolbar-spacer"/>
      <div className="tool-group zoom-tools"><ToolButton label="Zoom out" onClick={() => setZoom(z => Math.max(0.5, +(z - 0.1).toFixed(1)))}><Minus size={15}/></ToolButton><span className="zoom-label">{Math.round(zoom * 100)}%</span><ToolButton label="Zoom in" onClick={() => setZoom(z => Math.min(1.8, +(z + 0.1).toFixed(1)))}><Plus size={15}/></ToolButton></div>
      <ToolButton label="Toggle note inspector" onClick={() => setInspector(v => !v)} active={inspector}>{inspector ? <PanelRightClose size={18}/> : <PanelRightOpen size={18}/>}</ToolButton>
    </div>
    <div className="workspace">
      <aside className="instruments">
        <div className="sidebar-heading"><h2>Instruments</h2>{score && <span className="count-badge">{score.parts.length}</span>}</div>
        {score ? <><label className="instrument-search"><Search size={14}/><input aria-label="Find instrument" placeholder="Find instrument" value={instrumentSearch} onChange={e => setInstrumentSearch(e.target.value)}/></label><button className={`ensemble-button ${!soloPart ? 'chosen' : ''}`} onClick={() => { setSoloPart(undefined); setFocusPart(undefined); }}><ListMusic size={16}/>Full score{!soloPart && <Check size={14}/>}</button><div className="instrument-list">{score.parts.filter(p => p.name.toLowerCase().includes(instrumentSearch.toLowerCase())).map((part, i) => <button key={part.id} className={`instrument-item ${focusPart === part.id ? 'focused' : ''}`} onClick={() => { setFocusPart(part.id); if (soloPart) setSoloPart(part.id); }}><span className="instrument-number">{String(i + 1).padStart(2, '0')}</span><span><span className="instrument-name">{part.name}</span><span className="staff-count">{part.staves} {part.staves === 1 ? 'staff' : 'staves'}</span></span><span role="button" tabIndex={0} className="solo-button" title={`Focus ${part.name} only`} aria-label={`Show ${part.name} only`} onClick={event => { event.stopPropagation(); setSoloPart(part.id); setFocusPart(part.id); }} onKeyDown={event => { if (event.key === 'Enter') { event.stopPropagation(); setSoloPart(part.id); setFocusPart(part.id); } }}><Focus size={14}/></span></button>)}</div><div className="score-facts"><span>{score.measures.toLocaleString()} measures</span><span>{score.notes.length.toLocaleString()} events</span></div></> : <div className="sidebar-empty"><ListMusic size={23}/><p>Your score’s instruments will appear here.</p></div>}
        <div className="sidebar-bottom"><ShieldCheck size={17}/><span>Original source retained</span></div>
      </aside>
      <main className="editor-main">
        {score && engine ? <>
          <div className="score-heading"><div><h1>{score.title}</h1><span>{soloPart ? score.parts.find(p => p.id === soloPart)?.name : 'Full score'} <span className="heading-dot">·</span> Measures {start + 1}–{Math.min(start + count, score.measures)} of {score.measures}</span></div><div className="measure-search"><Search size={15}/><input aria-label="Go to measure" placeholder="Go to measure" value={measureSearch} onChange={e => setMeasureSearch(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') goToMeasure(); }}/><button onClick={goToMeasure} aria-label="Go"><ArrowRight size={15}/></button></div></div>
          <div className="measure-nav"><div className="measure-pages"><ToolButton label="Previous measures" disabled={start === 0 || !!busy} onClick={() => setStart(s => Math.max(0, s - count))}><ChevronLeft size={16}/></ToolButton>{Array.from({ length: Math.min(count, score.measures - start) }, (_, i) => start + i).map(index => <button className={`measure-pill ${primary?.measureIndex === index ? 'current' : ''} ${score.diagnostics.some(d => d.measureIndex === index && (!soloPart || d.partId === soloPart)) ? 'has-issue' : ''}`} key={index} title={`Measure ${score.parts[0].measures[index]?.number ?? index + 1}`} onClick={() => navigate(index, undefined, focusPart)}>{score.parts[0].measures[index]?.number ?? index + 1}</button>)}<ToolButton label="Next measures" disabled={start + count >= score.measures || !!busy} onClick={() => setStart(s => s + count)}><ChevronRight size={16}/></ToolButton></div><label className="window-size">Show <select aria-label="Measures per view" value={count} onChange={e => { setCount(Number(e.target.value)); setStart(0); }}><option value={4}>4</option><option value={8}>8</option><option value={16}>16</option></select> measures</label></div>
          {conflict && <div className="conflict-banner"><AlertTriangle size={16}/>This file changed outside SourceScore. Reopen it or save your edits to another file.<button onClick={() => void save(true)}>Save As…</button></div>}
          <ScoreView key={file?.sessionId ?? file?.name} engine={engine} score={score} start={start} count={count} zoom={zoom} partId={soloPart} focusPart={focusPart} selection={selection} pending={!!busy} onSelect={select} onDrag={(id, delta) => void edit('move-pitch', { ids: [id], delta })} onReady={setMappedCount}/>
          <div className="panel-tabs"><button className={panel === 'issues' ? 'selected-tab' : ''} onClick={() => setPanel(p => p === 'issues' ? undefined : 'issues')}><AlertTriangle size={15}/>Diagnostics <span className={`count-badge ${issueCount ? 'warning' : ''}`}>{issueCount}</span></button><button className={panel === 'history' ? 'selected-tab' : ''} onClick={() => setPanel(p => p === 'history' ? undefined : 'history')}><Clock3 size={15}/>Session history <span className="count-badge">{score.changes.length}</span></button><span className="panel-note">{mappedCount.toLocaleString()} selectable events in view</span></div>
          {panel && <div className="diagnostic-panel">{panel === 'issues' ? issueCount ? <><p className="panel-description">Issues present in this file. Safe local corrections can be saved while existing issues are retained.</p><div className="diagnostic-table"><div className="diagnostic-header"><span>Instrument / staff</span><span>Measure</span><span>Timing</span><span>Finding</span></div>{score.diagnostics.filter(d => d.severity !== 'info').map((d, i) => <button key={`${d.key}:${i}`} className="diagnostic-row" onClick={() => navigate(d.measureIndex, d.noteId, d.partId)}><span><strong>{d.instrument}</strong><small>{d.staff ? `Staff ${d.staff}` : 'Part'}{d.voice ? ` · Voice ${d.voice}` : ''}</small></span><span>{d.measure}</span><span>{d.actual ? `${d.actual} / ${d.expected ?? '—'}` : '—'}</span><span><i className={d.severity}/>{d.message}</span></button>)}</div></> : <div className="panel-clear"><ShieldCheck size={20}/><span>No timing or notation inconsistencies detected.</span></div> : score.changes.length ? <div className="history-list">{[...score.changes].reverse().map((change, i) => <button key={i} onClick={() => { const n = notes.get(change.ids[0]); if (n) navigate(n.measureIndex, n.id, n.partId); }}><span className="history-icon"><Music2 size={15}/></span><span><strong>{change.label}</strong><small>{change.patchCount} local source patches · {change.ids.length} intended events</small></span><span className="history-time">{new Date(change.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span></button>)}</div> : <div className="panel-clear"><Clock3 size={20}/><span>Your edits will appear here.</span></div>}</div>}
        </> : <div className="welcome"><div className="welcome-sheet"><div className="staff-decoration"><span/><span/><span/><span/><span/><Music2 size={50}/></div></div><h1>A careful correction.<br/>An intact score.</h1><p>Open MusicXML, select a note, and make the<br/>correction directly in your score.</p><button className="primary-button" onClick={() => void open()} disabled={!!busy}><FolderOpen size={18}/>Open MusicXML score<span className="keycap">⌘O</span></button><button className="example-button" onClick={() => void load(example, { name: 'orchestral-study.musicxml' })} disabled={!!busy}><FileMusic size={16}/>Open orchestral example<ArrowRight size={15}/></button><div className="welcome-note"><ShieldCheck size={15}/>Edits keep unrelated source content intact.</div></div>}
      </main>
      {inspector && <aside className="inspector"><div className="sidebar-heading"><h2>Selected event</h2>{selection.size > 1 && <span className="count-badge">{selection.size}</span>}</div>{primary ? <>
        <div className="selection-summary"><div className="selected-symbol">{primary.rest ? '𝄽' : '♩'}</div><div><strong data-testid="selected-pitch">{primary.unpitched ? 'Unpitched' : pitchText(primary.pitch)}</strong><span>{primary.grace ? 'Grace note' : durationText(primary.type, primary.dots)}</span></div></div>
        <div className="selection-location"><strong>{selectedPart?.name}</strong><span>Measure {primary.measureNumber} · Staff {primary.staff}</span></div>
        {primary.pitch && <><div className="inspector-section"><h3>Written pitch</h3><div className="pitch-fields"><label>Step<select aria-label="Pitch step" value={primary.pitch.step} disabled={!!busy} onChange={e => void edit('pitch', { updates: [[primary.id, { ...primary.pitch, step: e.target.value }]] })}>{['C', 'D', 'E', 'F', 'G', 'A', 'B'].map(step => <option key={step}>{step}</option>)}</select></label><label>Octave<input type="number" aria-label="Pitch octave" min={0} max={9} value={primary.pitch.octave} disabled={!!busy} onChange={e => { if (e.target.value !== '') void edit('pitch', { updates: [[primary.id, { ...primary.pitch, octave: Number(e.target.value) }]] }); }}/></label></div><label className="full-field">Accidental<select aria-label="Accidental" value={primary.pitch.alter} disabled={!!busy} onChange={e => void edit('accidental', { ids: [...selection], alter: Number(e.target.value) })}>{accidentalOptions.map(o => <option key={o.alter} value={o.alter}>{o.symbol} {o.label}</option>)}</select></label><div className="pitch-actions"><button onClick={() => void edit('move-pitch', { ids: [...selection], delta: -1, octave: true })} disabled={!!busy}><ArrowDown size={13}/>Octave</button><button onClick={() => void edit('move-pitch', { ids: [...selection], delta: 1, octave: true })} disabled={!!busy}><ArrowUp size={13}/>Octave</button></div><button className="respell-button" onClick={() => void edit('respell', { id: primary.id })} disabled={!!busy}>Enharmonic respelling →</button>{primary.transpose !== 0 && <p className="property-note">This instrument sounds {Math.abs(primary.transpose)} semitones {primary.transpose < 0 ? 'below' : 'above'} written pitch. Transposition is retained.</p>}</div></>}
        <div className="inspector-section"><h3>Rhythm & voice</h3><label className="full-field">Duration<select aria-label="Duration" value={primary.type} disabled={!!busy} onChange={e => void requestDuration(e.target.value as NoteType, primary.dots)}>{!NOTE_TYPES.includes(primary.type as NoteType) && <option value={primary.type}>{primary.type || 'Unspecified'}</option>}{NOTE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}</select></label><div className="pitch-fields"><label>Dots<select aria-label="Dots" value={primary.dots} disabled={!!busy} onChange={e => void requestDuration(primary.type as NoteType, Number(e.target.value))}>{[0, 1, 2].map(n => <option key={n}>{n}</option>)}</select></label><label>Voice<select aria-label="Voice" value={primary.voice} disabled={!!busy} onChange={e => void edit('voice', { id: primary.id, voice: e.target.value })}>{[1, 2, 3, 4, 5, 6, 7, 8].map(n => <option key={n}>{n}</option>)}</select></label></div>{primary.ratio && <div className="notation-badge">Tuplet {primary.ratio.actual}:{primary.ratio.normal}</div>}{primary.chord && <div className="notation-badge">Individual chord pitch</div>}{primary.ties.length > 0 && <div className="notation-badge">Tied note · pitch edit unavailable</div>}</div>
        <div className="selection-tip"><Keyboard size={16}/><span>↑ ↓ change pitch<br/>⇧ ↑ ↓ change octave<br/>← → select adjacent notes</span></div>
      </> : <div className="inspector-empty"><span className="empty-note">♩</span><strong>Select a note or rest</strong><p>Click a musical event to inspect and edit it.</p><span>⌘ click to select more<br/>Drag vertically to change pitch</span></div>}</aside>}
    </div>
    <footer className="statusbar"><span className={`validation-state ${issueCount ? 'issues' : ''}`}>{busy ? <LoaderCircle size={13} className="spin"/> : issueCount ? <AlertTriangle size={13}/> : <ShieldCheck size={13}/>} {busy || (score ? issueCount ? `${issueCount} existing issues` : 'Validation clear' : 'Ready')}</span><span className="status-message" role="status">{status}</span><span className="file-state">{score?.dirty ? <><span className="dirty-dot"/>Unsaved changes</> : score ? <><Check size={13}/>No unsaved changes</> : '.musicxml · .xml'}{!desktop && <span className="preview-label">Browser preview</span>}</span></footer>
    {busy && !score && <div className="busy-overlay"><LoaderCircle size={22} className="spin"/>{busy}</div>}
    {error && <Modal title="Operation could not be completed" onClose={() => setError('')} footer={<button className="primary-button" onClick={() => setError('')}>Keep editing</button>}><div className="error-copy"><AlertTriangle size={24}/><p>{error}</p></div><p className="muted">Your edits remain open. Review the message before saving again.</p></Modal>}
    {durationPlan && <Modal title="Keep this measure balanced" onClose={() => setDurationPlan(undefined)} footer={<><button className="secondary-button" onClick={() => setDurationPlan(undefined)}>Cancel</button><button className="primary-button" onClick={() => { const plan = durationPlan; setDurationPlan(undefined); void edit('duration', { plan }); }}>Apply duration change</button></>}><p>{durationPlan.description}</p><div className="operation-note"><ShieldCheck size={18}/><span>{durationPlan.ids.length} events are included in this operation. You can undo the complete change.</span></div></Modal>}
    {help && <Modal title="Keyboard & mouse editing" onClose={() => setHelp(false)}><div className="shortcut-list">{[['Open score', '⌘O'], ['Save / Save As', '⌘S / ⇧⌘S'], ['Undo / Redo', '⌘Z / ⇧⌘Z'], ['Written pitch up / down', '↑ / ↓'], ['Octave up / down', '⇧↑ / ⇧↓'], ['Adjacent event', '← / →'], ['Whole → 64th', '7 → 1'], ['Cycle augmentation dots', '.'], ['Select multiple events', '⌘ click'], ['Select a range in a part', '⇧ click'], ['Change pitch with mouse', 'Drag vertically']].map(([label, keys]) => <div key={label}><span>{label}</span><kbd>{keys}</kbd></div>)}</div><p className="property-note">Duration edits show their balancing operation before applying. Tied pitches and unsupported structural rhythms are preserved.</p></Modal>}
  </div>;
}
