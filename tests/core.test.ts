import { describe, expect, test } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { ScoreDocument } from '../src/core/editor';
import { changedEvents, normalizedEvents, parseScore } from '../src/core/model';
import { applyPatches, decodeSource, parseXml } from '../src/core/xml';
import { orchestralFixture } from '../scripts/fixtures';

const xml = (content: string, attributes = '') => `\uFEFF<?xml version="1.0" encoding="UTF-8"?>\r\n<!-- café 🎵 untouched -->\r\n<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1"><measure number="44"${attributes}><attributes><divisions>12</divisions><key><fifths>1</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time></attributes>${content}</measure></part></score-partwise>\r\n`;
const note = (step = 'F', duration = 12, extra = '', voice = '1', type = 'quarter') => `<note data-other="keep &amp; preserve">${extra}<pitch>\n  <step>${step}</step>\n  <alter>1</alter>\n  <octave>4</octave>\n</pitch><duration>${duration}</duration><voice>${voice}</voice><type>${type}</type><accidental cautionary="yes">sharp</accidental><staff>1</staff><notations><other-notation type="single">untouched</other-notation></notations></note>`;
const rest = (duration = 12, type = 'quarter', voice = '1') => `<note><rest/><duration>${duration}</duration><voice>${voice}</voice><type>${type}</type><staff>1</staff></note>`;
const balanced = () => xml(note() + rest() + note('G') + rest());

