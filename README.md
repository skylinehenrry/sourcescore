# SourceScore

A native macOS graphical MusicXML editor that keeps the original XML authoritative. Version 0.4.2 uses **SwiftUI and AppKit**, a white minimal interface and a native Core Graphics score canvas. It supports composition entry and a broader notation inspector. Launch `releases/SourceScore.app` directly; no command file, development server or account is needed.

The Swift frontend is in `native/Sources/SourceScore`; the preserving MusicXML engine is in `src/core`. The app is a build of these sources. Full MuseScore/Dorico editing parity is an ongoing target, **not a completed claim**. See [the capability matrix and remaining work](docs/FULL_EDITOR.md).

## Build

Requires macOS 14+, Apple Silicon, Swift Command Line Tools and Node 22+ for bundling the portable source and engraving components.

```sh
npm ci
npm run desktop:build
```

The result is `releases/SourceScore.app`. `npm run desktop:dev` builds and opens it. The bundle is locally ad hoc signed; public distribution notarization is not configured.

## Use

- **Cmd+N / New score** creates a composition with named instruments, bars and a meter. Piano/keyboard/organ starts with two staves.
- Native Open/Save/Save As, undo/redo and conventional Cmd+O/S/Z shortcuts.
- Click individual notes or rests, including chord pitches. Cmd-click extends selection; Shift-click selects a range within the current instrument/page.
- **Up/Down: one semitone. Shift+Up/Down: one octave.** Explicit accidental and enharmonic spelling controls remain available. Chromatic spelling respects conventional key signatures where possible.
- **Command+Left / Command+Right: previous/next page.** Each page shares the same measure range across instruments; source part-local breaks and multi-rest compression cannot independently paginate staves.
- Editing any note in a complete, unambiguous tie chain changes the connected pitches in one undoable operation, including cross-staff and cross-page ties. Ordinary tablature edits update the fret on its existing string too.
- Printed accidentals account for the key signature and earlier notes in the staff/bar. Entry, deletion, key changes and pitch edits also update affected later symbols without changing those later pitches. A key-signature sharp/flat is not automatically repeated; necessary cancellations/restorations are shown. Intentional courtesy flags are retained. Absolute pitch alteration remains in XML even when no symbol is needed.
- **N** enables note input. Select a rest, choose a value, then type **A–G**. A shorter entry splits its rest and advances the cursor. **R** enters a rest; **Shift+A–G** or Chord adds a chord pitch. Grace inserts an untimed grace note before the selected event. **Esc** exits entry. Value keys **1–9** mean 64th, 32nd, 16th, eighth, quarter, half, whole, breve, long; **.** cycles dots. Accidentals can follow the key signature or be chosen explicitly.
- **Delete / Backspace** replaces a complete sounding event with an equal-duration rest. An individually selected chord pitch or grace note is removed. Remaining chord roots and connected tie/slur markers are repaired in the same undo operation.
- **Notes** edits pitch, duration/dots, voice and staff. Shortening fills freed time with rests; lengthening consumes ordinary following rests without moving other voices. Tuplet tools turn a representable ordinary rest into exact ratio rests for subsequent note input.
- **Notation** lists musical objects in the selected bar. Add/edit/delete dynamics, text, tempo, lyrics, articulations, ornaments, techniques and fermatas. Cmd-click endpoints to add ties, slurs, hairpins, pedal/octave lines, glissandi or slides. Paired endpoints are deleted together. Existing musical scalar properties are grouped; pitch stays in the coordinated Notes editor.
- **Bar** changes clef, staff key, score meter and barline/repeat; creates voices and inserts/deletes bars across instruments. Click empty staff space to select its bar. Ordinary empty bars fit a new meter, including voice backups. Music retains its rhythm; undo a meter change that creates unresolved timing issues. Automatic rebar of existing music is outstanding.
- **Cmd+C/X/V** copies/cuts one continuous staff/voice passage and pastes into a sufficiently large ordinary rest. This currently uses written pitch and a SourceScore clipboard; multi-voice/cross-bar replacement and complete span copying are outstanding.
- Instrument isolation, source measure labels, zoom, diagnostics and optional panels keep the main score view simple. The score reflows to the available canvas width when the window, panels or zoom change. Equal gaps between instruments distribute available vertical space, while retaining the internal spacing of multi-staff instruments and the room required by dense notation. Dense pages remain scrollable.
- One app session runs at a time, including when launching another copy of the app bundle. A second launch brings the running editor forward. A kernel lock releases automatically on normal quit or a crash; it does not alter the MusicXML document.

## Responsiveness

Pitch input validates and patches affected notes, including connected ties and any later accidental restoration in the same staff/bar. Persistent source anchors and local overrides preserve other bytes. Swift receives changed note properties. The native canvas reflects the pitch immediately, followed by a debounced engraving refresh. Structural edits currently reparse the source on a background queue; full-score validation happens before saving.

The native JavaScriptCore smoke checks measured about 1–2 ms for an edit; a real native tie-chain UI operation reported 30 ms. These are individual local measurements, not guarantees for every score. A 122,250-event regression confirms rapid pitch edits do not rebuild the full model.

## Playback

