# Current development checkpoint — 0.4.1

SourceScore's native Swift frontend now supports new compositions, note/rest input and deletion, chords and grace notes, ordinary rhythm resizing, representable tuplets, source clipboard, musical notation properties and synchronized bar/signature tools. The source remains in the same project folder; the `.app` is its compiled result.

The preservation engine retains lexical source anchors, stable structural identities and exact mixed edit history. Semitone editing keeps its fast path. Structural changes validate candidates before committing; saving distinguishes new timing errors from pre-existing source diagnostics and keeps native backups/conflict protection.

Executed checks include 82 source tests, TypeScript compilation and 29 generated MusicXML 4.0 XSD scenarios. Standalone Swift and engraving checks cover the native release. Completed GUI checks now include text commands, new-score save protection, readable labels, entry, clipboard, deletion/history, semitone/page shortcuts, notation and save/reopen. See SWIFT_NATIVE.md for the executed evidence and the isolated test-copy boundary.

## Remaining scope

Comprehensive MuseScore/Dorico editing parity is not complete. [FULL_EDITOR.md](FULL_EDITOR.md) provides the implemented/partial/outstanding matrix and concrete next priorities. The largest remaining foundation is a temporal edit transaction for ripple insertion/removal and synchronized multi-voice rebar. Universal glyph selection/manipulation, complete palettes, coordinated exotic rhythms, part/instrument management and full real-score qualification also remain.

## Build and verify

`npm run desktop:dev` builds and opens the native app. `npm run desktop:build` refreshes `releases/SourceScore.app`. `npm test`, `npm run desktop:test` and `npm run desktop:render:test` cover source semantics, native integration/persistence/audio and engraving. `npm run test:editing-schema -- /path/to/musicxml.xsd` checks generated workflow output against a local official MusicXML 4.0 schema.

The retained React/Tauri implementations and their browser/Rust results are historical; they do not substitute for native Swift feature testing. See [SWIFT_NATIVE.md](SWIFT_NATIVE.md) for current and historical validation, and [VALIDATION.md](VALIDATION.md) for the initial 0.1 evidence.
