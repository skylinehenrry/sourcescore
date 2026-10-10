import {ScoreRenderer} from '../src/renderer/ScoreRenderer';
import {installNativeSpacing} from '../src/renderer/native-spacing';
installNativeSpacing();
const host=document.getElementById('score') as HTMLDivElement;
host.style.width='1400px';
const renderer=new ScoreRenderer(host);
(globalThis as any).renderNativeScore=async(payload:any)=>{
  renderer.setNativePageHeight(payload.height??900);
  const result=await renderer.render({xml:payload.xml,noteIds:payload.noteIds},new Map(payload.notes.map((n:any)=>[n.id,n])),1);
  const svg=host.querySelector('svg')!;
  const ink=svg.getBBox();
  const width=svg.getBoundingClientRect().width;
  const height=Math.max(payload.height??900,ink.y+ink.height+24);
  svg.setAttribute('height',String(height));
  svg.setAttribute('viewBox',`0 0 ${width} ${height}`);
  const shape=svg.getBoundingClientRect();
  return {svg:svg.outerHTML,width:shape.width,height:shape.height,targets:result.targets,notes:payload.notes,revision:payload.revision,start:payload.start??0,measureTops:renderer.measureTops(),mappedCount:result.mappedCount,sourceCount:result.sourceCount,alignment:renderer.measureAlignment(),spacing:renderer.instrumentSpacing()};
};
renderer.useSharedPageLayout(4);
function ready(){(globalThis as any).webkit?.messageHandlers?.rendererReady?.postMessage('ready');}
ready();
