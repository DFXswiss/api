import { Config } from 'src/config/config';
import { SettingService } from 'src/shared/models/setting/setting.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { FindOptionsOrder, FindOptionsRelations, FindOptionsWhere, Raw, Repository } from 'typeorm';

// per-source checkpoint (§11.3): id-watermark + content-change scan cursor.
// The content-change cursor is the COMBINED (updated, id) pair (§4.12): `lastReversalScan` alone cannot paginate
// within one millisecond — when >batchSize rows share a single `updated` (a bulk update of one tx), a timestamp-only
// watermark either drops the rows beyond the batch (advance over the group) or never progresses (cap below the group).
// `lastReversalScanId` is the id of the last row scanned AT `lastReversalScan`, so the next select resumes inside the
// group via `updated > scan OR (updated = scan AND id > scanId)`.
export interface LedgerWatermark {
  lastProcessedId: number;
  lastReversalScan: Date;
  lastReversalScanId?: number; // id within the lastReversalScan group (combined cursor); absent → 0 (group start)
}

const WATERMARK_KEY_PREFIX = 'ledgerWatermark.';

const CUTOVER_BOUNDARY_KEY_PREFIX = 'ledgerCutoverBoundary.';

const CUTOVER_UNPRICED_KEY_PREFIX = 'ledgerCutoverUnpricedIds.';

export interface LedgerCutoverBoundary {
  boundaryId: number; // MAX(id) settled at the snapshot; immutable (the watermark's lastProcessedId drifts, this does not)
  holeIds: number[]; // ids <= boundaryId OPEN at the snapshot (value NOT in the aggregate) → their forward seq0 IS their opening
}

/**
 * Reads the per-source watermark (§11.3). Stored as a JSON string under `ledgerWatermark.<source>` and read
 * via `getObj`. Returns undefined when no watermark exists yet (the cutover initialises it before the gate opens).
 */
export async function getLedgerWatermark(
  settingService: SettingService,
  source: string,
): Promise<LedgerWatermark | undefined> {
  const raw = await settingService.getObj<{
    lastProcessedId: number;
    lastReversalScan: string;
    lastReversalScanId?: number;
  }>(`${WATERMARK_KEY_PREFIX}${source}`);
  if (!raw) return undefined;

  return {
    lastProcessedId: raw.lastProcessedId,
    lastReversalScan: new Date(raw.lastReversalScan),
    lastReversalScanId: raw.lastReversalScanId ?? 0,
  };
}

/**
 * Writes the per-source watermark (§11.3) — exclusively via `settingService.set` (never `setObj`/`settingRepo`;
 * §4.10 R2-exception-a). The watermark is only advanced after a successful batch (§4-header failure-isolation).
 */
export async function setLedgerWatermark(
  settingService: SettingService,
  source: string,
  watermark: LedgerWatermark,
): Promise<void> {
  await settingService.set(
    `${WATERMARK_KEY_PREFIX}${source}`,
    JSON.stringify({
      lastProcessedId: watermark.lastProcessedId,
      lastReversalScan: watermark.lastReversalScan.toISOString(),
      lastReversalScanId: watermark.lastReversalScanId ?? 0,
    }),
  );
}

/**
 * Writes the per-source cutover boundary (§6.3) — exclusively via `settingService.set` (never `setObj`/`settingRepo`;
 * §4.10 R2-exception-a), pinned ONCE, up front in the cutover's watermark-init step (BEFORE any opening is booked),
 * set-only-if-unset together with the watermark: a fail-loud retry reuses the pinned value verbatim and never
 * overwrites it. `boundaryId` is the immutable MAX(id) of rows settled at the snapshot; the watermark's
 * `lastReversalScan`/`lastProcessedId` drift forward as the forward scan advances — this copy does NOT. `holeIds` are
 * the ids ≤ boundaryId that were OPEN at the snapshot: their value is NOT in the aggregate opening (the cutover
 * deliberately excludes the pending bucket), so their forward seq0 IS their opening and must be booked exactly once
 * when they settle post-cutover.
 */
export async function setCutoverBoundary(
  settingService: SettingService,
  source: string,
  boundary: LedgerCutoverBoundary,
): Promise<void> {
  await settingService.set(
    `${CUTOVER_BOUNDARY_KEY_PREFIX}${source}`,
    JSON.stringify({ boundaryId: boundary.boundaryId, holeIds: boundary.holeIds }),
  );
}

/**
 * Reads the per-source cutover boundary (§6.3) — the counterpart to `setCutoverBoundary`, reading the raw setting via
 * `get` (NOT `getObj`) so it returns undefined when unset. Used by the cutover to make the boundary set-only-if-unset:
 * a fail-loud retry reuses the first-run boundary verbatim instead of recomputing it against a drifted DB (where an
 * `updated` bump between runs would flip a settled-at-snapshot row's classification → double-booked forward seq0).
 */