Enter a bar in **From bar**, then Play or press Space; Return in the bar field starts/restarts there. Selecting a note or navigating to a bar sets this field. **Follow playback** automatically flips pages and scrolls to wrapped systems, including passages with rests. Its toolbar toggle lets you browse independently.

The **Mixer** button (or F10) opens compact instrument channels with Mute, Solo, volume, pan and sound selection. Multiple Solo buttons can isolate a combination of instruments. Controls apply live without restarting playback; mix settings do not change MusicXML. The note inspector's **Play this instrument** button solos that instrument and starts at the selected bar. These controls follow [MuseScore's mixer pattern](https://handbook.musescore.org/sound-and-playback/mixer).

Selected and edited notes can be auditioned immediately. AVAudioEngine and separate AVAudioUnitSampler/mixer nodes use the macOS General MIDI DLS sound bank for different instruments. XML MIDI programs are respected; instrument names supply fallback programs. Sound choices affect audition without altering MusicXML.

Tempo changes, transposition, voice/chord timing and basic sounding ties are interpreted. The tempo field controls speed; additional SF2/DLS banks can be selected. This is MIDI audition, not a sampled-orchestra performance or a complete articulation/ornament realization. Unpitched percussion and exceptional performance conventions need broader qualification.

## Preservation

Original UTF-8 XML stays authoritative. The engraver never supplies save output. Unknown elements, comments, attributes, whitespace, metadata and order survive unrelated local edits. No-op saves retain the original bytes, BOM and line endings. Structural identities and history snapshots keep selections attached to their actual events after insertion and undo/redo; tracking IDs are never written into MusicXML. An explicitly deleted object loses its owned contents.

The portable source engine runs in JavaScriptCore. OSMD runs in a private offscreen WebKit engraving context and returns vectors with exact source-note identities. **All visible controls and the score canvas are native Swift/AppKit; there is no HTML editing interface.** Fractional timing is adapted only in the presentation copy; saved numerical fields remain original.

Changed overwrites create recoverable backups in `.sourcescore-backups/`, flush a same-directory temporary file and rename atomically. Revision checks prevent external-file conflicts, including Save As targets. New errors are distinguished from pre-existing diagnostics. Native alerts protect unsaved edits.

## Limits

- UTF-8, uncompressed score-partwise input only. Compressed/timewise files and custom entity declarations are safely rejected.
- Missing, ambiguous or repeat-dependent tie endpoints, microtonal pitch changes, harmonic/bend frets and below-open-string fret changes are guarded. Tied-duration surgery, nested/unrepresentable tuplets, rebeaming and ripple insertion/rebar remain outstanding. Exact finite decimal ticks are supported; operations needing divisions rescaling are guarded.
- Scalar notation properties are editable in the inspector; universal direct glyph selection/dragging, complete symbol palettes, instrument/part management, linked parts and professional engraving controls are incomplete. See [FULL_EDITOR.md](docs/FULL_EDITOR.md) for the specific boundary.
- Clipboard paste strips external ties/slurs, tuplet brackets, beams, unique note IDs and source instrument references; copied tuplets retain their duration ratio. Namespace incompatibilities are rejected. It does not implement arbitrary multi-voice or multi-measure replacement.
- Meter fitting covers ordinary empty bars with coherent voices. Music, pickups, complex tuplets and marked rests that would be removed remain preserved; resulting timing problems block saving until repaired or undone.
- Complete concerto qualification and full runtime schema validation remain outstanding. Development XSD checks cover generated editing workflows, not every imported extension or notation convention.
- Shared pages contain four measures. Engraving is not pixel-identical to MuseScore; source breaks/spacing are adapted for the editing view.
- Native replacement preserves POSIX mode bits, not ACLs/xattrs/resource forks. A narrow race remains between the final revision check and rename; directory-entry power-loss durability depends on the filesystem.

## Verify

```sh
npm test
npm run desktop:test
npm run desktop:render:test
npm run test:editing-schema -- /path/to/musicxml-4.0/musicxml.xsd
npm run test:ui
npm run compare -- original.musicxml edited.musicxml expected-note-id
```

`desktop:test` bundles the current core and runs a standalone Swift check executable, without full Xcode/XCTest. It checks pitch/tie edits, new composition/chord entry, deletion, notation responses, exact structural undo and saves, meter fitting, file backups/conflicts, vector identity, playback routing and actual audio. `desktop:render:test` requires Google Chrome and checks note/bar mapping, aligned bars, uniform spacing and newly entered notation. `test:editing-schema` uses a local official MusicXML 4.0 XSD plus its imports; it skips explicitly when absent. Browser UI tests cover the retained older interface, so they do not establish native feature parity. Install WebKit into the project cache if needed:

```sh
PLAYWRIGHT_BROWSERS_PATH="$PWD/.cache/playwright" npx playwright install webkit
PLAYWRIGHT_BROWSERS_PATH="$PWD/.cache/playwright" npm run test:ui
```

Private orchestral fixtures are ignored by Git and skipped when absent. Only a synthetic study is included. The prior Tauri implementation remains available for comparison through `legacy:desktop:build` / `legacy:desktop:test`. See `docs/SWIFT_NATIVE.md` for the migration and validation; other development documents record historical checkpoints.
