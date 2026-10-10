# Swift native editor — 0.4.1

The entry point is a SwiftUI App with native commands, dialogs, a white minimal interface and an AppKit vector canvas. The old command launcher was removed. Command+Left/Right flips shared pages; Up/Down moves by a semitone and Shift adds octave movement. Note entry and grouped Notes/Notation/Bar tools now support broader composition editing. The full capability boundary is in [FULL_EDITOR.md](FULL_EDITOR.md).

## 0.4.1 native follow-up and executed GUI checks

After the Mac was unlocked, native testing found and corrected missing text Select All, text Undo/Redo routing, initial save protection for new compositions, a clipped accidental label and a blank full-bar rest duration display.

The corrected compiled frontend was tested in an isolated copy with a separate test app identifier, because multiple open SourceScore copies made the UI connection ambiguous. The application code and resources matched the production build; only test bundle identity and document registration metadata differed.

- Cmd+A replaced the new-score title correctly; Cmd+Z and Cmd+Shift+Z restored/redid focused text editing.
- A freshly created blank score showed Edited and prompted to save on Quit. Cancel retained the score; a successful Save cleared the unsaved state and subsequent Quit completed normally.
- The entry strip displayed the full Key signature label, and the Notes inspector displayed Full bar for the full-measure rest.
- C/D/E/F entry filled the first piano staff's bar and advanced the cursor. Cmd+C/V pasted C4 into bar 3. Delete replaced that note with a rest; Undo/Redo restored the appropriate note/rest.
- Up changed C4 to C-sharp4. Undo restored its original spelling. Command+Right/Left moved between pages 1 and 2.
- The grouped Notation list exposed bar, key, time and clef objects without redundant pitch/scalar rows. Typed cantabile text was added, saved via the native dialog and remained present after a fresh application launch and Open.
- The saved generated score passed the local MusicXML 4.0 XSD. The earlier dynamic edit/delete and chord-entry check also produced a schema-valid saved file.

These are executed local checks. Full professional editing parity remains bounded by [FULL_EDITOR.md](FULL_EDITOR.md).

## 0.4 changes and validation

- New native composition setup; A–G/R entry, automatic cursor advance, rest splitting, chords, grace notes, values/dots, individual/event deletion and compensating duration edits.
- Structural identity snapshots preserve surviving note/bar identities across insertion, deletion, rebasing and mixed pitch/structural undo. Generated identities never become MusicXML IDs.
- A native musical property inspector adds/edits/deletes common notation, lyrics, text, dynamics and tempo. Pitch fields remain in the coordinated pitch path; unsafe independent paired-marker type/number edits are replaced by endpoint/span operations. Existing note and bar objects have source-aligned native hit targets.
- Voice creation, staff reassignment, synchronized bar insertion/deletion and signatures/repeats. Inserted/deleted bars carry inherited attributes in valid MusicXML order while retaining original labels and unrelated source. Conventional empty bars fit changed meters, with coordinated backup values and protection for marked/extended rests.
- Single-voice/staff source clipboard, with written pitch and defined span/reference omissions. Incompatible musical namespaces, discontinuous passages and undersized destinations are rejected; copied MusicXML unique note IDs are removed.
- Accidental decisions also propagate to affected later notes after pitch/structural/key changes. New chord selection survives an accidental inserted on an existing root. Ordinary visible tempo/dynamic edits coordinate existing playback fields.
- **82 source tests passed**, including structural source isolation, unknown/prefixed XML, exact timing, chord root promotion, grace timing, tuplets and metadata, stable identities/history, signatures, meter fitting, spans, clipboard and the prior 122,250-event pitch regression. TypeScript compilation passed.
- Official local MusicXML 4.0 XSD checks passed for **28 generated editing stages plus an empty piano meter scenario**. These validate generated workflow output and do not establish full runtime/schema coverage of arbitrary imports and extensions. The optional repeatable command is `npm run test:editing-schema -- /path/to/musicxml.xsd`; the schema's `xml.xsd` and `xlink.xsd` imports must be available locally. The check skips explicitly if the schema is absent.
- An intermediate native 0.4 build created an eight-bar piano composition, entered C4/D4/E4/F4, deleted C4 into a quarter rest, saved through the native dialog and reopened with D4/E4/F4 intact. The notation inspector added mf, changed it to ff and deleted the marking while retaining note selection. Displayed operation measurements ranged from 8–39 ms in those checks; they are individual measurements, not guarantees.
- Final standalone Swift checks passed for new composition/keyboard/chord input, notation responses, structural save, event deletion, exact mixed undo, empty-meter fitting/backups and the prior persistence/audio/playback/tie checks. The local pitch check measured 1.88 ms.
- Final engraving checks passed for six-part synthetic and eight-part private fixtures, including bar/staff hit regions, unchanged XML and full note mapping. A generated composition with chord entry, tuplets, lyrics, articulation and dynamics also rendered with all source identities mapped.
- The 0.4 release built as arm64 version 0.4.0 and passed strict bundle-signature verification. Its GUI pass was initially interrupted by a Mac lock; the subsequent completed follow-up is recorded above.

