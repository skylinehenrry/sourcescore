# Architecture and renderer decision

## Source and semantic authority

`src/core/xml.ts` validates well-formedness using Saxes, then indexes lexical element ranges with a quote-aware scanner. No XML tree serializer exists on the save path. Patch application rejects overlapping ranges. Scalar edits retain surrounding whitespace; insertions use schema order and local namespace prefixes. Comments/CDATA inside an edited scalar cause a safe rejection rather than deletion.

`src/core/model.ts` interprets parts, measures, inherited attributes and MusicXML's temporal cursor. Backup/forward change that cursor; chord members inherit their root's onset and do not advance it; grace notes consume no measured time. Quarter-note time and decimal divisions/durations are exact rational numbers. Staff extent is computed from event endpoints and explicit forwards. Partial secondary voices and cross-staff completion do not require artificial rests.

`src/core/editor.ts` plans supported operations independently of rendering. Each transaction has a precise set of intended event IDs and forward/inverse patches. It reparses the candidate, compares diagnostics and normalized events, and commits only after those checks succeed. Undo stores inverse patches rather than complete per-edit source snapshots. The saved source remains available for dirty detection. Stable IDs use part/measure/note ordinals; this is safe because supported operations do not insert/delete/reorder note elements. Structural editing will need a stronger identity scheme.

`src/core/worker.ts` owns the document and performs parsing, mutation, validation and render-slice preparation outside the UI thread. The UI receives display projections and history summaries. Saving requests the authoritative source directly from the worker. The UI projection cannot regenerate the file.

## Engraving selection

OpenSheetMusicDisplay 1.9.9 was selected for this first implementation. Its native MusicXML reader, typed note objects and graphical note/SVG access reduce the adaptation needed for a MusicXML-first editor. OSMD is BSD-3-Clause; VexFlow is MIT. It does not provide an editor or a complete incremental engraving API, so SourceScore supplies interactions and windowed rendering.

Verovio was evaluated through its official input, toolkit and SVG documentation. It offers strong SVG identity, page-based output and a mature engraving toolkit, but MusicXML is converted internally to MEI. That introduces an additional identity/interpretation bridge for this particular source-first editor. Its LGPL licensing would also require separate distribution compliance review. It remains a viable renderer replacement, not a rejected technology. A quantitative head-to-head concerto engraving comparison has not been completed; the choice is based on documented APIs plus the working OSMD regression tests.

Sources checked during development:

- [OSMD capabilities and declared limitations](https://github.com/opensheetmusicdisplay/opensheetmusicdisplay)
- [GraphicalNote sourceNote relationship](https://opensheetmusicdisplay.github.io/classdoc/classes/GraphicalNote.html)
- [OSMD SVG interaction examples](https://github.com/opensheetmusicdisplay/opensheetmusicdisplay/wiki/Exploring-the-Demo)
- [Verovio supported inputs](https://book.verovio.org/toolkit-reference/input-formats.html)
- [Verovio toolkit methods](https://book.verovio.org/toolkit-reference/toolkit-methods.html)
- [Verovio license](https://github.com/rism-digital/verovio/blob/develop/COPYING)
- [MusicXML note order](https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/note/)
- [MusicXML temporal cursor](https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/backup/)
- [MusicXML positive division values](https://www.w3.org/2021/06/musicxml40/musicxml-reference/data-types/positive-divisions/)

## Graphical identity bridge

`src/renderer/ScoreRenderer.ts` builds an isolated **presentation** document for the requested measure window. Inherited attributes are injected into that copy. Each note gets a unique temporary renderer color that OSMD's reader retains in its note object. The marker resolves to an exact source ID; the original head/stem colors are restored before engraving. The marker never enters the authoritative source or save payload.

Each graphical note's chord index identifies its individual SVG notehead. Overlay hit targets use that notehead's actual bounds, including after zoom or rerender. Selection colors only the intended head. Unmapped events are reported and have no edit target; there is no positional or nearest-pitch guess. Engraving SVG paths are hidden from the accessibility tree because overlay buttons provide descriptive musical labels. This also avoids costly native AX traversal of thousands of decorative paths.

The current renderer supports full-score and instrument-isolated windows. Source layout metadata stays on disk even when a desktop presentation overrides page breaks or multi-measure rest compression for navigation. No OSMD MusicXML export or proprietary intermediate score format is used.

OSMD reads divisions/duration values as integers. The separate presentation copy therefore scales division-based timing quantities (including offsets and note attack/release) by an exact common rational factor to fit safe integers. Musical time stays unchanged because duration and divisions share the same factor. The saved source retains its original decimal values. A renderer-range overflow is rejected explicitly. Fractional-tick rendering, no-op bytes and independent pitch saving are exercised in Chrome and WebKit.

## Native file boundary

`src-tauri/src/files.rs` canonicalizes paths and binds them to revision-checked sessions. Save verifies XML, detects changed disk bytes, writes a same-directory temporary file, flushes it, creates and flushes a unique backup, checks the target revision again and renames atomically. New Save As destinations use a no-clobber persist operation. Existing targets require a captured revision grant and a backup.

Disk commands execute outside the macOS UI thread. An initial native smoke run exposed blocking directory enumeration after a committed rename; that unnecessary parent-directory read was removed. The implementation flushes file contents and backups and explicitly documents filesystem-dependent directory-entry durability. It does not promise atomic compare-and-swap against arbitrary non-cooperating external writers, or preservation of ACLs/xattrs/resource forks.

`src/io/files.ts` uses native dialogs and typed commands. Browser preview downloads are visibly labeled. Window closing and opening another score protect unsaved edits. Native startup file arguments, Finder open events and drag/drop are routed through the same open path.

## Module replacement boundaries

The XML manager and editing engine have no OSMD or Tauri dependency. The renderer consumes presentation slices and source IDs. The Rust file layer consumes source text and file-session/grant identifiers. This separation allows renderer replacement and stronger native persistence without changing edit semantics.
