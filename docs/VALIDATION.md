# Executed validation — 10 October 2026

This document distinguishes executed checks from outstanding qualification. The application is an initial release, with conservative safe operations; all five requested development phases are not complete.

## Automated results

| Check | Executed result |
| --- | --- |
| `npm test` | 27 core tests passed, including the private Rachmaninoff regression |
| `npm run desktop:test` | 8 Rust file-safety tests passed |
| `PLAYWRIGHT_BROWSERS_PATH="$PWD/.cache/playwright" npm run test:ui` | 18 UI tests passed: nine workflows in Chrome and nine in WebKit |
| `npm run build` | TypeScript check and Vite production build passed |
| `npm run desktop:build` | Apple Silicon native release and `.app` packaging passed |
| MusicXML 4.0 XSD via `xmllint` | Orchestral fixture and saved F-natural correction validated |
| `npm audit` | Zero reported vulnerabilities in the installed dependency tree |
| `npm run bench` | Preservation assertions passed on a 20-part/1,000-measure synthetic score and the private excerpt |

Core tests cover byte-identical no-op output, BOM/Unicode/CRLF, scalar pitch changes and field insertion, unrelated voice/chord isolation, explicit balanced duration/rest/chord edits, safe rejection of unsupported rhythms, exact tuplets/decimal timing, spelling/transposition distinction, unsupported content, undo/redo branching, invalid XML and ambiguous duplicate fields, cursor/voice/chord/budget diagnostics, pickups and partial/cross-staff voices, and normalized event comparisons.

Native file tests cover exact no-op bytes with no backup, precise changed-save backups, revision refresh, external modifications, malformed save payloads, Save As conflict detection, new/existing targets, backup failure and rejection of Save As over a conflicted original path.

UI tests operate actual engraved SVG note targets. They verify selection, pitch rerendering, persistent source identity, undo/redo, exact downloaded MusicXML, independent chord pitches, multiple selection and keyboard octave changes, explicit duration confirmation, vertical dragging, diagnostic navigation/highlighting, measure/instrument isolation/zoom, invalid-input recovery and navigation through the private Rachmaninoff excerpt. A separate 20-part/1,000-measure UI test opens 122,250 events, navigates to measure 1,000, asserts the selected note is actually in the viewport and corrects that note. The complete large-score workflow passed in 6.7 seconds in Chrome and 8.5 seconds in WebKit in the recorded run.

## Native application smoke evidence

The packaged application was launched on macOS 27.0.1 arm64. The native Open dialog loaded a disposable copy of the orchestra fixture. The app displayed 298 selectable events in its initial eight-measure view. The first flute F-sharp was selected, Natural was clicked, and Cmd+S was invoked.

The saved file was compared against the original: only normalized event `0:0:0` changed, with no added/removed events or new diagnostics. Exact comparison established the intended pitch/accidental patches, and the on-disk backup matched the original byte for byte. The edited result passed the MusicXML 4.0 XSD check.

An initial post-rename parent-directory open blocked the native UI while completing that save. A process sample identified the exact blocking call. The directory enumeration was removed, and disk commands were moved off the UI thread. After the user unlocked the Mac, the final native application was tested again successfully:

- Cmd+O and the native file picker opened a clean fixture.
- Cmd+S without changes completed; the file remained byte-identical and no backup was created.
- F-sharp to F-natural followed by Cmd+S completed with a visible saved state and a recoverable backup. Exact event comparison found only `0:0:0` changed; the backup matched the original bytes.
- Cmd+Shift+S opened the native Save As dialog, saved another `.musicxml` file and updated the current filename. That copy matched the edited source exactly.
- Native undo, attempted quit, cancellation of the unsaved-close warning and redo all behaved correctly.
- Reopening the Save As result displayed the corrected F5 note.
- An external comment was appended to the disposable test file. Cmd+S showed a conflict warning and refused the overwrite. The external revision's SHA-256 stayed unchanged.
- Quitting a clean session exited the test application.

These native smoke checks are executed manual automation through the real macOS app, in addition to the repeatable browser and Rust test suites. Finder open-event and native drag/drop activation have not received separate manual coverage.

## Interoperability

The installed MuseScore 4 reader imported the saved MusicXML successfully and exported a scratch `.mscx` file. The first imported note had MIDI pitch 77, confirming the intended written F5 in the non-transposing flute part. This scratch export was used only to verify reader interpretation; it never supplied the editor's save output. The initial attempt to use Qt's offscreen platform failed because this installation only includes the Cocoa platform; the ordinary converter invocation subsequently succeeded.

## Real-world coverage and isolation

The accessible Rachmaninoff Rhapsody variation 18 file is an excerpt: 8 parts, 17 measures and 853 events. Core no-op/pitch/undo tests and Chrome/WebKit rendering/navigation tests passed. A final checksum comparison confirmed that the private fixture copy and the original file in Automatic Accompaniment still match. The original was never used as a save target.

The synthetic benchmark has 20 parts, 1,000 measures and 122,250 events. It exercises orchestral size, simultaneous chords, inherited/transposing attributes, separate piano staves/voices and tuplets. It is not a substitute for a complete published concerto with dense nested tuplets, cross-staff beams, ties, ottava changes and layout exceptions. Those complete real-world regressions remain outstanding.

## Performance limits

See `benchmark-results.json` for the most recent single local run. Those measurements cover the core engine, not total UI opening time or memory bounds. Expensive parsing/validation runs in a worker; current source edits still perform a full semantic reparse. Only the selected 4/8/16-measure passage is engraved. Future work should reduce full-score reparse/snapshot cost before claiming production responsiveness for complete concertos.

## Recoverable checkpoints and continuation

The source, lockfiles, brief, regression fixture and architecture were saved in Git. The packaged app is kept in `releases/SourceScore.app`. Private fixtures, scratch reader exports, screenshots, toolchains and compiled build directories are ignored by Git. No separate accompaniment files were edited.

Prioritize complete real concerto regression fixtures, coordinated rest/tie/beam/tuplet operations, incremental semantic updates and page/system caching. Add repeatable native lifecycle coverage for Finder events, drag/drop and persistence interactions across OS versions. Follow the preservation and normalized-event assertions whenever adding an editing capability.
