import type { NoteType } from '../core/rational';
/** Small code-native notation icons; no dependency on supplementary Unicode font coverage. */
export default function DurationIcon({ type, size = 25 }: { type: NoteType; size?: number }) {
  const flags = ({ eighth: 1, '16th': 2, '32nd': 3, '64th': 4 } as Partial<Record<NoteType, number>>)[type] ?? 0;
  return <svg width={size} height={size} viewBox="0 0 28 32" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
    <ellipse cx={type === 'whole' ? 14 : 10} cy={type === 'whole' ? 20 : 25} rx={type === 'whole' ? 6.4 : 5.2} ry={3.4} transform={`rotate(-18 ${type === 'whole' ? 14 : 10} ${type === 'whole' ? 20 : 25})`} fill={type === 'whole' || type === 'half' ? 'none' : 'currentColor'}/>
    {type !== 'whole' && <path d="M15 24V3"/>}
    {Array.from({ length: flags }, (_, i) => <path key={i} d={`M15 ${3 + i * 4.3}C17 ${7 + i * 4.3} 23 ${8 + i * 4.3} 21 ${13 + i * 4.3}`} />)}
  </svg>;
}
