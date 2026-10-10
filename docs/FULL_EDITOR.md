# Full notation editing target — 0.4 checkpoint

The target is comprehensive notation editing in the existing native, MusicXML-preserving app. Version 0.4 is a broad composition/editing milestone. It is not equivalent to all editing functionality in MuseScore or Dorico. Preserving imported material is distinct from being able to create or transform every supported notation type.

## Current capability boundary

| Area | Available in 0.4 | Remaining work |
| --- | --- | --- |
| Note/rest input | A–G/R entry, chosen values/dots, rest splitting, automatic next-event cursor and page changes | Mouse pitch entry on any staff location; caret insertion where no existing event/voice is present; MIDI entry |
| Deletion | Equal-time rest replacement; individual chord/grace removal; chord root promotion | General time removal/ripple mode; delete time across ranges |
| Pitch | Semitone/octave/diatonic edits, spelling and contextual accidentals | Microtones, unusual accidentals and complete concert/written pitch modes |
| Chords/grace | Chord additions, individual pitch selection/deletion, grace creation/removal | Grace groups with coordinated performance timing; arbitrary cross-staff chord transformations |
| Durations | Resize ordinary notes/chords by compensating or consuming following rests; exact finite ticks | Rebar across music, changing tied durations, divisions rescaling, unrestricted rhythm transforms |
| Ties | Complete unambiguous chain pitch edits; create consecutive ties; delete chain or incident connections | Conditional/repeat-dependent ties, arbitrary tied-note resegmentation, ambiguous import repair UI |
| Tuplets | Exact representable ratio creation in an ordinary rest; pitched entry retaining ratio/brackets | Nested tuplets, changing whole tuplet groups, arbitrary irrational/divisions transforms |
| Voices/staves | Create rest-filled voices, safe voice reassignment, move a note to an existing staff | Instrument/staff/part creation/deletion/reordering in an existing score; advanced cross-staff voice restructuring |
| Clipboard | Continuous single-staff/voice written-pitch copy/cut into one sufficiently large rest | Multi-staff/voice and cross-bar replacement; concert-pitch conversion; full span/reference remapping; different musical namespace conversion |
| Articulations/ornaments/techniques | Add common palette symbols; inspect/edit/delete existing musical fields | Complete palettes, alternate noteheads/cues/arpeggios, semantic coordination of exotic notation groups |
| Text/lyrics/tempo/dynamics | Add/edit/delete; coordinate ordinary tempo/dynamic playback fields | Lyric verse/extension entry navigation, rich text/fonts, arbitrary rehearsal/chord-symbol creation palettes |
| Slurs/hairpins/lines | Endpoint selection for ties/slurs/hairpins, pedal, octave lines, slides/glissandi; paired deletion | Universal direct curve/handle editing, complicated continuation/overlap/import repair and every line type |
| Clefs/keys/meters | Staff clef/key edits retaining surrounding attributes; score meter edits; ordinary empty-bar fitting | Fully coordinated rebar of music; nontraditional key creation and unmeasured/composite meter transformation UI |
| Bars/repeats | Insert/delete across parts; preserve inherited attributes and original bar labels; edit barline/repeat fields | Range operations, renumbering workflows, all ending/jump/navigation palettes and repeat-aware playback |
| Selection/properties | Native note/rest/bar hit targets; multi/range selection; grouped notation property list | Direct hit targets for every glyph; lasso, semantic filters, range selection across pages/voices |
| Beams/stems/noteheads | Existing scalar fields exposed; ordinary duration edits remove impossible beams on the resized event | Coordinated automatic/manual rebeaming, cross-staff beams, complete creation palettes |
| Layout | Shared pages/bar ranges, equal inter-instrument gaps, native zoom and scrolling | Professional spacing/layout modes, source-layout faithful view, pagination controls and print/export workflows |
| Instruments/playback | Native sampler audition, sound choice, per-part mute/solo/volume/pan; bar seek and page following | Unpitched percussion editor/playback, full tablature fingering tools, detailed articulations/ornaments, repeat navigation |
| Documents | New compositions; UTF-8 uncompressed partwise XML; native safe Save/Save As and exact history | Compressed/timewise input, autosave/crash recovery, multiple independent documents, linked part extraction, MusicXML version/namespace compatibility breadth |

## How the new workflows behave

Select an existing rest, enable **N**, select a value and type a pitch. The rest is replaced or split, while the other voices retain their timing. Entry advances to the next event in that staff and voice. **R** replaces a sounding chord with rests at the chosen value; Delete removes an individual selected chord pitch or replaces a complete event with an equal-time rest. This follows the replacement/rest workflow documented in [MuseScore's note-editing handbook](https://handbook.musescore.org/fr/basics/editing-notes-and-rests) and [Dorico's item deletion guidance](https://www.steinberg.help/r/dorico-pro/6.2/en/dorico/topics/write_mode/write_mode_arranging_tools/write_mode_deleting_items_t.html).

Time-shifting insertion is a separate feature. [Dorico's insert-mode workflow](https://www.steinberg.help/r/dorico-pro/6.2/en/dorico/topics/write_mode/write_mode_insert_mode/write_mode_insert_mode_c.html) is a useful reference for the next timing milestone; SourceScore does not currently implement equivalent ripple behavior.

Use **Notation** to select non-note objects in the current bar and edit their musical properties. Pitch fields are deliberately routed through **Notes**, where ties, frets and accidental context stay coordinated. Paired marker type/number fields are displayed together with span operations; changing endpoints uses delete/recreate rather than independent marker edits. This does not establish universal direct glyph editing.

A time signature edit fits conventional empty bars whose meter changed. Existing music and unsafe empty-bar structures remain intact; newly introduced timing errors block saving. Undo restores all original bytes. This keeps meter editing usable for a new composition without silently reordering an imported passage.

## Preservation and validation

Structural operations build source patches against lexical anchors, parse the candidate, retain identities of surviving events and reject newly introduced non-timing errors. Every full operation records the source and identity snapshots before and after the edit. Pitch edits retain their fast local path, with additional accidental patches only in affected bars. Runtime IDs are not added to the XML.

Deleting an object intentionally removes its owned content. Other unknown fields are retained. An operation that would consume a marked/extended rest, guess ambiguous tied endpoints or round an unrepresentable duration is guarded. Clipboard copies intentionally omit dangling source ties, span markers, beams, unique note IDs and instrument references; this is a defined partial copy workflow.

The source suite, standalone Swift bridge/persistence/audio checks, native engraving adapter and optional official MusicXML 4.0 XSD workflow check provide separate evidence. They do not prove unrestricted schema validity, complete concerto fidelity or full professional feature parity. See [SWIFT_NATIVE.md](SWIFT_NATIVE.md) for executed checkpoint results.

## Next implementation priorities

1. Introduce a temporal edit transaction for insert/remove time, synchronized multi-voice rebar, ties across new boundaries and divisions changes. Qualify it with normalized event comparisons and exact undo/source preservation before exposing unrestricted insertion.
2. Extend semantic selection and source hit mapping to all rendered notation, then add missing creation palettes and complete musical property validation. Support curves/handles and coordinated beam/tuplet transformations.
3. Add multi-voice/staff/range clipboard operations with complete identifier/span/instrument remapping and concert-pitch options.
4. Add part/instrument/staff management, percussion/tab editors, linked parts and composition setup breadth.
5. Complete orchestral import, engraving, performance and save/reopen qualification using full real scores, plus runtime schema checks that distinguish preserved extensions from newly invalid output.

These are remaining engineering tasks, not features shipped by the matrix or a promise that professional parity is finished.
