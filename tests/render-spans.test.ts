import {test,expect} from 'vitest';
import {FastDocument} from '../src/core/fast-document';
import {parseScore} from '../src/core/model';
import {children,field} from '../src/core/xml';

const shift=(type:string,staff=1)=>`<direction><direction-type><octave-shift type="${type}" size="8" number="1"/></direction-type><staff>${staff}</staff></direction>`;
function fixture(both=false) {
  const measures=Array.from({length:8},(_,i)=>`<measure number="${i+1}">${i===0?'<attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves></attributes>':''}${i===3?shift('down')+(both?shift('up',2):''):''}<note><pitch><step>C</step><octave>6</octave></pitch><duration>4</duration><type>whole</type><staff>1</staff></note>${i===6?shift('stop')+(both?shift('stop',2):''):''}</measure>`).join('');
  return `<score-partwise><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1">${measures}</part></score-partwise>`;
}
function shifts(xml:string) {
  const model=parseScore(xml);
  return model.parts[0].measures.flatMap(m=>children(m.node,'direction').flatMap(d=>children(d,'direction-type').flatMap(t=>children(t,'octave-shift').map(s=>({type:s.attributes.type,staff:field(xml,d,'staff','1')})))));
}
test('page slices close and resume an octave line without changing source or playback pitches',()=>{
  const source=fixture(),doc=new FastDocument(source);
  const pitch=doc.note('0:4:0').pitch;
  expect(shifts(doc.renderSlice(0,4).xml)).toEqual([{type:'down',staff:'1'},{type:'stop',staff:'1'}]);
  expect(shifts(doc.renderSlice(4,4).xml)).toEqual([{type:'down',staff:'1'},{type:'stop',staff:'1'}]);
  expect(doc.source).toBe(source);expect(doc.dirty).toBe(false);expect(doc.note('0:4:0').pitch).toEqual(pitch);
});
test('octave lines on two staves retain independent context and original endpoints',()=>{
  const source=fixture(true),doc=new FastDocument(source);
  const expected=[{type:'down',staff:'1'},{type:'up',staff:'2'},{type:'stop',staff:'1'},{type:'stop',staff:'2'}];
  expect(shifts(doc.renderSlice(0,4).xml)).toEqual(expected);
  expect(shifts(doc.renderSlice(4,4).xml)).toEqual(expected);
  expect(shifts(doc.renderSlice(7,1).xml)).toEqual([]);
  expect(doc.source).toBe(source);
});
