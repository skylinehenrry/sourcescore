# Berlin Free Orchestra playback

SourceScore can host the installed SINE Player Audio Unit on Apple Silicon, with one instrument and mixer per score part. The free Berlin licence and sample download are separate from the editor; no sounds or licence/account data are bundled in SourceScore or committed to Git.

## Use the installed sounds

Open the Mixer with its toolbar button or F10. Available Berlin sounds are assigned by instrument name and General MIDI program. Choose another sound per part when needed. Each channel retains mute, solo, volume and pan. Built-in sounds are explicitly labelled; Berlin does not include a piano, so piano continues using the selected built-in or SF2/DLS sound.

Select **Instrument settings…** to open that part's SINE interface inside SourceScore. Closing the settings window saves its state to the local sound preset. These settings are reused for that sound; they are not score notation or XML changes. Existing per-file sound assignments are stored locally when a score has a file path. **Playback → Use Berlin Free Orchestra** restores automatic assignments or switches to the built-in sounds for the current score.

## Configure a fresh installation

1. Install the official SINE Player, activate your Orchestral Tools account, claim [Berlin Free Orchestra](https://www.orchestraltools.com/berlin-free-orchestra), and download its instruments from SINE's My Licenses page.
2. Load a Berlin string instrument in SINE and export a complete `.otsave` using its Save/Load control. Account and newsletter consent remain under the user's control.
3. Run `python3 scripts/configure-berlin.py --template /absolute/path/to/your.otsave`. It reads SINE's installed-library index and creates complete local presets only for downloaded instruments. It uses the exported settings as a compatible template, expands their playable range, maps available articulations to keys below the musical range, and leaves legato disabled for polyphonic score preview. Existing local settings are preserved unless `--replace` is supplied. Different instruments can need adjustments to balance and articulation settings in SINE.
4. Choose **Playback → Refresh Installed Sounds** in SourceScore. The configured sounds become available in the Mixer.

The configuration files live in `~/Library/Application Support/SourceScore/Sounds/Berlin Free Orchestra`. The setup script uses SINE 1.4's exported state format; rerun the audio check after a player/library update. The script does not alter SINE's account or library database. You can also import an individual complete `.otsave` or `.aupreset` through **Playback → Import SINE Preset…**.

## Playback coverage

Sustained and short notes, pizzicato directions and tremolo markings select corresponding preset articulations where present. MusicXML dynamic levels drive velocity and SINE's dynamics controller; mixer gain and pan apply afterward. Notes outside a library's recorded range can still be silent or sound less natural. Advanced slur-driven legato, hairpin curves, trills/ornament synthesis, repeat navigation and comprehensive percussion mappings remain further work. This is a score-preview integration rather than VSL/Dorico playback parity.

`npm run desktop:sine:test` renders each configured sound through SINE and verifies real audio plus mute/solo silence. It requires a licensed, installed library and local presets. `npm run desktop:test` checks the built-in renderer and preserving MusicXML bridge, including unpitched notes and articulation extraction.

SINE's [library guide](https://orchestraltools.helpscoutdocs.com/article/303-how-to-use-the-library-view), [preset controls](https://orchestraltools.helpscoutdocs.com/article/300-header-toolbar) and [articulation guide](https://orchestraltools.helpscoutdocs.com/article/301-loaded-articulations) describe the player's own setup and mapping options.
