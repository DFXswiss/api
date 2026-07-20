import { ValueTransformer } from 'typeorm';

// §2.3 native-first exactness. A native quantity is stored EXACTLY as integer base units of the asset
// (amount × 10^decimals, e.g. satoshi/wei) in a PostgreSQL `numeric` column — the same exact-integer model the CHF
// side already uses (amountChfCents/bigint). numeric is returned by the pg driver as a string; map it to a JS `bigint`
// (arbitrary precision — a JS number could not hold 18-decimal wei) and fail LOUD on a non-integer instead of silently
// truncating. Entity-free (no entity imports) and placed in `shared` so on-chain source entities (crypto_input,
// payout_order) can persist the same exact column without importing the accounting subdomain — avoiding an import cycle.
export const baseUnitsTransformer: ValueTransformer = {
  to: (value: bigint | null | undefined): string | null => (value == null ? null : value.toString()),
  from: (value: string | null): bigint | null => {
    if (value == null) return null;
    if (!/^-?\d+$/.test(value))
      throw new Error(`Base-units value "${value}" is not an integer; refusing to silently truncate`);
    return BigInt(value);
  },
};

// Exact conversion of a native amount (whole units, already ≤8 dp per the ledger's §2.3 prepareLeg convention) to
// integer base units of a `decimals`-decimal asset. String-based so it never overflows JS number's 2^53 (18-decimal
// wei of a large balance is ~10^21) and never amplifies float binary error beyond the 8-dp source precision.
export function toBaseUnits(amount: number, decimals: number): bigint {
  // |amount| ≥ 1e21 makes toFixed emit exponential notation that BigInt() cannot parse; such a magnitude is also
  // beyond a float's exact-integer range (2^53) and far beyond any real asset supply — fail loud with a clear error
  // instead of an opaque BigInt SyntaxError inside the booking transaction.
  if (!Number.isFinite(amount) || Math.abs(amount) >= 1e21)
    throw new Error(`Native amount ${amount} is out of the base-unit conversion domain (|amount| < 1e21)`);

  const p = Math.min(decimals, 8); // amount carries at most 8 native decimals (§2.3)
  const fixed = amount.toFixed(p); // exact decimal string of the ≤8-dp value, e.g. "-0.00010000"
  const negative = fixed.startsWith('-');
  const [intPart, fracPart = ''] = fixed.replace('-', '').split('.');
  const digits = intPart + fracPart.padEnd(p, '0'); // integer count of 10^p units
  const scaled = BigInt(digits) * 10n ** BigInt(Math.max(decimals - p, 0)); // pad to full 10^decimals base units
  return negative ? -scaled : scaled;
}

// EXACT conversion of an already-exact decimal STRING (never a float) to integer base units of a `decimals`-decimal
// asset. Unlike toBaseUnits this preserves FULL on-chain precision (18-dp wei, a 1-wei deposit) because it never
// touches a JS number: the on-chain integer / exact decimal captured at ingestion is scaled purely via string + BigInt.
// The source must carry at most `decimals` fractional digits — more is not representable at the asset's scale, so we
// fail LOUD rather than silently truncate (the caller then falls back to the float path, fail-open). A plain integer
// string (no dot) is the trivial 0-fraction case; a leading `-` is honoured (with `-0` normalised to 0n).
export function fromDecimalString(value: string, decimals: number): bigint {
  if (!Number.isInteger(decimals) || decimals < 0) throw new Error(`Invalid base-unit decimals ${decimals}`);
  if (!/^-?\d+(\.\d+)?$/.test(value)) throw new Error(`Base-units source "${value}" is not a decimal number`);

  const negative = value.startsWith('-');
  const [intPart, fracPart = ''] = value.replace('-', '').split('.');
  if (fracPart.length > decimals)
    throw new Error(`Decimal "${value}" has more than ${decimals} fractional digits — not exact at the asset scale`);

  const scaled = BigInt(intPart + fracPart.padEnd(decimals, '0')); // integer count of 10^decimals base units
  return negative && scaled !== 0n ? -scaled : scaled;
}

// EXACT inverse of fromDecimalString: renders an integer base-unit quantity (wei/satoshi/piconero) as the exact
// whole-unit decimal STRING, purely via string + BigInt (never a JS number, so it cannot amplify float error). Used by
// the non-EVM ingestion paths (Monero piconero, Zano atomic units) that expose the on-chain amount at the chain's OWN
// native scale (decimals): render it here, then re-scale to the DFX asset scale via fromDecimalString — decoupling the
// two scales and failing open (loud) at that step when the asset cannot represent the value. Trailing zeros are trimmed
// so a value that IS representable at a coarser asset scale still round-trips (e.g. 1.500000000000 → "1.5" → 8-dp ok).
export function fromBaseUnits(value: bigint, decimals: number): string {
  if (!Number.isInteger(decimals) || decimals < 0) throw new Error(`Invalid base-unit decimals ${decimals}`);

  const negative = value < 0n;
  const digits = (negative ? -value : value).toString();

  let intPart: string;
  let fracPart: string;
  if (decimals === 0) {
    intPart = digits;
    fracPart = '';
  } else {
    const padded = digits.padStart(decimals + 1, '0'); // guarantee at least one integer digit + `decimals` fraction digits
    intPart = padded.slice(0, padded.length - decimals);
    fracPart = padded.slice(padded.length - decimals).replace(/0+$/, ''); // trim trailing zeros (keeps coarser scales exact)
  }

  const sign = negative && (intPart !== '0' || fracPart !== '') ? '-' : ''; // never emit "-0"
  return fracPart ? `${sign}${intPart}.${fracPart}` : `${sign}${intPart}`;
}
