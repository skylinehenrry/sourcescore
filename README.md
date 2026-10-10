# SourceScore

A native macOS graphical MusicXML editor that keeps the original XML authoritative. Version 0.3 uses **SwiftUI and AppKit**, a white minimal interface and a native Core Graphics score canvas. Launch `releases/SourceScore.app` directly; no command file, development server or account is needed.

## Build

Requires macOS 14+, Apple Silicon, Swift Command Line Tools and Node 22+ for bundling the portable source and engraving components.

```sh
npm ci
npm run desktop:build
```

The result is `releases/SourceScore.app`. `npm run desktop:dev` builds and opens it. The bundle is locally ad hoc signed; public distribution notarization is not configured.

## Use

- Native Open/Save/Save As, undo/redo and conventional Cmd+O/S/Z shortcuts.
- Click individual notes or rests, including chord pitches. Cmd-click extends selection; Shift-click selects a range within the current instrument/page.
- **Up/Down: one semitone. Shift+Up/Down: one octave.** Explicit accidental and enharmonic spelling controls remain available. Chromatic spelling respects conventional key signatures where possible.
- **Command+Left / Command+Right: previous/next page.** Each page shares the same measure range across instruments; source part-local breaks and multi-rest compression cannot independently paginate staves.
- Editing any note in a complete, unambiguous tie chain changes the connected pitches in one undoable operation, including cross-staff and cross-page ties. Ordinary tablature edits update the fret on its existing string too.
- Printed accidentals account for the key signature and earlier notes in the staff/bar. A key-signature sharp/flat is not automatically repeated; a necessary cancellation or restoration is shown. Existing intentional courtesy flags are retained. The absolute pitch alteration remains in XML even when no symbol is needed.
- Duration/dots and safe voice changes use a compact inspector. Duration changes preview the compensating following rest before applying.
- Instrument isolation, source measure labels, zoom, diagnostics and optional panels keep the main score view simple. Equal gaps between instruments distribute available vertical space, while retaining the internal spacing of multi-staff instruments and the room required by dense notation. Dense pages remain scrollable.

## Responsiveness

Pitch input validates and patches only the affected notes, including a connected tie chain. Persistent source anchors and local overrides preserve other bytes. Swift receives only changed note properties. The native canvas reflects the pitch immediately, followed by a debounced engraving refresh. Full-score validation happens before saving on a background queue.

The native JavaScriptCore smoke checks measured about 1–2 ms for an edit; a real native tie-chain UI operation reported 30 ms. These are individual local measurements, not guarantees for every score. A 122,250-event regression confirms rapid pitch edits do not rebuild the full model.

## Playback

Enter a bar in **From bar**, then Play or press Space; Return in the bar field starts/restarts there. Selecting a note or navigating to a bar sets this field. **Follow playback** automatically flips pages and scrolls to wrapped systems, including passages with rests. Its toolbar toggle lets you browse independently.

The **Mixer** button (or F10) opens compact instrument channels with Mute, Solo, volume, pan and sound selection. Multiple Solo buttons can isolate a combination of instruments. Controls apply live without restarting playback; mix settings do not change MusicXML. The note inspector's **Play this instrument** button solos that instrument and starts at the selected bar. These controls follow [MuseScore's mixer pattern](https://handbook.musescore.org/sound-and-playback/mixer).

Selected and edited notes can be auditioned immediately. AVAudioEngine and separate AVAudioUnitSampler/mixer nodes use the macOS General MIDI DLS sound bank for different instruments. XML MIDI programs are respected; instrument names supply fallback programs. Sound choices affect audition without altering MusicXML.

Tempo changes, transposition, voice/chord timing and basic sounding ties are interpreted. The tempo field controls speed; additional SF2/DLS banks can be selected. This is MIDI audition, not a sampled-orchestra performance or a complete articulation/ornament realization. Unpitched percussion and exceptional performance conventions need broader qualification.

## Preservation

Original UTF-8 XML stays authoritative. The engraver never supplies save output. Unknown elements, comments, attributes, whitespace, metadata and order survive unrelated local edits. No-op saves retain the original bytes, BOM and line endings.

The portable source engine runs in JavaScriptCore. OSMD runs in a private offscreen WebKit engraving context and returns vectors with exact source-note identities. **All visible controls and the score canvas are native Swift/AppKit; there is no HTML editing interface.** Fractional timing is adapted only in the presentation copy; saved numerical fields remain original.

Changed overwrites create recoverable backups in `.sourcescore-backups/`, flush a same-directory temporary file and rename atomically. Revision checks prevent external-file conflicts, including Save As targets. New errors are distinguished from pre-existing diagnostics. Native alerts protect unsaved edits.

## Limits

- UTF-8, uncompressed score-partwise input only. Compressed/timewise files and custom entity declarations are safely rejected.
- Missing, ambiguous or repeat-dependent tie endpoints, microtonal pitch changes, harmonic/bend frets and below-open-string fret changes are guarded. Advanced coordinated tuplet/tie/beam/grace rhythm operations remain guarded. Duration editing writes integer ticks and requires a representable, positive following rest.
- No insertion/deletion, rest splitting or independent slur/dynamics/clef/key/time editor. Complete concerto qualification and full schema validation remain outstanding.
- Shared pages contain four measures. Engraving is not pixel-identical to MuseScore; source breaks/spacing are adapted for the editing view.
- Native replacement preserves POSIX mode bits, not ACLs/xattrs/resource forks. A narrow race remains between the final revision check and rename; directory-entry power-loss durability depends on the filesystem.

## Verify

```sh
npm test
npm run desktop:test
npm run desktop:render:test
npm run test:ui
npm run compare -- original.musicxml edited.musicxml expected-note-id
```

`desktop:test` bundles the current core and runs a standalone Swift check executable, without requiring full Xcode/XCTest. It tests JavaScriptCore/tie-chain edits, exact native saves/backups/conflicts, native vectors, bar seeking/page boundaries, mix routing, tempo conversion and actual offline piano/flute and muted-channel audio. `desktop:render:test` requires installed Google Chrome and checks the native engraving adapter's note mapping, aligned bars, uniform instrument gaps, viewport height and unchanged source. Other UI tests use Chrome and WebKit; install WebKit into the project cache if needed:

```sh
PLAYWRIGHT_BROWSERS_PATH="$PWD/.cache/playwright" npx playwright install webkit
PLAYWRIGHT_BROWSERS_PATH="$PWD/.cache/playwright" npm run test:ui
```

Private orchestral fixtures are ignored by Git and skipped when absent. Only a synthetic study is included. The prior Tauri implementation remains available for comparison through `legacy:desktop:build` / `legacy:desktop:test`. See `docs/SWIFT_NATIVE.md` for the migration and validation; other development documents record historical checkpoints.
