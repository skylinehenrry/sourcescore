"""Configure local SINE presets from a user-exported instrument state and installed library.

No samples, licences, account credentials or vendor presets are redistributed.
The generated files stay in the user's application-support directory.
"""
import argparse
import copy
import json
import plistlib
import sqlite3
import uuid
from pathlib import Path


def identity():
    return str(uuid.uuid4())


def installed(position):
    path = str(position["filePath"])
    archive = Path(path.split(".otmeta/")[0] + (".otmeta" if ".otmeta/" in path else ""))
    return bool(position["installedInstrumentVersion"] and archive.is_file())


def mapping(title):
    name = title.lower()
    solo = "solo" in name
    if "string ensemble" in name:
        return [48, 49], ["string ensemble", "strings", "archi"], False
    if "violin" in name:
        return ([] if solo else [40]), (["solo violin", "violin solo"] if solo else ["violin", "violino"]), False
    if "viola" in name:
        return [41], ["viola"], False
    if "cello" in name or "celli" in name:
        return ([] if solo else [42]), (["solo cello", "cello solo"] if solo else ["cello", "celli", "violoncello"]), False
    if any(word in name for word in ["basses", "double bass", "contrabass"]):
        return [43], ["double bass", "contrabass", "basses"], False
    if "harp" in name:
        return [46], ["harp", "arpa"], False
    if "woodwind ensemble" in name:
        return [], ["woodwind", "woodwinds", "legni"], False
    if "brass ensemble" in name:
        return [], ["brass", "ottoni"], False
    for words, program, aliases in [
        (["piccolo"], 72, ["piccolo"]), (["flute"], 73, ["flute", "flauto"]),
        (["english horn"], 69, ["english horn", "cor anglais"]),
        (["oboe"], 68, ["oboe"]), (["clarinet"], 71, ["clarinet", "clarinetto"]),
        (["bassoon"], 70, ["bassoon", "fagott"]),
        (["horn"], 60, ["horn", "corno", "corni"]), (["trumpet"], 56, ["trumpet", "tromba"]),
        (["trombone"], 57, ["trombone"]), (["tuba"], 58, ["tuba"]),
        (["timpani"], 47, ["timpani", "timpano"]), (["glock"], 9, ["glockenspiel", "campanelli"]),
        (["celesta"], 8, ["celesta"]), (["marimba"], 12, ["marimba"]),
        (["vibra"], 11, ["vibraphone"]), (["xylophone"], 13, ["xylophone"]),
        (["tubular", "chime"], 14, ["tubular bells", "chimes"]),
    ]:
        if any(word in name for word in words):
            if "bass " in name or "contrabass " in name:
                return [], [name.replace("solo ", "")], False
            if not solo and any(word in name for word in ["flutes", "clarinets", "bassoons"]):
                return [], [word + "s" for word in aliases if word + "s" in name] + [title.lower()], False
            return [program], aliases, False
    for words, aliases in [
        (["bass drum"], ["bass drum", "gran cassa"]), (["snare"], ["snare", "tamburo"]),
        (["cymbal"], ["cymbal", "piatti"]), (["tam-tam", "tamtam", "gong"], ["tam-tam", "tam tam", "gong"]),
        (["triangle"], ["triangle", "triangolo"]), (["tambour"], ["tambourine"]),
        (["shaker"], ["shaker"]), (["castanet"], ["castanet"]), (["woodblock"], ["woodblock"]),
    ]:
        if any(word in name for word in words):
            return [], aliases, True
    return [], [title.lower()], False


