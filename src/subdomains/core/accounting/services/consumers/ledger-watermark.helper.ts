import { SettingService } from 'src/shared/models/setting/setting.service';
import { Config } from 'src/config/config';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Raw, Repository } from 'typeorm';

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
 * §4.10 R2-Ausnahme-a). The watermark is only advanced after a successful batch (§4-header failure-isolation).
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
  scanRelations: Record<string, unknown>,
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
    } as any,
    relations: scanRelations as any,
    order: { updated: 'ASC', id: 'ASC' } as any,
    take: batchSize,
  });
  if (!changed.length) return;

  let cursor: { updated: Date; id: number } | undefined;
  for (const row of changed) {
    try {
      await book(row);
      cursor = { updated: row.updated, id: row.id }; // advance only past rows whose (idempotent) re-book committed
    } catch (e) {
      contentChangeLogger.error(`Content-change scan failed on ${source} ${row.id}`, e);
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
