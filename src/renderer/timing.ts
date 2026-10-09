import { Rational } from '../core/rational';
import { ScoreError } from '../core/xml';

/** OSMD reads division quantities with parseInt. Scale only its presentation copy. */
export function rendererTicks(values: string[]): string[] {
  const quantities = values.map(value => Rational.decimal(value.trim()));
  if (quantities.some(value => !value)) throw new ScoreError('A timing field cannot be interpreted exactly for engraving. The original source remains intact.');
  const gcd = (a: bigint, b: bigint): bigint => b ? gcd(b, a % b) : a;
  const denominator = quantities.reduce((lcm, q) => lcm / gcd(lcm, q!.d) * q!.d, 1n);
  const ticks = quantities.map(q => q!.n * (denominator / q!.d));
  const common = ticks.reduce((g, n) => gcd(g, n < 0n ? -n : n), 0n) || 1n;
  const normalized = ticks.map(n => n / common);
  if (normalized.some(n => n > BigInt(Number.MAX_SAFE_INTEGER) || n < -BigInt(Number.MAX_SAFE_INTEGER))) throw new ScoreError('These timing values exceed the engraving engine’s exact integer range. Graphical editing is unavailable for this view; source content is retained.');
  return normalized.map(String);
}
