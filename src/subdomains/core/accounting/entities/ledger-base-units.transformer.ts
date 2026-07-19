import { ValueTransformer } from 'typeorm';

// §2.3 native-first exactness (phase 1). The native quantity is additionally stored EXACTLY as integer base units of
// the asset (amount × 10^decimals, e.g. satoshi/wei) in a PostgreSQL `numeric` column — the same exact-integer model
// the CHF side already uses (amountChfCents/bigint). numeric is returned by the pg driver as a string; map it to a JS
// `bigint` (arbitrary precision — a JS number could not hold 18-decimal wei) and fail LOUD on a non-integer instead of
// silently truncating. Entity-free module (like ledger-cents.transformer) to avoid an import cycle between ledger_leg
// and ledger_tx.
export const baseUnitsTransformer: ValueTransformer = {
  to: (value: bigint | null | undefined): string | null => (value == null ? null : value.toString()),
  from: (value: string | null): bigint | null => {
    if (value == null) return null;
    if (!/^-?\d+$/.test(value))
      throw new Error(`Ledger base-units value "${value}" is not an integer; refusing to silently truncate`);
    return BigInt(value);
  },
};

// Exact conversion of a native amount (whole units, already ≤8 dp per prepareLeg's §2.3 convention) to integer base
// units of a `decimals`-decimal asset. String-based so it never overflows JS number's 2^53 (18-decimal wei of a
// large balance is ~10^21) and never amplifies float binary error beyond the 8-dp source precision.
export function toBaseUnits(amount: number, decimals: number): bigint {
  const p = Math.min(decimals, 8); // amount carries at most 8 native decimals (§2.3)
  const fixed = amount.toFixed(p); // exact decimal string of the ≤8-dp value, e.g. "-0.00010000"
  const negative = fixed.startsWith('-');
  const [intPart, fracPart = ''] = fixed.replace('-', '').split('.');
  const digits = intPart + fracPart.padEnd(p, '0'); // integer count of 10^p units
  const scaled = BigInt(digits) * 10n ** BigInt(Math.max(decimals - p, 0)); // pad to full 10^decimals base units
  return negative ? -scaled : scaled;
}
