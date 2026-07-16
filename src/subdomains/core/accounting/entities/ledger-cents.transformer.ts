import { ValueTransformer } from 'typeorm';

// PostgreSQL bigint is returned by the driver as a string; map it back to a JS number on read and fail LOUD if a
// value ever leaves the safe-integer range instead of silently rounding (a rounded cent amount would corrupt the
// balance gate). Realistic CHF cent sums stay far below 2^53 (~90'000'000'000'000 CHF), so the guard only fires on
// overflow/corruption — a real error, never a valid amount. Lives in this entity-free module so both ledger_leg and
// ledger_tx (which reference each other) can share one transformer without risking an import cycle.
export const chfCentsTransformer: ValueTransformer = {
  to: (value: number): number => value,
  from: (value: string | number | null): number => {
    if (value == null) return value as unknown as number; // NOT NULL columns → never hit in practice
    const cents = Number(value);
    if (!Number.isSafeInteger(cents))
      throw new Error(
        `Ledger CHF cents value "${value}" is outside the JS safe-integer range (±${Number.MAX_SAFE_INTEGER}); refusing to silently round`,
      );
    return cents;
  },
};
