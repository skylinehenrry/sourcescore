import { OpenSheetMusicDisplay, type Note, type VexFlowGraphicalNote } from 'opensheetmusicdisplay';
import type { RenderSlice, ViewNote } from '../core/session';
import { ScoreError } from '../core/xml';
import { rendererTicks } from './timing';

export interface HitTarget { id: string; left: number; top: number; width: number; height: number; partId: string }
/** Injectable renderer-only colors carry identity through OSMD's reader, before restoring actual colors. */
export class ScoreRenderer {
  private osmd: OpenSheetMusicDisplay;
  private graphical = new Map<string, { note: VexFlowGraphicalNote; head?: HTMLElement }>();
  private originalColors = new Map<string, string>();
  private stemColors = new Map<string, string>();
  private nativeHeight?:number;
  constructor(private container: HTMLDivElement) {
    this.osmd = new OpenSheetMusicDisplay(container, {
      backend: 'svg', autoResize: false, drawTitle: false, drawSubtitle: false,
      drawComposer: false, drawLyricist: false, drawCredits: false,
      drawPartNames: true, drawMeasureNumbers: true, drawMeasureNumbersOnlyAtSystemStart: false,
      newSystemFromXML: false, newPageFromXML: false, pageFormat: 'Endless',
    });
    this.osmd.EngravingRules.RenderSingleHorizontalStaffline = false;
    this.osmd.EngravingRules.RenderMultipleRestMeasures = false;
    this.osmd.EngravingRules.RenderMeasureNumbers = true;
    this.osmd.EngravingRules.RenderMeasureNumbersOnlyAtSystemStart = false;
    this.osmd.EngravingRules.UseXMLMeasureNumbers = true;
  }
  async render(slice: RenderSlice, notes: Map<string, ViewNote>, zoom: number) {
    const xml = new DOMParser().parseFromString(slice.xml, 'application/xml');
    if (xml.querySelector('parsererror')) throw new ScoreError('Could not prepare the graphical view. The original source is intact.');
    const actualParts = [...xml.documentElement.children].filter(e => e.localName === 'part');
    const actualPartIds = new Set(actualParts.map(p => p.getAttribute('id')));
    for (const part of actualParts) {
      const fields: { value: string; set: (value: string) => void }[] = [];
      for (const element of [...part.getElementsByTagName('*')]) {
        if (element.namespaceURI !== xml.documentElement.namespaceURI) continue;
        if (['divisions', 'duration', 'offset'].includes(element.localName)) fields.push({ value: element.textContent ?? '', set: value => { element.textContent = value; } });
        if (element.localName === 'note') for (const name of ['attack', 'release']) if (element.hasAttribute(name)) fields.push({ value: element.getAttribute(name)!, set: value => element.setAttribute(name, value) });
        if (element.localName === 'sound' && element.hasAttribute('divisions')) fields.push({ value: element.getAttribute('divisions')!, set: value => element.setAttribute('divisions', value) });
      }
      const normalized = rendererTicks(fields.map(f => f.value));
      fields.forEach((field, i) => field.set(normalized[i]));
    }
    const partList = [...xml.documentElement.children].find(e => e.localName === 'part-list');
    if (partList) {
      const partial = [...partList.children].filter(e => e.localName === 'score-part').length !== actualPartIds.size;
      for (const entry of [...partList.children]) if ((entry.localName === 'score-part' && !actualPartIds.has(entry.getAttribute('id'))) || (partial && entry.localName === 'part-group')) entry.remove();
    }
    const elements = actualParts.flatMap(p => [...p.children].filter(m => m.localName === 'measure').flatMap(m => [...m.children].filter(n => n.localName === 'note' && n.namespaceURI === xml.documentElement.namespaceURI)));
    if (elements.length !== slice.noteIds.length) throw new ScoreError('The graphical note mapping is incomplete. Editing this view has been disabled.');
    const markerToId = new Map<string, string>();
    this.originalColors.clear(); this.stemColors.clear();
    elements.forEach((element, i) => {
      const id = slice.noteIds[i], color = '#' + (i + 1).toString(16).padStart(6, '0').toUpperCase();
      const notehead = [...element.children].find(c => c.localName === 'notehead');
      const stem = [...element.children].find(c => c.localName === 'stem');
      this.originalColors.set(id, notehead?.getAttribute('color') ?? element.getAttribute('color') ?? '#24262b');
      this.stemColors.set(id, stem?.getAttribute('color') ?? element.getAttribute('color') ?? '#24262b');
      element.setAttribute('color', color); if (notehead) notehead.setAttribute('color', color);
      markerToId.set(color, id);
    });
    // Inherited defaults may contain source page widths unsuitable for a desktop window.
    for (const element of [...xml.getElementsByTagName('*')]) {
      if (element.localName === 'print') { element.removeAttribute('new-system'); element.removeAttribute('new-page'); }
      if (element.localName === 'multiple-rest') element.remove();
    }
    await this.osmd.load(xml);
    const mapped = new Map<Note, string>();
    for (const measure of this.osmd.Sheet.SourceMeasures) for (const vertical of measure.VerticalSourceStaffEntryContainers) for (const staff of vertical.StaffEntries) {
      if (!staff) continue;
      for (const voice of staff.VoiceEntries) for (const note of voice.Notes) {
        const id = markerToId.get(note.NoteheadColorXml?.toUpperCase());
        if (!id) continue;
        mapped.set(note, id);
        const color = this.originalColors.get(id)!;
        note.NoteheadColor = color; note.NoteheadColorXml = color;
        // Marker color was also read as a stem color; restore it before engraving.
        note.StemColorXml = this.stemColors.get(id)!; note.ParentVoiceEntry.StemColor = this.stemColors.get(id)!;
      }
    }
    this.osmd.Zoom = zoom;
    this.osmd.render();
    if(this.nativeHeight) {
      const metrics=this.instrumentSpacing();
      const gaps=metrics.flatMap(s=>s.gaps),count=gaps.length;
      if(count) {
        const ink=this.container.querySelector('svg')!.getBBox();
        const currentHeight=ink.y+ink.height+24;
        const uniform=Math.max(0,...gaps);
        const equalization=gaps.reduce((sum,gap)=>sum+(uniform-gap)*10,0);
        const extra=Math.max(0,this.nativeHeight-currentHeight-equalization)/(count*10);
        (this.osmd.EngravingRules as any).SourceScoreInstrumentGap=uniform+extra;
        if(equalization>0.1||extra>0.01)this.osmd.render();
      }
    }
    // Overlay buttons supply precise musical labels; engraving paths are decorative for AX.
    for (const svg of this.container.querySelectorAll('svg')) { svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('focusable', 'false'); }
    this.graphical.clear();
    const bounds = this.container.getBoundingClientRect();
    const targets: HitTarget[] = [];
    for (const [note, id] of mapped) {
      const graphical = this.osmd.EngravingRules.GNote(note) as VexFlowGraphicalNote | undefined;
      if (!graphical || !note.PrintObject) continue;
      const heads = graphical.getNoteheadSVGs();
      const head = heads[graphical.vfnoteIndex] ?? heads[0];
      if (head) head.setAttribute('data-source-note',id);
      const element = head ?? graphical.getSVGGElement();
      if (!element) continue;
      const box = element.getBoundingClientRect(); if (!box.width || !box.height) continue;
      const width = Math.max(16, box.width + 6), height = Math.max(14, box.height + 4);
      targets.push({ id, left: box.left - bounds.left + box.width / 2 - width / 2, top: box.top - bounds.top + box.height / 2 - height / 2, width, height, partId: notes.get(id)!.partId });
      this.graphical.set(id, { note: graphical, head });
    }
    return { targets, sourceCount: elements.length, mappedCount: new Set(mapped.values()).size };
  }
  select(ids: Set<string>) {
    for (const [id, graphical] of this.graphical) {
      const head = graphical.head;
      if (!head) continue;
      for (const element of [head, ...head.querySelectorAll('path')]) element.setAttribute('fill', ids.has(id) ? '#077a70' : this.originalColors.get(id)!);
    }
  }
  clear() { this.osmd.clear(); this.graphical.clear(); }
  useSharedPageLayout(measures:number) {
    this.osmd.EngravingRules.RenderSingleHorizontalStaffline = false;
    this.osmd.EngravingRules.RenderXMeasuresPerLineAkaSystem = measures;
    this.osmd.EngravingRules.RenderMultipleRestMeasures = false;
    this.osmd.EngravingRules.AutoGenerateMultipleRestMeasuresFromRestMeasures = false;
    this.osmd.EngravingRules.StretchLastSystemLine = true;
  }
  setNativePageHeight(height:number) {
    this.nativeHeight=height;
    (this.osmd.EngravingRules as any).SourceScoreNativeSpacing=true;
    (this.osmd.EngravingRules as any).SourceScoreInstrumentGap=0;
  }
  instrumentSpacing() {
    return this.osmd.GraphicSheet.MusicPages.flatMap(page=>page.MusicSystems.map(system=>({
      gaps:system.StaffLines.slice(1).flatMap((line,i)=>line.ParentStaff.ParentInstrument!==system.StaffLines[i].ParentStaff.ParentInstrument?[line.PositionAndShape.RelativePosition.y-system.StaffLines[i].PositionAndShape.RelativePosition.y-system.StaffLines[i].StaffHeight]:[]),
      staves:system.StaffLines.map(line=>({top:line.PositionAndShape.AbsolutePosition.y,height:line.StaffHeight}))
    })));
  }
  measureTops() {
    return this.osmd.GraphicSheet.MeasureList.map(staves=>{
      const system=staves.find(Boolean)?.ParentMusicSystem;
      return system ? (system.PositionAndShape.AbsolutePosition.y+system.PositionAndShape.BorderTop)*10 : 0;
    });
  }
  measureAlignment() {
    return this.osmd.GraphicSheet.MeasureList.map((staves,index)=>({index,staves:staves.filter(Boolean).map(m=>({x:m.PositionAndShape.AbsolutePosition.x,width:m.PositionAndShape.Size.width}))}));
  }
}
