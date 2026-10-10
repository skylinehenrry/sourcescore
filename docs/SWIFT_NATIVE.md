# Swift native migration — 0.2

The entry point is now a SwiftUI App with native commands, dialogs, a white minimal interface and an AppKit vector canvas. The old command launcher was removed. Option+Left/Right flips shared pages; Up/Down moves by a semitone and Shift adds octave movement. Conservative duration/rest/chord/voice workflows remain in a compact inspector.

## Source and latency

`FastDocument` keeps immutable lexical anchors. Pitch input creates and validates a namespace-aware note patch and records exact before/after XML. Engraving composes only the requested measures; saving combines the original source and committed patches without model regeneration. Structural operations rebase through the validated editor and retain interoperable undo/redo.

`CoreEngine` executes the portable engine in JavaScriptCore on a serial background queue. Edit responses contain affected note properties only, eliminating the former full-score reparse and snapshot transfer. Save performs full validation in the background.

## Rendering

OSMD is a private offscreen engraver with a shared four-measure page range. Source page/system breaks and multi-rest compression are adapted only in the presentation copy. Each render checks equal measure X positions across staves.

Swift parses the result into Core Graphics paths, transforms, text and note identities. `CanvasView` draws and edits native vectors with click/drag/keyboard handling and note accessibility elements. Selected pitch previews update immediately while a debounced engraving pass catches up. There are no visible HTML controls or screenshot-based score editing.

## Audio

AVAudioEngine hosts one AVAudioUnitSampler per part. The built-in macOS General MIDI DLS bank supplies instrument sounds and is referenced from the OS, not redistributed. SF2/DLS alternatives are supported. XML programs and instrument-name fallback mappings choose sounds. Source transpose, voice/chord timing, basic ties, tempo changes and approximate dynamic velocities drive playback.

An offline audio check renders piano and flute samples and asserts non-silence and different waveforms. Detailed articulation, ornaments, expression, microtones, unpitched percussion and exceptional conventions remain approximate or unsupported.

## Executed evidence

- 34 TypeScript tests passed, including local pitch isolation, exact undo/redo across rhythm rebases, semitone/octave crossing and rapid edits on 122,250 events without rebuilding the model.
- The standalone Swift check measured 1.04 ms for a JavaScriptCore pitch edit; no-op/undo, atomic save/backup/conflict protection and native vector identity checks passed. Real piano/flute waveforms were nonzero and different. Tempo conversion is checked.
- The final packaged Swift app launched with all seven example staves and four aligned bars. Option+Right moved from page 1 to page 2 and Option+Left returned to page 1. Selecting an accessible note and pressing Up changed F-sharp5 to G5 and reported a 29 ms update; Down returned to F-sharp5 in 27 ms.
- Native Save As wrote the G5 correction to a disposable file. A raw diff showed changes only inside that note. Down followed by Cmd+S wrote F-sharp5 and created an exact backup of the pre-overwrite G5 file. Play changed to Stop; playback controls produced no error.
- Renderer measurements found identical X positions and widths for corresponding bars across all seven staves. A wider bounded page avoids the prior accidental single-bar line spanning the canvas.
- The private eight-part, 17-measure orchestral excerpt opened in the packaged Swift app with five shared pages. Corresponding barlines aligned across all eight parts; dense writing may wrap into multiple systems within a scrollable page. The excerpt omits some initial clef/staff attributes, so this check does not establish fidelity to a complete source score.

The source was pushed to the public repository at https://github.com/skylinehenrry/sourcescore. Only the synthetic study is tracked; private score fixtures and generated binaries remain excluded.

The 0.1 validation/performance files are historical. Complete real concerto visual qualification and broader native playback/lifecycle coverage remain priorities. Executed tests and local measurements are not universal losslessness or latency guarantees.
