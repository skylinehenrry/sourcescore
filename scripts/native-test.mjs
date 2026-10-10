import {spawnSync} from 'node:child_process';
import {mkdirSync} from 'node:fs';
mkdirSync('work',{recursive:true});
const sources=['Models','CoreEngine','FileStore','VectorScene','AudioPlayer'].map(name=>`native/Sources/SourceScore/${name}.swift`);
const result=spawnSync('swiftc',['-swift-version','5','-parse-as-library',...sources,'native/Tests/NativeCheck.swift','-o','work/native-check'],{stdio:'inherit'});
if(result.status!==0)process.exit(result.status??1);
const run=spawnSync('work/native-check',['native/Resources'],{stdio:'inherit',timeout:60000});process.exit(run.status??1);