describe('Source preservation and safe editing', () => {
  test('no-op round trip preserves UTF-8 BOM, Unicode, CRLF, comments and all bytes', () => {
    const bytes = new TextEncoder().encode(balanced()); const doc = new ScoreDocument(decodeSource(bytes));
    doc.validateSave(); expect(new TextEncoder().encode(doc.source)).toEqual(bytes); expect(doc.dirty).toBe(false);
  });
  test('F-sharp to F-natural updates exactly two scalar ranges, retaining courtesy attributes', () => {
    const source = balanced(), doc = new ScoreDocument(source), before = doc.model;
    doc.setAccidental(['0:0:0'], 0);
    expect(doc.source).toBe(source.replace('<alter>1</alter>', '<alter>0</alter>').replace('>sharp</accidental>', '>natural</accidental>'));
    expect(changedEvents(before, doc.model)).toEqual(['0:0:0']);
    expect(doc.source).toContain('<accidental cautionary="yes">natural</accidental>');
  });
  test('insert absent alter and accidental in schema order without rewriting a note', () => {
    const source = balanced().replace('<alter>1</alter>', '').replace('<accidental cautionary="yes">sharp</accidental>', '');
    const doc = new ScoreDocument(source); doc.setAccidental(['0:0:0'], -2);
    expect(doc.source).toContain('<alter>-2</alter>'); expect(doc.source).toContain('<accidental>flat-flat</accidental>');
    expect(doc.source.indexOf('<alter>-2')).toBeLessThan(doc.source.indexOf('<octave>4'));
    doc.undo(); expect(doc.source).toBe(source); doc.redo(); expect(doc.note('0:0:0').pitch?.alter).toBe(-2);
  });
  test('quarter to eighth explicitly adjusts only the adjacent rest; later onsets are unchanged', () => {
    const doc = new ScoreDocument(balanced()), before = doc.model;
    const plan = doc.planDuration('0:0:0', 'eighth', 0); expect(plan.description).toContain('following rest'); doc.applyPlan(plan);
    expect(doc.note('0:0:0').duration.toString()).toBe('1/2'); expect(doc.note('0:0:1').duration.toString()).toBe('3/2');
    expect(doc.note('0:0:1').dots).toBe(1); expect(changedEvents(before, doc.model)).toEqual(['0:0:0', '0:0:1']);
    expect(doc.model.diagnostics).toEqual([]);
  });
  test('unbalanced duration edit and fractional ticks are rejected before any mutation', () => {
    const source = xml(note() + note('G') + note('A') + note('B')), doc = new ScoreDocument(source);
    expect(() => doc.planDuration('0:0:0', 'eighth', 0)).toThrow(/unbalanced/);
    expect(() => doc.planDuration('0:0:0', '64th', 0)).toThrow(/exactly representable/); expect(doc.source).toBe(source);
  });
  test('the other voice stays byte-identical after a pitch and a coordinated duration edit', () => {
    const other = note('C', 48, '', '2', 'whole'); const source = xml(note() + rest() + note('G') + rest() + '<backup><duration>48</duration></backup>' + other);
    const doc = new ScoreDocument(source), before = doc.model; doc.setAccidental(['0:0:0'], 0); doc.applyPlan(doc.planDuration('0:0:0', 'eighth', 0));
    expect(doc.source).toContain(other); expect(changedEvents(before, doc.model)).toEqual(['0:0:0', '0:0:1']); expect(doc.note('0:0:4').onset.toString()).toBe('0');
  });
  test('each chord pitch is independent, and duration edits coordinate the whole chord', () => {
    const source = xml(note() + note('A', 12, '<chord/>') + rest() + note('G') + rest()); const doc = new ScoreDocument(source), before = doc.model;
    doc.setAccidental(['0:0:1'], -1); expect(changedEvents(before, doc.model)).toEqual(['0:0:1']);
    const plan = doc.planDuration('0:0:1', 'eighth', 0); expect(plan.ids).toEqual(['0:0:0', '0:0:1', '0:0:2']); doc.applyPlan(plan);
    expect(doc.note('0:0:0').duration.equals(doc.note('0:0:1').duration)).toBe(true); expect(doc.model.diagnostics).toEqual([]);
  });
  test('tuplets use exact timing and retain their notation on a pitch edit', () => {
    const tuplet = '<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>';
    const triplets = ['F', 'G', 'A'].map(step => note(step, 4, '', '1', 'eighth').replace('<staff>1</staff>', tuplet + '<staff>1</staff>')).join('');
    const doc = new ScoreDocument(xml(triplets + rest(36, 'half').replace('<type>half</type>', '<type>half</type><dot/>')));
    expect(doc.model.diagnostics).toEqual([]); expect(doc.note('0:0:2').onset.toString()).toBe('2/3');
    doc.setAccidental(['0:0:1'], 0); expect(doc.source.split(tuplet).length).toBe(4);
    expect(() => doc.planDuration('0:0:1', 'quarter', 0)).toThrow(/tuplets/);
  });
  test('multi-select edits form one undoable transaction and redo restores exact edited bytes', () => {
    const source = balanced(), doc = new ScoreDocument(source); doc.movePitch(['0:0:0', '0:0:2'], 1); const edited = doc.source;
    expect(doc.changes).toHaveLength(1); doc.undo(); expect(doc.source).toBe(source); expect(doc.dirty).toBe(false); doc.redo(); expect(doc.source).toBe(edited);
    doc.undo(); doc.setAccidental(['0:0:0'], -1); expect(doc.canRedo).toBe(false);
  });
  test('spelling, transposition and enharmonic identity are distinct', () => {
    const doc = new ScoreDocument(balanced().replace('</attributes>', '<transpose><chromatic>-2</chromatic></transpose></attributes>'));
    expect(doc.note('0:0:0').transpose).toBe(-2); doc.respell('0:0:0'); expect(doc.note('0:0:0').pitch).toEqual({ step: 'G', alter: -1, octave: 4 });
    expect(doc.source).toContain('<chromatic>-2</chromatic>'); doc.movePitch(['0:0:0'], 1, true); expect(doc.note('0:0:0').pitch?.alter).toBe(-1);
  });
  test('ties and microtones are preserved and unsafe edits are rejected', () => {
    const source = balanced().replace('<notations>', '<tie type="start"/><notations>'); const doc = new ScoreDocument(source);
    expect(() => doc.movePitch(['0:0:0'], 1)).toThrow(/tie/); expect(doc.source).toBe(source);
    const micro = new ScoreDocument(balanced().replace('<alter>1</alter>', '<alter>0.5</alter>'));
    expect(() => micro.setAccidental(['0:0:0'], 0)).toThrow(/Microtonal/);
  });
  test('unknown namespaces, CDATA, comments, quote styles and layout survive an unrelated edit', () => {
    const source = balanced().replace('version="4.0"', "version='4.0' xmlns:x='urn:test'").replace('<part-list>', '<defaults><scaling><millimeters>7</millimeters><tenths>40</tenths></scaling></defaults><x:metadata key=\"&gt;\"><![CDATA[a < b]]></x:metadata><part-list>');
    const doc = new ScoreDocument(source); doc.setAccidental(['0:0:0'], 0);
    expect(doc.source).toBe(source.replace('<alter>1</alter>', '<alter>0</alter>').replace('>sharp</accidental>', '>natural</accidental>'));
  });
  test('qualified MusicXML elements retain their prefixes during new-field insertion', () => {
    const source = balanced().replace(/<(\/?)([\w-]+)/g, '<$1m:$2').replace('<m:score-partwise ', '<m:score-partwise xmlns:m="urn:musicxml" ').replace(/<m:alter>1<\/m:alter>/, '');
    const doc = new ScoreDocument(source); doc.setAccidental(['0:0:0'], -1); expect(doc.source).toContain('<m:alter>-1</m:alter>');
  });
  test('stale edit previews and overlapping patches are rejected', () => {
    const doc = new ScoreDocument(balanced()); const plan = doc.planDuration('0:0:0', 'eighth', 0); doc.setAccidental(['0:0:0'], 0);
    expect(() => doc.applyPlan(plan)).toThrow(/changed/); expect(() => applyPatches('abc', [{ start: 0, end: 2, text: '', label: '' }, { start: 1, end: 3, text: '', label: '' }])).toThrow(/Overlapping/);
  });
  test('rest edits use the same explicit balanced-pair workflow', () => {
    const doc = new ScoreDocument(xml(rest() + rest() + note('G') + rest())); doc.applyPlan(doc.planDuration('0:0:0', 'eighth', 0));
    expect(doc.note('0:0:0').rest).toBe(true); expect(doc.model.diagnostics).toEqual([]);
  });
  test('safe voice changes retain chronology; overlaps are blocked', () => {
    const doc = new ScoreDocument(balanced()); const before = doc.model; doc.changeVoice('0:0:0', '2');
    expect(changedEvents(before, doc.model)).toEqual(['0:0:0']); expect(doc.note('0:0:0').onset.toString()).toBe('0');
    const busy = new ScoreDocument(xml(note() + rest() + note('G') + rest() + '<backup><duration>48</duration></backup>' + note('C', 48, '', '2', 'whole')));
    expect(() => busy.changeVoice('0:0:0', '2')).toThrow(/overlaps/);
  });
});

