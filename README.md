# SourceScore — graphical MusicXML editor

SourceScore is a standalone Tauri 2 application for macOS Apple Silicon. It edits the original UTF-8 MusicXML source with local range patches and uses OpenSheetMusicDisplay for engraving. The engraving library never supplies the saved document.

This is an initial usable implementation of the foundation and conservative core editing workflows. Advanced notation editing and production qualification for complete concertos remain unfinished.

## Launch

Open `releases/SourceScore.app` or double-click `Launch SourceScore.command`. No development server, account or internet connection is needed by the packaged application. The build is local and ad hoc signed; it has not been notarized for public distribution.

Project location: `/Users/henry/Documents/Projects/Lossless MusicXML Editor`.

## Build and develop

Requires Node 22.18+ and the Apple Command Line Tools. A project-local Rust toolchain is installed in `.toolchain/`; `scripts/desktop.mjs` selects it automatically. On another machine, install a normal Rust toolchain and run:

```sh
npm ci
npm run desktop:dev
```

Package the native application with `npm run desktop:build`. Tauri writes `src-tauri/target/release/bundle/macos/SourceScore.app`; the desktop script also refreshes the convenient `releases/SourceScore.app` copy. `npm run dev` starts a browser preview whose Save operation downloads a copy instead of overwriting disk files.

## Working features

- Native opening of `.musicxml` and `.xml`, Save, Save As, macOS menus and conventional shortcuts.
- Actual engraved notation with individually selectable notes and rests, including independent chord pitches. Selection persists after supported edits and rerendering.
- Written-pitch step, octave, natural, sharp, flat, double accidentals and enharmonic spelling. Arrow keys, octave shortcuts, vertical dragging, multiple selection and selection across measures are supported.
- Whole through 64th durations, up to two dots, and rest/chord duration editing **when an adjacent ordinary rest can explicitly compensate for the change**. A preview names all coordinated events before applying them.
- Conservative voice reassignment when the target voice has no overlap and the event has no linked notation requiring coordinated updates.
- Instrument search, full-score/isolated-instrument views, zoom, scrolling, source measure labels and measure-position navigation.
- Background parsing/validation, engraving of 4/8/16-measure windows, diagnostics with navigation and staff highlighting, session edit history, undo and redo.
- Byte-identical no-op saves in the supported input domain, backups before changed overwrites, temporary-file writes, atomic rename, revision checks and external-change detection.

## Preservation and safety

Supported edits update scalar ranges or insert/remove necessary local child elements. Untouched whitespace, comments, attributes, metadata, element order and unsupported notation stay in the original source. UTF-8 BOM and CRLF are retained. Existing courtesy-accidental attributes are preserved when an accidental changes.

Backups are stored beside the score in `.sourcescore-backups/`, with the original filename and a unique suffix. To recover, copy a backup to a new `.musicxml` filename and open it. SourceScore never silently repairs unrelated notation. Pre-existing diagnostics are separated from new errors; edits introducing new blocking errors or changing unintended normalized note events are rejected before commitment.

The source engine uses UTF-16 string offsets and exact UTF-8 decoding/re-encoding; offsets are never confused with disk byte positions. This yields unchanged bytes outside the intended patches for accepted UTF-8 inputs. It does not claim universal losslessness for every MusicXML dialect or file encoding.

Original-file hashes are checked before and immediately before replacement; Save As also guards its target revision. There remains a narrow race with a non-cooperating external writer between the final check and rename. Files and backups are flushed before rename. Power-loss durability of the directory entry depends on the filesystem. POSIX mode bits are copied; extended attributes, ACLs and resource forks are not copied to the replacement. Network filesystems have not been qualified.

## Current limits

- UTF-8, uncompressed, score-partwise documents only. `.mxl`, score-timewise, non-UTF-8 encodings and custom XML entity declarations are rejected without modifying the input.
- Pitch changes of tied notes and microtones are blocked. Courtesy-accidental creation/removal is not exposed as a separate operation.
- Duration changes of tuplets, grace notes, ties, beamed groups, unequal-duration chords and whole-measure rests are blocked. Fractional numeric fields can be read exactly; the duration editor currently writes integer ticks only.
- No insertion/deletion, rest splitting, tie-chain editing, independent slur/articulation/dynamics/clef/key/time editing or coordinated divisions/backup/forward changes. These elements remain preserved through unrelated supported edits.
- Cross-staff source is interpreted and preserved; dense cross-staff engraving still depends on OSMD and needs broader visual regression testing. Its display is not identical to MuseScore/Dorico engraving, and renderer-unsupported symbols can be absent from the view while remaining in the source.
- Validation covers supported note structure and temporal rules, not the complete MusicXML XSD or every legal irregular measure. Written/sounding duration differences are advisory outside tuplets; cross-staff/partial-voice/implicit/non-controlling/free-time completeness checks are conservative. Tie checks detect some unmatched stops, not all invalid chains. Instrument transposition is shown in semitones; exotic per-staff/nontraditional key signatures need further work.
- An edit currently reparses the complete source in the worker. On the recorded 122,250-event synthetic score a pitch edit took about 1.8 seconds. Rendering is bounded to the current passage, but fully incremental semantic parsing, layout caching and continuous page virtualization are still needed.

## Verification

```sh
npm test
npm run desktop:test
npm run test:ui
npm run bench
npm run compare -- original.musicxml edited.musicxml expected-note-id
```

UI tests use installed Chrome and a Playwright WebKit runtime. To install WebKit into the project cache:

```sh
PLAYWRIGHT_BROWSERS_PATH="$PWD/.cache/playwright" npx playwright install webkit
PLAYWRIGHT_BROWSERS_PATH="$PWD/.cache/playwright" npm run test:ui
```

The tests compare both exact source output and normalized events, including written pitch, transposition, accidentals, duration, onset, staff, voice, chord/grace state and tuplets. Private real-world fixtures in `fixtures/local/` are intentionally ignored by Git and skipped when absent. The accessible Rachmaninoff variation 18 excerpt has 8 parts, 17 measures and 853 events; it is not a complete concerto. No files in Automatic Accompaniment were edited.

See `docs/VALIDATION.md` for executed results, `docs/ARCHITECTURE.md` for implementation choices and `docs/benchmark-results.json` for measurements.

## Next development priorities

1. Qualify complete real concerto fixtures and visually inspect dense piano/cross-staff/tied/tuplet passages against a reference reader.
2. Add explicit rest insertion/splitting and coordinated beaming/tuplet/tie operations with source-byte and event-isolation regression tests.
3. Implement incremental measure parsing, smaller worker snapshots and cached page/system layout to reduce large-score edit latency.
4. Strengthen staff-specific transposition, nontraditional keys, irregular-measure/tie validation and optional schema diagnostics.
5. Finish packaged-app lifecycle/conflict/save/reopen regression coverage, crash recovery, accessibility keyboard focus and distribution signing/notarization.
