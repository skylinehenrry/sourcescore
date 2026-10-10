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
- The standalone Swift check measured about 1.3 ms for a JavaScriptCore pitch edit; no-op/undo, atomic save/backup/conflict protection and native vector identity checks passed. Real piano/flute waveforms were nonzero and different. Tempo conversion is checked.
- The actual Swift app launched with all seven example staves and four aligned bars. Option+Right moved from page 1 to page 2. A selected F-sharp followed by Up became G5 and reported a 29 ms update.
- Renderer measurements found identical X positions and widths for corresponding bars across all seven staves. A wider bounded page avoids the prior accidental single-bar line spanning the canvas.

The 0.1 validation/performance files are historical. Complete real concerto visual qualification and broader native playback/lifecycle coverage remain priorities. Executed tests and local measurements are not universal losslessness or latency guarantees.