export async function getCutoverBoundary(
  settingService: SettingService,
  source: string,
): Promise<LedgerCutoverBoundary | undefined> {
  const raw = await settingService.get(`${CUTOVER_BOUNDARY_KEY_PREFIX}${source}`);
  if (raw == null) return undefined;
  const parsed = JSON.parse(raw) as { boundaryId: number; holeIds: number[] };
  return { boundaryId: parsed.boundaryId, holeIds: parsed.holeIds };
}

/**
 * Cutover-opening membership guard (§6.3): forward-book a row's seq0 IFF its value is NOT already in the cutover
 * aggregate opening. Opening-membership is a fact FIXED at snapshot time; the cutover pins it per source as an
 * immutable boundary (`setCutoverBoundary`) — set-only-if-unset BEFORE any opening on the FIRST cutover run and never
 * overwritten on a retry, which is what makes it immutable — so it can be reconstructed later even for a source with
 * no immutable settlement timestamp (e.g. crypto_input, whose `updated` gets bumped post-cutover — "settled at the
 * snapshot" cannot be re-derived after the fact, so it is persisted at cutover time):
 *  - `boundaryId` = MAX(id) of rows SETTLED at the snapshot (= the watermark's initial `lastProcessedId`; the watermark
 *    drifts forward as the forward scan advances, THIS copy does not).
 *  - `holeIds` = ids ≤ boundaryId that were OPEN (NOT settled) at the snapshot AND created within OPEN_ROW_LOOKBACK_DAYS
 *    — their value is NOT in the aggregate (the cutover deliberately excludes the pending bucket), so their forward
 *    seq0 IS their opening and MUST be booked exactly once when they settle post-cutover.
 * Covered (→ SKIP the fresh forward seq0) iff: the cutover ran AND `id ≤ boundaryId` AND `id ∉ holeIds`. Rows with
 * `id > boundaryId` and recorded holes forward-book normally. HORIZON CAVEAT: a row unsettled at the snapshot but older
 * than OPEN_ROW_LOOKBACK_DAYS is treated as terminal (never recorded as a hole) → it is reported covered and its
 * post-cutover seq0 is suppressed — consistent with the cutover's existing 90-day open-row horizon
 * (OPEN_ROW_LOOKBACK_DAYS, used by openLiabilities), which assumes a >90d-old open row is abandoned and carries no
 * opening.
 * The three early-returns are documented invariant branches, NOT silent fallbacks: a missing boundary means the
 * cutover has not run yet (pre-cutover default — the forward path is the only booker); `id > boundaryId` means the row
 * settled after the snapshot (its value is not in the aggregate → book); the hole check is the exact open-at-snapshot
 * carve-out. Each is a correct branch of the invariant and must be kept.
 */
export async function isCoveredByCutoverOpening(
  settingService: SettingService,
  source: string,
  rowId: number,
): Promise<boolean> {
  const raw = await settingService.getObj<{ boundaryId: number; holeIds: number[] }>(
    `${CUTOVER_BOUNDARY_KEY_PREFIX}${source}`,
  );
  if (!raw) return false; // cutover not run → forward-book normally (pre-cutover default)
  if (rowId > raw.boundaryId) return false; // post-boundary → not in the aggregate → book
  return !raw.holeIds.includes(rowId); // id <= boundary: covered unless it was an open-at-cutover hole
}

/**
 * Writes the per-source unpriced-at-cutover id list (§6.1 F2) — exclusively via `settingService.set` (never
 * `setObj`/`settingRepo`; §4.10 R2-exception-a). A row OPEN at the snapshot whose `amountInChf` was NULL could get NO
 * per-row received/owed/paymentLink opening (the CHF anchor is missing) — its value stays in the aggregate ASSET
 * opening (the input/collateral feed). These ids are pinned so the forward consumer keys on them to SKIP+advance (with
 * an ERROR alarm) instead of wedging on the never-opened received gate, and to suppress the Card seq0 that would
 * otherwise double-book the gross once the row is priced post-cutover. Pinned set-only-if-unset, BEFORE the ready flag.
 */
export async function setCutoverUnpricedIds(
  settingService: SettingService,
  source: string,
  ids: number[],
): Promise<void> {
  await settingService.set(`${CUTOVER_UNPRICED_KEY_PREFIX}${source}`, JSON.stringify(ids));
}

/**
 * Reads the raw per-source unpriced-at-cutover setting (§6.1 F2) via `get` (NOT `getObj`) so it returns undefined when
 * unset — the counterpart the cutover uses to make the pin set-only-if-unset (a fail-loud retry reuses the first-run
 * list verbatim, mirroring `getCutoverBoundary`).
 */
export async function getCutoverUnpricedIdsRaw(
  settingService: SettingService,
  source: string,
): Promise<string | undefined> {
  return (await settingService.get(`${CUTOVER_UNPRICED_KEY_PREFIX}${source}`)) ?? undefined;
}

