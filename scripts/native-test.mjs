import {spawnSync} from 'node:child_process';
import {mkdirSync} from 'node:fs';
import {build} from 'esbuild';
mkdirSync('work',{recursive:true});
await build({entryPoints:['native/core-api.ts'],bundle:true,format:'iife',target:'es2022',outfile:'native/Resources/core.js'});
const sources=['Models','CoreEngine','FileStore','VectorScene','PlaybackControl','AudioPlayer'].map(name=>`native/Sources/SourceScore/${name}.swift`);
const result=spawnSync('swiftc',['-swift-version','5','-parse-as-library',...sources,'native/Tests/NativeCheck.swift','-o','work/native-check'],{stdio:'inherit'});
if(result.status!==0)process.exit(result.status??1);
const run=spawnSync('work/native-check',['native/Resources'],{stdio:'inherit',timeout:60000});process.exit(run.status??1);
