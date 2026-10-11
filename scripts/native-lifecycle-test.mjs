import assert from 'node:assert/strict';
import {spawn, spawnSync} from 'node:child_process';
import {mkdtempSync, mkdirSync, rmSync, copyFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';

mkdirSync('work',{recursive:true});
const built=spawnSync('swiftc',['-swift-version','5','-parse-as-library',
  'native/Sources/SourceScore/ApplicationInstance.swift','native/Tests/InstanceCheck.swift',
  '-o','work/instance-check'],{stdio:'inherit'});
assert.equal(built.status,0,'Could not build native instance check');
const directory=mkdtempSync(path.join(tmpdir(),'sourcescore-instance-'));
const lock=path.join(directory,'app.lock');
const executable=path.resolve('work/instance-check');
const copy=path.join(directory,'copied-app');
copyFileSync(executable,copy);
const run=(program=executable,seconds=0)=>new Promise((resolve,reject)=>{
  const child=spawn(program,[lock,String(seconds)]); let output='';
  child.stdout.on('data',data=>{output+=data});child.on('error',reject);
  child.on('close',code=>resolve({child,code,output:output.trim()}));
});
try {
  const owner=spawn(executable,[lock,'30']);
  await new Promise((resolve,reject)=>{
    owner.stdout.once('data',data=>String(data).includes('acquired')?resolve():reject(Error('Owner did not acquire lock')));
    owner.once('error',reject);
  });
  try {
    const contenders=await Promise.all(Array.from({length:8},(_,i)=>run(i%2?copy:executable)));
    assert(contenders.every(r=>r.code===0&&r.output==='blocked'),'A second app copy acquired the active session');
    console.log('PASS Single app across simultaneous launches and copied executables');
  } finally {
    const exit=new Promise(resolve=>owner.once('close',resolve));owner.kill('SIGKILL');await exit;
  }
  const recovered=await run(copy);
  assert.equal(recovered.output,'acquired','A crash left the app permanently locked');
  assert.equal((await run()).output,'acquired','Normal exit left the app locked');
  console.log('PASS App can relaunch after crash and normal quit, without deleting the lock file');
} finally { rmSync(directory,{recursive:true,force:true}); }