describe('Validation and orchestral regressions', () => {
  test('incomplete, overfilled, backup, chord and tuplet inconsistencies are diagnosed', () => {
    expect(parseScore(xml(note())).diagnostics.some(d => d.code === 'INCOMPLETE' && d.actual === '1/4')).toBe(true);
    expect(parseScore(xml(note('F', 60, '', '1', 'whole'))).diagnostics.some(d => d.code === 'OVERFILLED')).toBe(true);
    expect(parseScore(xml('<backup><duration>12</duration></backup>' + note())).diagnostics.some(d => d.code === 'BACKUP')).toBe(true);
    expect(parseScore(xml(note('F', 12, '<chord/>'))).diagnostics.some(d => d.code === 'CHORD')).toBe(true);
    expect(parseScore(xml(note('F', 6))).diagnostics.some(d => d.code === 'NOTATION_DURATION')).toBe(true);
  });
  test('chords, grace, pickups, partial secondary voices and cross-staff movement are not summed', () => {
    expect(parseScore(xml(note() + note('A', 12, '<chord/>') + rest() + note('G') + rest())).diagnostics).toEqual([]);
    expect(parseScore(xml('<note><grace/><pitch><step>C</step><octave>5</octave></pitch><type>eighth</type></note>' + note() + rest() + note('G') + rest())).diagnostics).toEqual([]);
    expect(parseScore(xml(note(), ' implicit="yes"')).diagnostics).toEqual([]);
    expect(parseScore(xml(note('F', 48, '', '1', 'whole') + '<backup><duration>48</duration></backup>' + note('G', 12, '', '2'))).diagnostics).toEqual([]);
    const cross = xml(note('F', 24, '', '1', 'half') + note('G', 24, '', '1', 'half').replace('<staff>1</staff>', '<staff>2</staff>'));
    expect(parseScore(cross).diagnostics).toEqual([]);
  });
  test('pre-existing errors are reported but do not block an unrelated safe pitch correction', () => {
    const doc = new ScoreDocument(xml(note())); expect(doc.validateSave().existing).toBe(1); doc.setAccidental(['0:0:0'], 0); expect(doc.validateSave().existing).toBe(1);
  });
  test('decimal duration/divisions fields are interpreted exactly and retained on pitch edits', () => {
    const source = balanced().replace(/<divisions>12<\/divisions>/, '<divisions>1.5</divisions>').replace(/<duration>12<\/duration>/g, '<duration>1.5</duration>');
    const doc = new ScoreDocument(source); expect(doc.model.diagnostics).toEqual([]); expect(doc.note('0:0:2').onset.toString()).toBe('2');
    doc.setAccidental(['0:0:0'], 0); expect(doc.source).toContain('<duration>1.5</duration>');
  });
  test('ambiguous duplicate fields are diagnosed and edits are refused', () => {
    const source = balanced().replace('<step>F</step>', '<step>F</step><step>G</step>'); const doc = new ScoreDocument(source);
    expect(doc.model.diagnostics.some(d => d.code === 'NOTE_CARDINALITY')).toBe(true);
    expect(() => doc.setAccidental(['0:0:0'], 0)).toThrow(/ambiguous/); expect(doc.source).toBe(source);
  });
  test('entity declaration text inside a comment is ordinary preserved content', () => {
    const source = balanced().replace('café 🎵 untouched', '<!ENTITY example> is just comment text'); const doc = new ScoreDocument(source); doc.setAccidental(['0:0:0'], 0);
    expect(doc.source).toContain('<!-- <!ENTITY example> is just comment text -->');
  });
  test('overlapping voice cursors and insufficient forwards are diagnosed', () => {
    const overlap = parseScore(xml(note() + '<backup><duration>12</duration></backup>' + note('G')));
    expect(overlap.diagnostics.some(d => d.code === 'VOICE_OVERLAP')).toBe(true);
    const incomplete = parseScore(xml(note() + '<forward><duration>12</duration><voice>1</voice><staff>1</staff></forward>'));
    expect(incomplete.diagnostics.some(d => d.code === 'INCOMPLETE')).toBe(true);
    expect(parseScore(xml(note() + '<forward><duration>36</duration><voice>1</voice><staff>1</staff></forward>')).diagnostics).toEqual([]);
  });
  test('malformed documents, unsupported formats and entity declarations fail safely', () => {
    for (const source of ['<score-partwise><note></score-partwise>', '<score-timewise/>', '<score-partwise/>', '<!DOCTYPE x [<!ENTITY x "boom">]><score-partwise/>']) expect(() => new ScoreDocument(source)).toThrow();
    expect(() => parseXml('<x a="1" a="2"/>')).toThrow();
    expect(() => decodeSource(new Uint8Array([0xff, 0xfe]))).toThrow(/UTF-8/);
  });
  test('representative orchestral source has 20 instruments, 250 measures and stable identity', () => {
    const source = orchestralFixture(250, 20), doc = new ScoreDocument(source);
    expect(doc.model.parts).toHaveLength(20); expect(doc.model.measures).toBe(250); expect(doc.model.diagnostics).toEqual([]);
    const before = doc.model; doc.setAccidental(['3:120:1'], 1);
    expect(changedEvents(before, doc.model)).toEqual(['3:120:1']); doc.undo(); expect(doc.source).toBe(source);
  }, 30000);
  const realPath = new URL('../fixtures/local/rachmaninoff-variation18.musicxml', import.meta.url);
  test.skipIf(!existsSync(realPath))('private Rachmaninoff orchestral regression: no-op bytes and one independent pitch event', () => {
    const bytes = readFileSync(realPath), doc = new ScoreDocument(decodeSource(bytes)); expect(Buffer.from(doc.source)).toEqual(bytes);
    const note = [...doc.model.notes.values()].find(n => n.pitch && !n.ties.length && !n.tiedNotation && Number.isInteger(n.pitch.alter) && Math.abs(n.pitch.alter) <= 1)!;
    expect(note).toBeDefined(); const before = doc.model; doc.setAccidental([note.id], note.pitch!.alter === 0 ? 1 : 0);
    expect(changedEvents(before, doc.model)).toEqual([note.id]); expect(normalizedEvents(before).length).toBe(normalizedEvents(doc.model).length);
    doc.undo(); expect(Buffer.from(doc.source)).toEqual(bytes);
  }, 30000);
});