def configure(template_path, directory, replace=False):
    source = json.loads(template_path.read_bytes())
    if source.get("fileFormatVersion") != "1.0" or not source.get("samplerVersion", "").startswith("1.4."):
        raise ValueError("Export a preset from SINE Player 1.4 first.")
    instrument_template = source["instruments"][0]
    if not instrument_template.get("articulations"):
        raise ValueError("The exported SINE preset contains no loaded instrument.")
    library = Path.home() / "Library/Application Support/Orchestral Tools/SINE Player/SINELibrary.db"
    database = sqlite3.connect("file:" + str(library) + "?mode=ro", uri=True)
    database.row_factory = sqlite3.Row
    instruments = database.execute("""SELECT i.* FROM t_instrument i JOIN t_collection c
        ON c.collection_key=i.instrument_collection WHERE c.collection_id='5069' ORDER BY i.sortIdx""").fetchall()
    directory.mkdir(parents=True, exist_ok=True)
    old_index = json.loads((directory / "index.json").read_text()) if (directory / "index.json").exists() else []
    entries = [entry for entry in old_index if not entry["id"].startswith("berlin:")]
    for row in instruments:
        articulations = database.execute("""SELECT * FROM t_articulation WHERE articulation_instrument=?
            AND hidden=0 AND kind='single' ORDER BY articulation_key""", (row["instrument_key"],)).fetchall()
        if not articulations:
            continue
        positions = database.execute("SELECT * FROM t_micPosition WHERE micposition_instrument=?", (row["instrument_key"],)).fetchall()
        if not any(installed(position) for position in positions):
            continue
        preset = copy.deepcopy(source)
        instrument = copy.deepcopy(instrument_template)
        instrument.update(instanceId=identity(), id=row["instrument_id"], title=row["title"], midiChannel="1", omniMode="false", keyRangeLow="0", keyRangeHigh="127")
        instrument["micPositions"] = []
        for position in positions:
            mic = copy.deepcopy(instrument_template["micPositions"][0])
            mic.update(instanceId=identity(), id=position["micposition_id"], title=position["title"], enabled="true", outputBusIndex="0", volume="0", balance="0")
            instrument["micPositions"].append(mic)
        instrument["articulations"] = []
        keys = {}
        for index, articulation in enumerate(articulations):
            name = articulation["title"].lower()
            original = next((a for a in instrument_template["articulations"] if a["id"] == articulation["articulation_id"]), instrument_template["articulations"][0])
            settings = copy.deepcopy(original)
            settings.update(instanceId=identity(), id=articulation["articulation_id"], title=articulation["title"], active="true" if index == 0 else "false", keyRangeLow="0", keyRangeHigh="127", definedKeyRangeLow="0", definedKeyRangeHigh="127")
            settings["mainOptions"]["switchValue"] = str(index)
            settings["legatoOptions"]["legato"] = "false"
            instrument["articulations"].append(settings)
            if index == 0 or "sustain" in name or "long" in name:
                keys["default"] = index
            if "stacc" in name or "spicc" in name or "short" in name:
                keys.update(staccato=index, staccatissimo=index)
            if "pizz" in name:
                keys["pizzicato"] = index
            if "trem" in name or "roll" in name:
                keys["tremolo"] = index
        instrument["switchType"] = "KEYSWITCH"
        preset["instruments"] = [instrument]
        preset["selectedEntry"] = {"instrumentIndex": "0", "articulationIndex": "0"}
        preset["keyswitchOptions"]["ksAreaStartHighInstrument"] = "0"
        preset["keyswitchOptions"]["ksAreaStartLowInstrument"] = "0"
        file_name = row["instrument_id"] + ".aupreset"
        state = {"type": int.from_bytes(b"aumu", "big"), "subtype": int.from_bytes(b"Y355", "big"), "manufacturer": int.from_bytes(b"Orto", "big"),
            "version": 0, "name": "SINE Player", "jucePluginState": json.dumps(preset).encode(), "data": b""}
        path = directory / file_name
        if replace or not path.exists():
            path.write_bytes(plistlib.dumps(state))
        programs, aliases, percussion = mapping(row["title"])
        entries.append(dict(id="berlin:" + row["instrument_id"], name=row["title"], preset=file_name, programs=programs, aliases=aliases,
            percussion=percussion, articulationKeys=keys, dynamicsCC=1))
        if percussion:
            entries[-1]["fixedMidi"] = 60
    temporary = directory / "index.json.tmp"
    temporary.write_text(json.dumps(entries, indent=2) + "\n")
    temporary.replace(directory / "index.json")
    print(f"Configured {len(entries)} local sounds; only fully installed instruments were included.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Configure local Berlin Free Orchestra sounds for SourceScore.")
    parser.add_argument("--template", type=Path, required=True, help="An .otsave exported with a Berlin instrument loaded")
    parser.add_argument("--directory", type=Path, default=Path.home() / "Library/Application Support/SourceScore/Sounds/Berlin Free Orchestra")
    parser.add_argument("--replace", action="store_true", help="Replace generated settings (otherwise preserve existing edits)")
    args = parser.parse_args()
    configure(args.template, args.directory, args.replace)
