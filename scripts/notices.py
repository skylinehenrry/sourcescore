"""Collect installed third-party license texts; never inspect user project files."""
from pathlib import Path
import hashlib
import json
import tomllib

root = Path(__file__).resolve().parent.parent
blocks: dict[str, tuple[list[str], str]] = {}

def add(label: str, text: str):
    key = hashlib.sha256(text.encode()).hexdigest()
    if key in blocks:
        blocks[key][0].append(label)
    else:
        blocks[key] = ([label], text)

lock = json.loads((root / 'package-lock.json').read_text())
for package, data in lock['packages'].items():
    if not package or data.get('dev') or not (root / package).is_dir():
        continue
    manifest = root / package / 'package.json'
    if not manifest.exists():
        continue
    info = json.loads(manifest.read_text())
    label = f"{info.get('name', package)} {info.get('version', '')} — {info.get('license', 'see included text')}"
    for path in (root / package).iterdir():
        if path.is_file() and path.name.upper().startswith(('LICENSE', 'LICENCE', 'COPYING', 'NOTICE')):
            add(label, path.read_text(errors='replace'))

registry = root / '.toolchain/cargo/registry/src'
crate_lock = tomllib.loads((root / 'src-tauri/Cargo.lock').read_text())
for crate in crate_lock['package']:
    for folder in registry.glob(f"*/{crate['name']}-{crate['version']}"):
        manifest = folder / 'Cargo.toml'
        metadata = tomllib.loads(manifest.read_text()).get('package', {}) if manifest.exists() else {}
        label = f"{crate['name']} {crate['version']} — {metadata.get('license', 'see included text')}"
        for path in folder.iterdir():
            if path.is_file() and path.name.upper().startswith(('LICENSE', 'LICENCE', 'COPYING', 'NOTICE')):
                add(label, path.read_text(errors='replace'))

lines = ['SourceScore third-party notices', 'Installed dependency license texts for the local build.', 'JSZip is used under its MIT licensing alternative.', '']
for labels, text in blocks.values():
    lines.extend(['=' * 72, '\n'.join(sorted(set(labels))), '=' * 72, text, ''])
(root / 'THIRD_PARTY_NOTICES.txt').write_text('\n'.join(lines))
print(f'Collected {len(blocks)} distinct license texts.')
