# Current development checkpoint — 0.5.1

SourceScore's native Swift frontend now supports new compositions, note/rest input and deletion, chords and grace notes, ordinary rhythm resizing, representable tuplets, source clipboard, musical notation properties and synchronized bar/signature tools. The source remains in the same project folder; the `.app` is its compiled result.

The 0.5.1 update fixes octave-shift lines crossing page boundaries. Page views receive temporary continuation and endpoint directions, allowing playback to turn pages without the renderer losing an 8va endpoint. The original MusicXML and sounding pitches remain unchanged. Outdated or cancelled renders no longer raise alerts, and JavaScript rendering failures retain their specific error message. All 130 page views of a 14-part, 520-measure concerto passed the native WebKit check; the private score is not included in the repository. Berlin instrument playback introduced in 0.5.0 is retained.

The preservation engine retains lexical source anchors, stable structural identities and exact mixed edit history. Semitone editing keeps its fast path. Structural changes validate candidates before committing; saving distinguishes new timing errors from pre-existing source diagnostics and keeps native backups/conflict protection.

Executed checks include 83 passing source tests with one optional fixture check skipped, TypeScript compilation and the native Swift release build. Earlier checks covered 29 generated MusicXML 4.0 XSD scenarios. Completed GUI checks include text commands, new-score save protection, readable labels, entry, clipboard, deletion/history, semitone/page shortcuts, notation and save/reopen. See SWIFT_NATIVE.md for the executed evidence and the isolated test-copy boundary.

## Remaining scope

Comprehensive MuseScore/Dorico editing parity is not complete. [FULL_EDITOR.md](FULL_EDITOR.md) provides the implemented/partial/outstanding matrix and concrete next priorities. The largest remaining foundation is a temporal edit transaction for ripple insertion/removal and synchronized multi-voice rebar. Universal glyph selection/manipulation, complete palettes, coordinated exotic rhythms, part/instrument management and full real-score qualification also remain.

## Build and verify

`npm run desktop:dev` builds and opens the native app. `npm run desktop:build` refreshes `SourceScore.app`. `npm test`, `npm run desktop:test` and `npm run desktop:render:test` cover source semantics, native integration/persistence/audio and engraving. `npm run test:editing-schema -- /path/to/musicxml.xsd` checks generated workflow output against a local official MusicXML 4.0 schema.

The retained React/Tauri implementations and their browser/Rust results are historical; they do not substitute for native Swift feature testing. See [SWIFT_NATIVE.md](SWIFT_NATIVE.md) for current and historical validation, and [VALIDATION.md](VALIDATION.md) for the initial 0.1 evidence.
