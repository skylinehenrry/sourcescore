import type { ScorePart } from './model';
import { children, encodeXml, field, qualified } from './xml';

/** Clip octave lines to the view only; never write synthetic endpoints into source. */
export function octaveShiftContext(source:string, part:ScorePart, start:number, count:number) {
  type Shift = { attributes:Record<string,string>; staff:string; placement?:string };
  const active = new Map<string,Shift>();
  const tag = (name:string) => qualified(part.node,name);
  const direction = (shift:Shift, stop=false) => {
    const attributes = {...shift.attributes, ...(stop?{type:'stop'}:{})};
    const attrs = Object.entries(attributes).map(([key,value])=>` ${key}="${encodeXml(value)}"`).join('');
    const placement = shift.placement?` placement="${encodeXml(shift.placement)}"`:'';
    return `<${tag('direction')}${placement}><${tag('direction-type')}><${tag('octave-shift')}${attrs}/></${tag('direction-type')}><${tag('staff')}>${encodeXml(shift.staff)}</${tag('staff')}></${tag('direction')}>`;
  };
  let opening = '';
  for (let index=0; index<Math.min(part.measures.length,start+count); index++) {
    if (index===start) opening = [...active.values()].map(s=>direction(s)).join('');
    for (const d of children(part.measures[index].node,'direction')) {
      const staff = field(source,d,'staff','1');
      for (const type of children(d,'direction-type')) for (const shift of children(type,'octave-shift')) {
        const key = `${staff}:${shift.attributes.number??'1'}`;
        if (shift.attributes.type==='stop') active.delete(key);
        else if (shift.attributes.type==='up'||shift.attributes.type==='down') {
          active.set(key,{attributes:{...shift.attributes},staff,placement:d.attributes.placement});
        }
      }
    }
  }
  return {opening, closing:[...active.values()].map(s=>direction(s,true)).join('')};
}
