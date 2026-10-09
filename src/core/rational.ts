/** Exact rational quarter-note time. Never round MusicXML durations. */
export class Rational {
  readonly n: bigint;
  readonly d: bigint;
  constructor(n: bigint | number = 0, d: bigint | number = 1) {
    let a = BigInt(n), b = BigInt(d);
    if (!b) throw new Error('Zero denominator');
    if (b < 0n) { a = -a; b = -b; }
    const gcd = (x: bigint, y: bigint): bigint => y ? gcd(y, x % y) : x;
    const g = gcd(a < 0n ? -a : a, b);
    this.n = a / g; this.d = b / g;
  }
  add(b: Rational) { return new Rational(this.n * b.d + b.n * this.d, this.d * b.d); }
  sub(b: Rational) { return new Rational(this.n * b.d - b.n * this.d, this.d * b.d); }
  mul(b: Rational) { return new Rational(this.n * b.n, this.d * b.d); }
  div(b: Rational) { return new Rational(this.n * b.d, this.d * b.n); }
  static decimal(s: string): Rational | undefined {
    if (s.length > 100 || !/^[+\-]?(\d+(\.\d*)?|\.\d+)$/.test(s)) return;
    const negative = s.startsWith('-'); const parts = s.replace(/^[+\-]/, '').split('.');
    return new Rational(BigInt((parts[0] || '0') + (parts[1] || '')) * (negative ? -1n : 1n), 10n ** BigInt(parts[1]?.length ?? 0));
  }
  compare(b: Rational) { const v = this.n * b.d - b.n * this.d; return v < 0n ? -1 : v > 0n ? 1 : 0; }
  equals(b: Rational) { return this.compare(b) === 0; }
  get positive() { return this.n > 0n; }
  get integer() { return this.d === 1n; }
  valueOf() { return Number(this.n) / Number(this.d); }
  toString() { return this.d === 1n ? String(this.n) : `${this.n}/${this.d}`; }
  wholeNotes() { return this.mul(new Rational(1, 4)).toString(); }
}
export const ZERO = new Rational();
export const NOTE_TYPES = ['whole', 'half', 'quarter', 'eighth', '16th', '32nd', '64th'] as const;
export type NoteType = typeof NOTE_TYPES[number];
export const typeTime: Record<string, Rational> = {
  maxima: new Rational(32), long: new Rational(16), breve: new Rational(8),
  ...Object.fromEntries(NOTE_TYPES.map((type, i) => [type, new Rational(4, 2 ** i)])),
  '128th': new Rational(1, 32), '256th': new Rational(1, 64),
};
export function notatedTime(type: string, dots: number) {
  const base = typeTime[type];
  if (!base || dots < 0 || dots > 4) return undefined;
  return base.mul(new Rational(2 ** (dots + 1) - 1, 2 ** dots));
}
