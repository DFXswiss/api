import { SettingService } from 'src/shared/models/setting/setting.service';
import { Config } from 'src/config/config';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { MoreThan, Repository } from 'typeorm';

// per-source checkpoint (§11.3): id-watermark + content-change scan watermark
export interface LedgerWatermark {
  lastProcessedId: number;
  lastReversalScan: Date;
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
  const raw = await settingService.getObj<{ lastProcessedId: number; lastReversalScan: string }>(
    `${WATERMARK_KEY_PREFIX}${source}`,
  );
  if (!raw) return undefined;

  return { lastProcessedId: raw.lastProcessedId, lastReversalScan: new Date(raw.lastReversalScan) };
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
 * This scan selects rows by `updated > lastReversalScan` (independent of id), runs the SAME idempotent forward
 * `book(row)` per row, and advances `lastReversalScan` ONLY after the whole scan committed without error (§4.12 Minor
 * R12-2: a failed booking leaves the watermark unchanged → the row is re-scanned next run, self-healing retry — no
 * correction is ever lost). The booker stays idempotent via its per-seq `alreadyBooked`/`nextSeq` guard, so a row
 * that is both in the forward batch and the content-change scan is booked exactly once.
 */
export async function runContentChangeScan<T extends { id: number; updated: Date }>(
  settingService: SettingService,
  source: string,
  watermark: LedgerWatermark,
  repo: Repository<T>,
  scanRelations: Record<string, unknown>,
  book: (row: T) => Promise<void>,
): Promise<void> {
  const changed = await repo.find({
    where: { updated: MoreThan(watermark.lastReversalScan) } as any,
    relations: scanRelations as any,
    order: { updated: 'ASC', id: 'ASC' } as any,
    take: Config.ledger.backfillBatchSize,
  });
  if (!changed.length) return;

  let scannedThrough = watermark.lastReversalScan;
  for (const row of changed) {
    try {
      await book(row);
      scannedThrough = row.updated; // advance only past rows whose (idempotent) re-book committed
    } catch (e) {
      contentChangeLogger.error(`Content-change scan failed on ${source} ${row.id}`, e);
      // a strict `MoreThan(updated)` advance must NOT skip the failed row when a committed earlier row shares its
      // `updated` timestamp — cap the advance strictly BELOW the failed row's updated so it is re-selected next run
      if (scannedThrough.getTime() >= row.updated.getTime()) {
        scannedThrough = new Date(row.updated.getTime() - 1);
      }
      break; // leave the rest for the next run → self-healing retry (§4.12 Minor R12-2)
    }
  }

  if (scannedThrough.getTime() > watermark.lastReversalScan.getTime()) {
    await setLedgerWatermark(settingService, source, { ...watermark, lastReversalScan: scannedThrough });
  }
}
