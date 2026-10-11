import {chromium} from '@playwright/test';
import {readFileSync,existsSync} from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const browser=await chromium.launch({channel:'chrome',headless:true});
try {
  const page=await browser.newPage({viewport:{width:1500,height:1600}});
  await page.setContent('<html><head><style>body{margin:0}#score{line-height:0}</style></head><body><div id="score"></div></body></html>');
  await page.addScriptTag({path:path.resolve('native/Resources/core.js')});
  await page.addScriptTag({path:path.resolve('native/Resources/engraver.js')});
  const fixtures=['fixtures/orchestral-study.musicxml','fixtures/local/rachmaninoff-variation18.musicxml'].filter(existsSync);
  for(const file of fixtures) {
    const source=readFileSync(file,'utf8');
    const result=await page.evaluate(async({source})=>{
      function call(method,args={}){const r=JSON.parse(window.SourceScoreCore.call(method,args));if(!r.ok)throw new Error(r.error);return r.value;}
      const opened=call('open',{source});
      const payload=call('page',{start:0,count:4});
      const scene=await window.renderNativeScore({...payload,height:1100});
      return {height:scene.height,width:scene.width,spacing:scene.spacing,alignment:scene.alignment,bars:scene.bars,targets:scene.targets.length,mapped:scene.mappedCount,sourceCount:scene.sourceCount,intact:call('source')===source,parts:opened.parts};
    },{source});
    assert(result.intact,'Layout changed authoritative MusicXML');
    assert.equal(result.mapped,result.sourceCount,'Lost source-note mapping');
    assert.equal(result.bars.length,result.alignment.reduce((n,m)=>n+m.staves.length,0),'Lost clickable staff/bar areas');
    for(const bar of result.bars){const part=result.parts.find(p=>p.id===bar.partId);assert(part&&bar.staff>=1&&bar.staff<=part.staves&&bar.width>0&&bar.height>0,'Wrong part/staff on a bar area');}
    for(const m of result.alignment)for(const staff of m.staves)assert(Math.abs(staff.x-m.staves[0].x)<0.05,'Instrument bars lost alignment');
    for(const system of result.spacing)if(system.gaps.length)assert(Math.max(...system.gaps)-Math.min(...system.gaps)<0.05,'Instrument gaps are unequal');
    assert(result.height>=1099,'Page did not use available height');
    if(file.includes('orchestral-study'))assert(result.height<=1101,'Simple page unnecessarily overflows its viewport');
    console.log(`PASS Native engraving: ${result.parts.length} parts, ${result.targets} targets, uniform instrument spacing, ${Math.round(result.height)} px, source intact`);
  }
  const composition=await page.evaluate(async()=>{
    function call(method,args={}){const r=JSON.parse(window.SourceScoreCore.call(method,args));if(!r.ok)throw new Error(r.error);return r.value;}
    call('open',{source:call('new-score',{title:'Entry engraving',instruments:['Piano','Flute'],bars:4})});
    call('input',{id:'0:0:0',letter:'C',type:'quarter'});
    call('input',{id:'0:0:0',letter:'E',type:'quarter',chord:true});
    call('marking',{id:'0:0:0',kind:'articulation',symbol:'staccato'});
    call('marking',{id:'0:0:0',kind:'lyric',text:'Hello'});
    call('marking',{id:'0:0:0',kind:'dynamic',symbol:'mf'});
    call('tuplet',{id:call('input-next',{id:'0:0:0'}).id,actual:3,normal:2});
    call('validate-save');const payload=call('page',{start:0,count:4}),source=call('source'),scene=await window.renderNativeScore({...payload,height:1100});
    return {mapped:scene.mappedCount,sourceCount:scene.sourceCount,bars:scene.bars.length,intact:source===call('source')};
  });
  assert.equal(composition.mapped,composition.sourceCount,'New notes lost engraving identity');
  assert.equal(composition.bars,12,'New composition staff/bar areas');assert(composition.intact,'New composition engraving changed source');
  console.log('PASS Native new composition engraving: note/chord entry, tuplets, lyrics, articulation and dynamic targets');
  const resized=await page.evaluate(async()=>{
    const widths=[900,1800,2600,1100];
    function call(method,args={}){const r=JSON.parse(window.SourceScoreCore.call(method,args));if(!r.ok)throw new Error(r.error);return r.value;}
    const source=call('source'),payload=call('page',{start:0,count:4});
    const results=[];
    for(const width of widths){
      const scene=await window.renderNativeScore({...payload,width,height:1100});
      results.push({requested:width,width:scene.width,right:Math.max(...scene.bars.map(b=>b.left+b.width)),mapped:scene.mappedCount,count:scene.sourceCount,bars:scene.bars.length});
    }
    return {results,intact:source===call('source')};
  });
  assert(resized.intact,'Window resizing changed MusicXML');
  for(const scene of resized.results){
    assert(Math.abs(scene.width-scene.requested)<1,'Engraving ignored the score viewport width');
    assert(scene.right>scene.requested*0.85,'Measures left a large unused area on the right');
    assert.equal(scene.mapped,scene.count,'Resizing lost editable note identities');
    assert.equal(scene.bars,12,'Resizing lost editable staff/bar areas');
  }
  console.log('PASS Score fills narrow/wide/resized viewports with intact note/bar editing identities and unchanged XML');
} finally {await browser.close();}
