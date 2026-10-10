import {encodeXml,ScoreError} from './xml';
export function newScore(title='Untitled score',instruments=['Piano'],bars=8,beats=4,unit=4){
  if(!Number.isInteger(bars)||bars<1||bars>1000||!Number.isInteger(beats)||beats<1||beats>32||![1,2,4,8,16,32].includes(unit)||!instruments.length||instruments.length>64)throw new ScoreError('Choose 1–1000 bars, a valid meter and at least one instrument.');
  const divisions=480,duration=beats*4/unit*divisions;let xml=`<?xml version="1.0" encoding="UTF-8"?>\n<score-partwise version="4.0"><work><work-title>${encodeXml(title)}</work-title></work><part-list>`;
  for(const [i,name] of instruments.entries())xml+=`<score-part id="P${i+1}"><part-name>${encodeXml(name)}</part-name><score-instrument id="I${i+1}"><instrument-name>${encodeXml(name)}</instrument-name></score-instrument></score-part>`;xml+='</part-list>';
  for(const [i,name] of instruments.entries()){const piano=/piano|keyboard|organ/i.test(name),bass=/cello|bass|trombone|tuba/i.test(name),staves=piano?2:1;xml+=`<part id="P${i+1}">`;
    for(let bar=1;bar<=bars;bar++){xml+=`<measure number="${bar}">`;if(bar===1)xml+=`<attributes><divisions>${divisions}</divisions><key><fifths>0</fifths></key><time><beats>${beats}</beats><beat-type>${unit}</beat-type></time>${piano?'<staves>2</staves>':''}<clef number="1"><sign>${bass?'F':'G'}</sign><line>${bass?4:2}</line></clef>${piano?'<clef number="2"><sign>F</sign><line>4</line></clef>':''}</attributes>`;
      for(let staff=1;staff<=staves;staff++){if(staff>1)xml+=`<backup><duration>${duration}</duration></backup>`;xml+=`<note><rest measure="yes"/><duration>${duration}</duration><voice>${staff}</voice><staff>${staff}</staff></note>`;}xml+='</measure>';}
    xml+='</part>';}
  return xml+'</score-partwise>\n';
}
