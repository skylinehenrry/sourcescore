import {ScoreRenderer} from '../src/renderer/ScoreRenderer';
const host=document.getElementById('score') as HTMLDivElement;
host.style.width='1400px';
const renderer=new ScoreRenderer(host);
(globalThis as any).renderNativeScore=async(payload:any)=>{
  const result=await renderer.render({xml:payload.xml,noteIds:payload.noteIds},new Map(payload.notes.map((n:any)=>[n.id,n])),1);
  const svg=host.querySelector('svg')!;
  const shape=svg.getBoundingClientRect();
  return {svg:svg.outerHTML,width:shape.width,height:shape.height,targets:result.targets,notes:payload.notes,revision:payload.revision,mappedCount:result.mappedCount,sourceCount:result.sourceCount,alignment:renderer.measureAlignment()};
};
renderer.useSharedPageLayout(4);
function ready(){(globalThis as any).webkit?.messageHandlers?.rendererReady?.postMessage('ready');}
ready();
