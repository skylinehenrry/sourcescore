import { writeFileSync } from 'node:fs';

const note = (step: string, octave: number, ticks = 48, extras = '', staff = 1, voice = '1', type = 'quarter', alter = 0) => `<note>${extras}<pitch><step>${step}</step>${alter ? `<alter>${alter}</alter>` : ''}<octave>${octave}</octave></pitch><duration>${ticks}</duration><voice>${voice}</voice><type>${type}</type>${alter ? `<accidental>${alter > 0 ? 'sharp' : 'flat'}</accidental>` : ''}<staff>${staff}</staff></note>`;
const rest = (ticks = 48, type = 'quarter', staff = 1, voice = '1') => `<note><rest/><duration>${ticks}</duration><voice>${voice}</voice><type>${type}</type><staff>${staff}</staff></note>`;

export function orchestralFixture(measures = 12, instruments = 6) {
  const names = ['Flute', 'Clarinet in B♭', 'Horn in F', 'Piano', 'Violin I', 'Cello'];
  let xml = `<?xml version="1.0" encoding="UTF-8"?>\n<!-- Original spacing and unsupported notation are deliberately retained. -->\n<score-partwise version="4.0"><work><work-title>Orchestral editing study</work-title></work><identification><creator type="composer">SourceScore regression fixture</creator></identification><part-list>`;
  for (let p = 0; p < instruments; p++) xml += `<score-part id="P${p + 1}"><part-name>${names[p % 6]}${p >= 6 ? ` ${p + 1}` : ''}</part-name><part-abbreviation>${['Fl.', 'Cl.', 'Hn.', 'Pno.', 'Vln. I', 'Vc.'][p % 6]}</part-abbreviation><score-instrument id="I${p + 1}"><instrument-name>${names[p % 6]}</instrument-name></score-instrument></score-part>`;
  xml += '</part-list>\n';
  for (let p = 0; p < instruments; p++) {
    const piano = p % 6 === 3, bass = p % 6 === 5;
    xml += `<part id="P${p + 1}">\n`;
    for (let m = 1; m <= measures; m++) {
      xml += `<measure number="${m}">\n`;
      if (m === 1) xml += `<attributes><divisions>48</divisions><key><fifths>1</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time>${piano ? '<staves>2</staves>' : ''}<clef${piano ? ' number="1"' : ''}><sign>${bass ? 'F' : 'G'}</sign><line>${bass ? 4 : 2}</line></clef>${piano ? '<clef number="2"><sign>F</sign><line>4</line></clef>' : ''}${p % 6 === 1 ? '<transpose><diatonic>-1</diatonic><chromatic>-2</chromatic></transpose>' : p % 6 === 2 ? '<transpose><diatonic>-4</diatonic><chromatic>-7</chromatic></transpose>' : ''}</attributes>\n<direction placement="below"><direction-type><dynamics><p/></dynamics></direction-type><staff>1</staff></direction>\n`;
      const octave = bass ? 3 : p % 6 === 0 ? 5 : 4;
      if (m % 4 === 2 && !piano) {
        for (const [i, step] of ['G', 'A', 'B'].entries()) xml += note(step, octave, 16, '', 1, '1', 'eighth').replace('<staff>1</staff>', '<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification><staff>1</staff>').replace('</note>', `<notations>${i === 0 ? '<tuplet type="start" number="1"/>' : i === 2 ? '<tuplet type="stop" number="1"/>' : ''}</notations></note>`) + '\n';
        xml += rest() + note('D', octave) + note('E', octave);
      } else {
        xml += note('F', octave, 48, '', 1, '1', 'quarter', 1);
        if (piano) xml += note('A', octave, 48, '<chord/>') + note('C', octave + 1, 48, '<chord/>');
        xml += '\n' + rest() + '\n' + note('G', octave, 24, '', 1, '1', 'eighth') + note('A', octave, 24, '', 1, '1', 'eighth') + rest();
      }
      if (piano) xml += '<backup><duration>192</duration></backup>\n' + ['C', 'G', 'E', 'G'].map((step, i) => note(step, i === 2 ? 3 : 2, 48, '', 2, '2')).join('\n');
      if (m === 3) xml += '<direction><direction-type><words font-style="italic">dolce</words></direction-type></direction><!-- preserve unsupported metadata --><barline location="right"><bar-style>regular</bar-style></barline>';
      xml += '\n</measure>\n';
    }
    xml += '</part>\n';
  }
  return xml + '</score-partwise>\n';
}
if (process.argv[1]?.endsWith('fixtures.ts')) writeFileSync(new URL('../fixtures/orchestral-study.musicxml', import.meta.url), orchestralFixture());
