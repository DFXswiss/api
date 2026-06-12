import { SettingService } from 'src/shared/models/setting/setting.service';

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