/**
 * True iff `rowId` was pinned as unpriced at the cutover (§6.1 F2) — its value is in the aggregate ASSET opening, no
 * per-row liability opening exists, so the forward consumer must SKIP+advance (never wedge on the closed received gate)
 * and never (re-)book its Card seq0. Absent list (cutover not run / no unpriced rows) → false (the normal path).
 */
export async function isUnpricedAtCutover(
  settingService: SettingService,
  source: string,
  rowId: number,
): Promise<boolean> {
  const raw = await settingService.getObj<number[]>(`${CUTOVER_UNPRICED_KEY_PREFIX}${source}`);
  return Array.isArray(raw) && raw.includes(rowId);
}

const contentChangeLogger = new DfxLogger('LedgerContentChangeScan');

/**
 * Content-change scan (§4.12 / §6.3 Late-settling-Block). The forward `id > lastProcessedId` watermark misses two
 * row classes whose `id` is already <= lastProcessedId but whose state changes AFTER the cutover/last batch:
 *  - **late-settling cutover-straddling rows** (§6.3): a pre-cutover open buy_fiat/buy_crypto whose settlement is set
 *    post-cutover — its id sits at/below the cutover-initialised watermark, so the forward scan never re-selects it,
 *    yet its (append-only) seq1/2/3 must still be booked once `outputAmount`/`isComplete` are set;
 *  - **content changes** to already-processed rows (the consumer's idempotent booker re-runs and books only the new
 *    seqs / no-ops the existing ones).
 *
 * This scan selects rows past the COMBINED (updated, id) cursor `(lastReversalScan, lastReversalScanId)` — i.e.
 * `updated > scan OR (updated = scan AND id > scanId)` — ordered by (updated ASC, id ASC), runs the SAME idempotent
 * forward `book(row)` per row, and advances the cursor to the last committed row ONLY after a clean run (§4.12 Minor
 * R12-2: a failed booking leaves the cursor at the last good row → the failed row is re-scanned next run, self-healing
 * retry — no correction is ever lost). The booker stays idempotent via its per-seq `alreadyBooked`/`nextSeq` guard, so
 * a row that is both in the forward batch and the content-change scan is booked exactly once.
 *
 * The combined cursor (not `updated`-only) is required to paginate WITHIN one millisecond: if >batchSize rows share a
 * single `updated` (a bulk update of one tx), an `updated`-only watermark would either advance over the group (dropping
 * the same-`updated` rows beyond the batch — their booking permanently lost) or never progress (a full single-`updated`
 * batch could never be passed). Resuming at `(updated, id)` walks the group row-by-row across runs → no row is skipped
 * and progress is guaranteed even when one `updated` group exceeds the batch size.
 */
export async function runContentChangeScan<T extends { id: number; updated: Date }>(
  settingService: SettingService,
  source: string,
  watermark: LedgerWatermark,
  repo: Repository<T>,
  scanRelations: FindOptionsRelations<T>,
  book: (row: T) => Promise<void>,
): Promise<void> {
  const batchSize = Config.ledger.backfillBatchSize;
  const scan = watermark.lastReversalScan;
  const scanId = watermark.lastReversalScanId ?? 0;

  // combined (updated, id) cursor: `updated > scan OR (updated = scan AND id > scanId)`. Expressed via `Raw` so the
  // id-tiebreak lives in the same WHERE the ORM builds. `col` is the fully-aliased `updated` column (e.g.
  // `"ExchangeTx"."updated"`); the `id` reference reuses that alias so it stays unambiguous when relations are joined.
  const changed = await repo.find({
    where: {
      updated: Raw(
        (col) => {
          const idCol = col.replace(/(["`]?)updated\1\s*$/, (_m, q) => `${q}id${q}`);
          return `(${col} > :lcsScan OR (${col} = :lcsScan AND ${idCol} > :lcsScanId))`;
        },
        { lcsScan: scan, lcsScanId: scanId },
      ),
    } as FindOptionsWhere<T>,
    relations: scanRelations,
    order: { updated: 'ASC', id: 'ASC' } as FindOptionsOrder<T>,
    take: batchSize,
  });
  if (!changed.length) return;

  let cursor: { updated: Date; id: number } | undefined;
  for (const row of changed) {
    try {
      await book(row);
      cursor = { updated: row.updated, id: row.id }; // advance only past rows whose (idempotent) re-book committed
    } catch (e) {
      contentChangeLogger.error(`Content-change scan failed on ${source} ${row.id}:`, e);
      break; // leave the failed row + the rest for the next run → self-healing retry (§4.12 Minor R12-2)
    }
  }

  // advance the persisted cursor when at least one row committed and the cursor actually moved past the old position
  if (cursor && (cursor.updated.getTime() > scan.getTime() || cursor.id > scanId)) {
    await setLedgerWatermark(settingService, source, {
      ...watermark,
      lastReversalScan: cursor.updated,
      lastReversalScanId: cursor.id,
    });
  }
}
