import { Config } from 'src/config/config';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Util } from 'src/shared/utils/util';
import { LedgerLegInput } from '../ledger-booking.service';
import { LedgerMarkService } from '../ledger-mark.service';

/**
 * §5.1/§5.2 Major B5 — resolves the needsMark (amountChf == null) asset legs of a to-be-booked tx before the residual
 * plug, so a MIXED tx (needsMark leg + CHF-valued legs) never wedges the whole source at a fixed historical bookingDate.
 *
 * For each unvalued asset-backed leg it bridges the missing historical mark with the youngest available mark
 * (LedgerMarkService.getLatestMark, latest ≤ now) — the leg is then CHF-valued so the tx can balance, but needsMark
 * STAYS true, so the daily mark-to-market job (§5.3) revalues the account to the real rate later. Returns:
 *  - true  → every leg is now CHF-valued → the caller closes the residual with its site-specific fx/spread plug;
 *  - false → an unvalued leg remains but the valued legs already net to ~0 (an all-native transfer) → no plug;
 *  - THROWS → an unvalued (feedless) leg remains on a MIXED, unbalanceable tx: NEVER hand such a set to bookTx (it
 *    would throw the CHF-imbalance programming-error mid-booking, or worse book a wrong value). The row is DEFERRED —
 *    the caller's failure-isolation leaves the watermark and retries; a feedless asset is a genuine data state, not a
 *    price-timing gap (only then is a hard block correct, §fail-closed).
 */
export async function resolveLegsOrDefer(
  legs: LedgerLegInput[],
  markService: LedgerMarkService,
  logger: DfxLogger,
  ref: string,
): Promise<boolean> {
  for (const leg of legs) {
    if (leg.amountChf != null) continue; // already valued (persisted amountChf or a historical mark)
    const assetId = leg.account.assetId;
    const bridge = assetId != null ? await markService.getLatestMark(assetId) : undefined;
    if (bridge == null) continue; // no mark anywhere for this asset (or a CHF-denominated leg) → handled below

    // bridge the missing historical mark: leg.amount is already signed, so amountChf carries the sign. needsMark stays
    // true → the mark-to-market job re-marks the account to the real rate later (the bridge is only a provisional basis).
    leg.priceChf = bridge;
    leg.amountChf = Util.round(bridge * leg.amount, 2);
    leg.needsMark = true;
    logger.warn(
      `${ref}: no mark at the booking date for asset ${assetId} — bridged with the latest available mark ${bridge} ` +
        `(needsMark stays true; the mark-to-market job corrects the basis to the real rate)`,
    );
  }

  if (!legs.some((l) => l.amountChf == null)) return true; // all valued → caller plugs the residual

  // an unvalued (feedless) leg remains. If the valued legs already net to ~0 it is an all-native transfer → no plug.
  const valuedCents = legs.reduce(
    (sum, l) => sum + (l.amountChf != null ? Math.round(Util.round(l.amountChf, 2) * 100) : 0),
    0,
  );
  if (Math.abs(valuedCents) > Config.ledger.roundingToleranceCents) {
    throw new Error(
      `${ref}: an asset leg has no mark in any FinancialDataLog (feedless) and the tx is mixed with CHF-valued legs — ` +
        `deferring (retry once the mark feed has the asset); an unbalanceable leg set is never handed to bookTx`,
    );
  }

  return false; // valued legs balance → all-native transfer, nothing to plug
}
