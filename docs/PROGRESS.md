# Initial development checkpoint

## Implemented

The requested project was created as an independent repository under Documents/Projects. The first usable foundation and a conservative portion of core editing are implemented, packaged and covered by executed tests. Pitch/accidental/chord correction is functional, and balanced duration changes use an explicit following-rest workflow. File bytes remain authoritative. See README for the precise supported domain and limitations.

## Deferred capabilities

Advanced rhythmic editing (note insertion/deletion, rest splitting, ties, editable tuplets/beams), independent notation editing, complete concerto qualification, fully incremental parsing/layout, stronger exceptional-measure validation, crash recovery and distribution notarization are not implemented. These were deferred to preserve a working application and prevent unsafe XML guesses.

## Native qualification and next priority

The final packaged macOS save completion, Save As, reopen, conflict refusal, undo/redo and unsaved-close protection passed native smoke checks after the directory-read fix. There are 29 core tests, eight Rust file tests and 20 Chrome/WebKit interaction tests passing. Complete real concerto qualification and coordinated rest/tie/beam/tuplet operations are the next priorities.

## Useful commands

Run `npm run desktop:dev` to develop, `npm run desktop:build` to refresh the app, `npm test` for source/semantic checks, `npm run desktop:test` for persistence checks and `npm run test:ui` for browser interaction checks. The project's `.cache/playwright` is selected with `PLAYWRIGHT_BROWSERS_PATH="$PWD/.cache/playwright"` when running WebKit tests. The local Rust toolchain is selected automatically by the desktop script.
