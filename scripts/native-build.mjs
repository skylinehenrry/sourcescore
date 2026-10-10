import {build} from 'esbuild';
import {spawnSync} from 'node:child_process';
import {cpSync,mkdirSync,writeFileSync,rmSync,existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=fileURLToPath(new URL('..',import.meta.url));
const run=(command,args)=>{const result=spawnSync(command,args,{cwd:root,stdio:'inherit'});if(result.status!==0)process.exit(result.status??1)};
mkdirSync(path.join(root,'native/Resources'),{recursive:true});
await build({entryPoints:[path.join(root,'native/core-api.ts')],bundle:true,format:'iife',target:'es2022',outfile:path.join(root,'native/Resources/core.js')});
await build({entryPoints:[path.join(root,'native/render-entry.ts')],bundle:true,format:'iife',target:'safari16',outfile:path.join(root,'native/Resources/engraver.js')});
cpSync(path.join(root,'fixtures/orchestral-study.musicxml'),path.join(root,'native/Resources/example.musicxml'));
run('swift',['build','--package-path','native','-c','release']);
const bin=spawnSync('swift',['build','--package-path','native','-c','release','--show-bin-path'],{cwd:root,encoding:'utf8'}).stdout.trim();
const app=path.join(root,'releases/SourceScore.app');rmSync(app,{recursive:true,force:true});mkdirSync(path.join(app,'Contents/MacOS'),{recursive:true});mkdirSync(path.join(app,'Contents/Resources'),{recursive:true});
cpSync(path.join(bin,'SourceScore'),path.join(app,'Contents/MacOS/SourceScore'));
cpSync(path.join(bin,'SourceScore_SourceScore.bundle'),path.join(app,'Contents/Resources/SourceScore_SourceScore.bundle'),{recursive:true});
cpSync(path.join(root,'src-tauri/icons/icon.icns'),path.join(app,'Contents/Resources/AppIcon.icns'));
cpSync(path.join(root,'THIRD_PARTY_NOTICES.txt'),path.join(app,'Contents/Resources/THIRD_PARTY_NOTICES.txt'));
writeFileSync(path.join(app,'Contents/Info.plist'),`<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict>
<key>CFBundleName</key><string>SourceScore</string><key>CFBundleDisplayName</key><string>SourceScore</string><key>CFBundleIdentifier</key><string>local.sourcescore.editor</string><key>CFBundleExecutable</key><string>SourceScore</string><key>CFBundlePackageType</key><string>APPL</string><key>CFBundleShortVersionString</key><string>0.3.0</string><key>CFBundleVersion</key><string>3</string><key>CFBundleIconFile</key><string>AppIcon</string><key>LSMinimumSystemVersion</key><string>14.0</string><key>NSHighResolutionCapable</key><true/><key>NSPrincipalClass</key><string>NSApplication</string><key>CFBundleDocumentTypes</key><array><dict><key>CFBundleTypeName</key><string>MusicXML score</string><key>CFBundleTypeRole</key><string>Editor</string><key>CFBundleTypeExtensions</key><array><string>musicxml</string><string>xml</string></array></dict></array>
</dict></plist>`);
run('/usr/bin/codesign',['--force','--deep','--sign','-',app]);run('/usr/bin/codesign',['--verify','--deep','--strict',app]);
console.log(`Built native Swift app: ${app}`);
