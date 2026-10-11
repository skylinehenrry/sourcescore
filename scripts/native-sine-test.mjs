import {spawnSync} from 'node:child_process';
import {mkdirSync} from 'node:fs';
mkdirSync('work',{recursive:true});
const sources=['Models','PlaybackControl','SoundLibrary','AudioPlayer'].map(name=>`native/Sources/SourceScore/${name}.swift`);
const built=spawnSync('swiftc',['-swift-version','5','-parse-as-library',...sources,'native/Tests/SineCheck.swift','-o','work/sine-check'],{stdio:'inherit'});
if(built.status!==0)process.exit(built.status??1);
const result=spawnSync('work/sine-check',process.argv.slice(2),{stdio:'inherit',timeout:180000});
process.exit(result.status??1);
