import { SaxesParser } from 'saxes';

export class ScoreError extends Error {
  constructor(message: string, readonly code = 'UNSAFE_EDIT') { super(message); this.name = 'ScoreError'; }
}
export interface XmlElement {
  name: string; local: string; namespace: string; attributes: Record<string, string>;
  start: number; openEnd: number; closeStart: number; end: number;
  selfClosing: boolean; children: XmlElement[]; parent?: XmlElement;
}
export interface Patch { start: number; end: number; text: string; label: string }
export const child = (element: XmlElement, name: string) => element.children.find(c => c.local === name && c.namespace === element.namespace);
export const children = (element: XmlElement, name: string) => element.children.filter(c => c.local === name && c.namespace === element.namespace);
export const decodeXml = (value: string) => value.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[\da-f]+);/gi, (_, entity: string) => {
  if (entity[0] === '#') return String.fromCodePoint(entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : Number(entity.slice(1)));
  return ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" } as Record<string, string>)[entity];
});
export const encodeXml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
export const value = (source: string, element?: XmlElement) => element ? decodeXml(source.slice(element.openEnd, element.closeStart).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<!--[\s\S]*?-->/g, '').trim()) : '';
export const field = (source: string, element: XmlElement, name: string, fallback = '') => value(source, child(element, name)) || fallback;

/** Validate separately; the source tree stores offsets, never serialized DOM data. */
export function parseXml(source: string): XmlElement {
  if (source.length > 200_000_000) throw new ScoreError('This file exceeds the 200 MB safety limit.', 'INPUT_LIMIT');
  const parser = new SaxesParser({ xmlns: true });
  parser.on('doctype', declaration => { if (/<!ENTITY\s/i.test(declaration)) throw new ScoreError('XML entity declarations are not supported. The original file has not been changed.', 'UNSUPPORTED_XML'); });
  parser.on('error', error => { throw new ScoreError(`XML syntax error: ${error.message}`, 'INVALID_XML'); });
  try { parser.write(source).close(); } catch (error) { if (error instanceof ScoreError) throw error; throw new ScoreError(String(error), 'INVALID_XML'); }
  const stack: XmlElement[] = [];
  const namespaces: Record<string, string>[] = [];
  let root: XmlElement | undefined, position = 0;
  while (position < source.length) {
    const start = source.indexOf('<', position);
    if (start < 0) break;
    if (source.startsWith('<!--', start)) { position = source.indexOf('-->', start) + 3; continue; }
    if (source.startsWith('<![CDATA[', start)) { position = source.indexOf(']]>', start) + 3; continue; }
    if (source.startsWith('<?', start)) { position = source.indexOf('?>', start) + 2; continue; }
    let end = start + 1, quote = '', depth = 0;
    for (; end < source.length; end++) {
      const character = source[end];
      if (quote) { if (character === quote) quote = ''; }
      else if (character === '"' || character === "'") quote = character;
      else if (character === '[') depth++;
      else if (character === ']') depth--;
      else if (character === '>' && depth === 0) break;
    }
    const token = source.slice(start + 1, end);
    position = end + 1;
    if (token.startsWith('!')) continue;
    if (token.startsWith('/')) {
      const element = stack.pop()!; namespaces.pop();
      element.closeStart = start; element.end = position;
      continue;
    }
    const name = token.match(/^[^\s/>]+/)![0];
    const attributes: Record<string, string> = {};
    for (const match of token.slice(name.length).matchAll(/([^\s=]+)\s*=\s*(["'])([\s\S]*?)\2/g)) attributes[match[1]] = decodeXml(match[3]);
    const ns = { ...(namespaces.at(-1) ?? {}) };
    for (const [key, val] of Object.entries(attributes)) if (key === 'xmlns') ns[''] = val; else if (key.startsWith('xmlns:')) ns[key.slice(6)] = val;
    const prefix = name.includes(':') ? name.split(':')[0] : '';
    const selfClosing = /\/\s*$/.test(token);
    const element: XmlElement = { name, local: name.split(':').at(-1)!, namespace: ns[prefix] ?? '', attributes, start, openEnd: position, closeStart: selfClosing ? position : 0, end: selfClosing ? position : 0, selfClosing, children: [], parent: stack.at(-1) };
    if (element.parent) element.parent.children.push(element); else root = element;
    if (!selfClosing) { stack.push(element); namespaces.push(ns); }
  }
  if (!root) throw new ScoreError('The file contains no XML document.', 'INVALID_XML');
  return root;
}

export function applyPatches(source: string, input: Patch[]): string {
  const patches = input.filter(p => source.slice(p.start, p.end) !== p.text).sort((a, b) => a.start - b.start || a.end - b.end);
  let end = 0;
  for (const patch of patches) {
    if (patch.start < end || patch.start < 0 || patch.end < patch.start || patch.end > source.length) throw new ScoreError('Overlapping source patches were rejected.');
    end = patch.end;
  }
  let result = source;
  for (const patch of [...patches].reverse()) result = result.slice(0, patch.start) + patch.text + result.slice(patch.end);
  return result;
}

export function scalarPatch(source: string, element: XmlElement, next: string, label: string): Patch {
  if (element.selfClosing) throw new ScoreError(`An empty ${element.local} field cannot be safely edited.`);
  const raw = source.slice(element.openEnd, element.closeStart);
  const match = /^(\s*)([^<]*?)(\s*)$/.exec(raw);
  if (!match) throw new ScoreError(`The ${element.local} field contains XML markup. This edit is unsupported; its content is preserved.`);
  return { start: element.openEnd + match[1].length, end: element.closeStart - match[3].length, text: encodeXml(next), label };
}
export function qualified(parent: XmlElement, name: string) { return parent.name.includes(':') ? `${parent.name.split(':')[0]}:${name}` : name; }
export function insertPatch(source: string, parent: XmlElement, before: XmlElement | undefined, markup: string, label: string): Patch {
  if (parent.selfClosing) throw new ScoreError('Expanding empty XML elements is not supported by this operation.');
  const at = before?.start ?? parent.closeStart;
  const line = source.slice(source.lastIndexOf('\n', at - 1) + 1, at);
  const indent = /^\s*$/.test(line) ? line : '';
  const newline = source.includes('\r\n') ? '\r\n' : '\n';
  return { start: at, end: at, text: markup + (indent ? newline + indent : ''), label };
}
export function setField(source: string, parent: XmlElement, name: string, next: string, order: string[], label: string): Patch {
  const existing = child(parent, name);
  if (existing) return scalarPatch(source, existing, next, label);
  const index = order.indexOf(name);
  const before = parent.children.find(c => c.namespace === parent.namespace && order.indexOf(c.local) > index);
  const tag = qualified(parent, name);
  return insertPatch(source, parent, before, `<${tag}>${encodeXml(next)}</${tag}>`, label);
}

export function decodeSource(bytes: Uint8Array): string {
  let source: string;
  try { source = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { throw new ScoreError('This version supports UTF-8 MusicXML only. The original encoding and file are preserved.', 'ENCODING'); }
  const declaration = source.slice(0, 250).match(/<\?xml[^?]*encoding\s*=\s*["']([^"']+)/i)?.[1];
  if (declaration && !/^(utf-8|utf8|us-ascii)$/i.test(declaration)) throw new ScoreError(`The ${declaration} encoding is not supported for editing.`, 'ENCODING');
  return source;
}