The final native bridge, engraving and package checks are recorded in the release handoff. Complete professional parity, rebar/ripple editing, universal glyph manipulation and full orchestral qualification remain outstanding.

## 0.3 changes and executed validation (historical)

- Complete tie chains are indexed by exact rational musical time, voice, sounding pitch and visual tie number. A selected continuation changes all connected notes atomically, retaining original tie notation and exact undo. Missing/ambiguous/conditional endpoints remain guarded. Ordinary fret changes follow semitone movement on the existing string; a below-open-string move, harmonic or bend remains guarded.
- Automatic accidental glyphs use the active key context, staff, octave, earlier alterations and simultaneous conflicts. Pitch alteration is independent of the printed glyph. Existing courtesy markings are preserved. This follows MusicXML's distinction between [pitch alteration and printed accidental](https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/accidental/) and [sounding and notated ties](https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/tied/).
- A native mixer supplies instrument Mute, multiple Solo, volume, pan and sound controls, following [MuseScore's channel controls](https://handbook.musescore.org/sound-and-playback/mixer). Per-part AVAudioMixerNodes apply live mix changes without altering source or restarting the transport.
- An explicit From bar field and inspector Play this instrument action provide bar/instrument playback. The timeline follows measure boundaries even during silence, flips pages and follows wrapped systems. Stop/seek/edit/open invalidate queued transport callbacks.
- The native OSMD 1.9.9 adapter equalizes inter-instrument gaps before final connector/bracket placement, keeps each instrument's internal staff spacing and distributes spare viewport height. It trims unused SVG canvas space. Source print/layout metadata is unchanged. Window and mixer size changes refresh the presentation.
- 47 source tests passed, including linked pitch edits and notated continuations, exact source isolation/undo, accidental key/bar/voice context through backups and staff-specific key changes, courtesy flags, fret safety, and the previous large-score regression. TypeScript checks now include the native bridge/renderer entry points.
- Duration previews carry the current source revision, so a later pitch correction cannot be overwritten by a stale preview. Closing/quitting waits for queued edits before deciding whether changes need saving. Closing a score stops its playback.
- The standalone Swift checks passed: source bridge, file backups/atomic saves/conflicts, vector identity, tempo clock, bar/page boundaries, solo/mute routing, actual piano/flute audio, silent excluded channels, native connected-note responses and sustained tie playback segments. Pitch processing measured about 1–2 ms locally.
- Native engraving checks passed for the synthetic six-part and private eight-part fixtures: aligned bars, uniform instrument gaps, full note mapping, unchanged authoritative XML. The simple page used the requested 1100-pixel height exactly; the dense excerpt remained scrollable.
- Packaged-app checks started solo flute at bar 4 and advanced from page 1 to page 3 automatically. Both Command page shortcuts worked. Editing the middle of a three-note tie chain changed all three F-sharp5 notes to G5 and reported 30 ms, without the former alert. Native Save As saved only those pitch fields and removed the redundant accidental; all remaining bytes, including tie curves and unknown metadata, matched the original test source.
- A fresh MuseScore converter check did not complete because the reader process remained unresponsive and produced no output. It was stopped without touching user scores; no new MuseScore interoperability result is claimed for this checkpoint. The earlier reader check below remains historical.

These are local executed checks, not universal latency, schema or full concerto guarantees. Repeat/conditional ties, advanced rhythmic coordination and the limitations in README remain outstanding.

## Source and latency

`FastDocument` keeps immutable lexical anchors. Pitch input creates and validates a namespace-aware note patch and records exact before/after XML. Engraving composes only the requested measures; saving combines the original source and committed patches without model regeneration. Structural operations rebase through the validated editor and retain interoperable undo/redo.

`CoreEngine` executes the portable engine in JavaScriptCore on a serial background queue. Edit responses contain affected note properties only, eliminating the former full-score reparse and snapshot transfer. Save performs full validation in the background.

## Rendering

OSMD is a private offscreen engraver with a shared four-measure page range. Source page/system breaks and multi-rest compression are adapted only in the presentation copy. Each render checks equal measure X positions across staves.

Swift parses the result into Core Graphics paths, transforms, text and note identities. `CanvasView` draws and edits native vectors with click/drag/keyboard handling and note accessibility elements. Selected pitch previews update immediately while a debounced engraving pass catches up. There are no visible HTML controls or screenshot-based score editing.

## Audio

AVAudioEngine hosts one AVAudioUnitSampler per part. The built-in macOS General MIDI DLS bank supplies instrument sounds and is referenced from the OS, not redistributed. SF2/DLS alternatives are supported. XML programs and instrument-name fallback mappings choose sounds. Source transpose, voice/chord timing, basic ties, tempo changes and approximate dynamic velocities drive playback.

An offline audio check renders piano and flute samples and asserts non-silence and different waveforms. Detailed articulation, ornaments, expression, microtones, unpitched percussion and exceptional conventions remain approximate or unsupported.

## 0.2 validation baseline (historical)

- 34 TypeScript tests passed, including local pitch isolation, exact undo/redo across rhythm rebases, semitone/octave crossing and rapid edits on 122,250 events without rebuilding the model.
- The standalone Swift check measured 1.04 ms for a JavaScriptCore pitch edit; no-op/undo, atomic save/backup/conflict protection and native vector identity checks passed. Real piano/flute waveforms were nonzero and different. Tempo conversion is checked.
- The final packaged Swift app launched with all seven example staves and four aligned bars. Option+Right moved from page 1 to page 2 and Option+Left returned to page 1. Selecting an accessible note and pressing Up changed F-sharp5 to G5 and reported a 29 ms update; Down returned to F-sharp5 in 27 ms.
- Native Save As wrote the G5 correction to a disposable file. A raw diff showed changes only inside that note. Down followed by Cmd+S wrote F-sharp5 and created an exact backup of the pre-overwrite G5 file. Play changed to Stop; playback controls produced no error.
- Renderer measurements found identical X positions and widths for corresponding bars across all seven staves. A wider bounded page avoids the prior accidental single-bar line spanning the canvas.
- The private eight-part, 17-measure orchestral excerpt opened in the packaged Swift app with five shared pages. Corresponding barlines aligned across all eight parts; dense writing may wrap into multiple systems within a scrollable page. The excerpt omits some initial clef/staff attributes, so this check does not establish fidelity to a complete source score.

The source was pushed to the public repository at https://github.com/skylinehenrry/sourcescore. Only the synthetic study is tracked; private score fixtures and generated binaries remain excluded.

The 0.1 validation/performance files are historical. Complete real concerto visual qualification and broader native playback/lifecycle coverage remain priorities. Executed tests and local measurements are not universal losslessness or latency guarantees.
