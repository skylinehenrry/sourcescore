import { invoke, isTauri } from '@tauri-apps/api/core';
import { open, save, confirm } from '@tauri-apps/plugin-dialog';
import { decodeSource } from '../core/xml';
export const desktop = isTauri();
export interface FileReference { name: string; path?: string; sessionId?: string; hash?: string }
interface OpenResult { sessionId: string; path: string; base64: string; hash: string }
export interface SaveResult { path: string; hash: string; backup?: string; unchanged: boolean }
export const fileName = (path: string) => path.split('/').at(-1) ?? path;
export async function chooseFile(): Promise<string | null> {
  const path = await open({ multiple: false, directory: false, title: 'Open MusicXML score', filters: [{ name: 'MusicXML score', extensions: ['musicxml', 'xml'] }] });
  return typeof path === 'string' ? path : null;
}
export async function readNative(path: string) {
  const result = await invoke<OpenResult>('open_score', { path });
  try { return { source: decodeSource(Uint8Array.from(atob(result.base64), c => c.charCodeAt(0))), file: { name: fileName(result.path), path: result.path, sessionId: result.sessionId, hash: result.hash } as FileReference }; }
  catch (error) { await invoke('release_score', { sessionId: result.sessionId }); throw error; }
}
export async function releaseFile(file?: FileReference) { if (desktop && file?.sessionId) await invoke('release_score', { sessionId: file.sessionId }); }
export async function saveNative(file: FileReference, source: string) {
  if (!file.sessionId) throw new Error('Use Save As to choose a destination for this score.');
  return invoke<SaveResult>('save_score', { sessionId: file.sessionId, source });
}
export async function saveAsNative(file: FileReference, source: string): Promise<FileReference | undefined> {
  const path = await save({ title: 'Save MusicXML score as', defaultPath: file.path ?? file.name, filters: [{ name: 'MusicXML score', extensions: ['musicxml', 'xml'] }] });
  if (!path) return;
  const grant = await invoke<string>('prepare_save_as', { path });
  const result = await invoke<OpenResult>('save_as_score', { grant, sessionId: file.sessionId ?? null, source });
  return { path: result.path, name: fileName(result.path), sessionId: result.sessionId, hash: result.hash };
}
export function downloadSource(name: string, source: string) {
  const url = URL.createObjectURL(new Blob([new TextEncoder().encode(source)], { type: 'application/vnd.recordare.musicxml+xml' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export async function confirmDiscard() {
  return desktop ? confirm('Discard the unsaved changes to this score?', { title: 'Unsaved changes', kind: 'warning', okLabel: 'Discard changes', cancelLabel: 'Keep editing' }) : window.confirm('Discard the unsaved changes to this score?');
}
