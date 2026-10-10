import { MusicSystemBuilder } from 'opensheetmusicdisplay';

/** Native presentation adapter, pinned and regression-tested against OSMD 1.9.9.
 * Runs before final brackets, labels and system connectors are constructed.
 */
export function installNativeSpacing() {
  const prototype = MusicSystemBuilder.prototype as any;
  if (prototype.sourceScoreSpacingInstalled) return;
  const original = prototype.optimizeDistanceBetweenStaffLines;
  prototype.optimizeDistanceBetweenStaffLines = function(system: any) {
    original.call(this, system);
    if (!this.rules.SourceScoreNativeSpacing) return;
    // Keep internal instrument spacing, including linked cross-staff piano writing.
    const lines = system.StaffLines;
    const gaps = lines.slice(1).map((line: any, i: number) => line.PositionAndShape.RelativePosition.y - lines[i].PositionAndShape.RelativePosition.y - lines[i].StaffHeight);
    const boundaries = lines.slice(1).map((line: any, i: number) => line.ParentStaff.ParentInstrument !== lines[i].ParentStaff.ParentInstrument);
    const uniform = Math.max(this.rules.SourceScoreInstrumentGap ?? 0, ...gaps.filter((_: number, i: number) => boundaries[i]));
    let shift = 0;
    for (let i = 1; i < lines.length; i++) {
      if (boundaries[i-1]) shift += uniform - gaps[i-1];
      lines[i].PositionAndShape.RelativePosition.y += shift;
    }
    system.PositionAndShape.BorderBottom += shift;
  };
  prototype.sourceScoreSpacingInstalled = true;
}
