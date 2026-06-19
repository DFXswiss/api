import { createMock } from '@golevelup/ts-jest';
import { ConfigService } from 'src/config/config';
import { SettingService } from 'src/shared/models/setting/setting.service';
import { FindOperator, Repository } from 'typeorm';
import { LedgerWatermark, runContentChangeScan } from '../ledger-watermark.helper';

interface Row {
  id: number;
  updated: Date;
}

/**
 * Focused tests for the §4.12 content-change scan watermark — specifically the combined (updated, id) cursor that
 * eliminates the same-`updated` boundary skip (Major design-accounting point 3). The scan pages by (updated, id) so
 * that >batchSize rows sharing one millisecond `updated` are all eventually scanned across runs and never dropped.
 */
describe('runContentChangeScan combined (updated, id) cursor', () => {
  let settingService: SettingService;
  let written: LedgerWatermark[];

  // extracts the combined-cursor params the helper passes via the Raw FindOperator on `updated`
  function cursorOf(where: any): { scan: Date; scanId: number } {
    const op = where.updated as FindOperator<unknown>;
    const params = (op as any)._objectLiteralParameters as { lcsScan: Date; lcsScanId: number };
    return { scan: new Date(params.lcsScan), scanId: params.lcsScanId };
  }

  // a repo whose find() applies the SAME combined-cursor + (updated ASC, id ASC) ordering + take limit a real DB does
  function repoOver(rows: Row[], batchSize: number): Repository<Row> {
    const repo = createMock<Repository<Row>>();
    jest.spyOn(repo, 'find').mockImplementation((opts: any) => {
      const { scan, scanId } = cursorOf(opts.where);
      const matched = rows
        .filter(
          (r) => r.updated.getTime() > scan.getTime() || (r.updated.getTime() === scan.getTime() && r.id > scanId),
        )
        .sort((a, b) => a.updated.getTime() - b.updated.getTime() || a.id - b.id)
        .slice(0, batchSize);
      return Promise.resolve(matched as any);
    });
    return repo;
  }

  beforeEach(() => {
    written = [];
    settingService = createMock<SettingService>();
    jest.spyOn(settingService, 'set').mockImplementation((_key: string, raw: string) => {
      const p = JSON.parse(raw);
      written.push({
        lastProcessedId: p.lastProcessedId,
        lastReversalScan: new Date(p.lastReversalScan),
        lastReversalScanId: p.lastReversalScanId,
      });
      return Promise.resolve();
    });
    process.env.LEDGER_BACKFILL_BATCH_SIZE = '2';
    new ConfigService(); // set the Config singleton with batchSize=2
  });

  afterEach(() => {
    delete process.env.LEDGER_BACKFILL_BATCH_SIZE;
    new ConfigService(); // restore default batchSize
  });

  it('scans EVERY row of a same-`updated` group larger than the batch across runs (no boundary skip)', async () => {
    // 5 rows, ALL sharing ONE millisecond `updated`, batchSize=2 → the group straddles every batch boundary. An
    // `updated`-only watermark would advance to the shared `updated` after batch 1 and PERMANENTLY drop rows 3..5
    // (they share that `updated`). The combined cursor pages by id within the group → all 5 are scanned.
    const t = new Date('2026-06-01T00:00:00.000Z');
    const rows: Row[] = [1, 2, 3, 4, 5].map((id) => ({ id, updated: t }));
    const booked: number[] = [];

    let wm: LedgerWatermark = { lastProcessedId: 0, lastReversalScan: new Date(0), lastReversalScanId: 0 };
    const repo = repoOver(rows, 2);
    for (let run = 0; run < 5; run++) {
      await runContentChangeScan(settingService, 'test', wm, repo, {}, async (r: Row) => {
        booked.push(r.id);
      });
      if (written.length) wm = written[written.length - 1]; // carry the advanced cursor into the next run
    }

    expect([...new Set(booked)].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]); // every row scanned, none skipped
    expect(wm.lastReversalScan.getTime()).toBe(t.getTime()); // cursor at the shared `updated`
    expect(wm.lastReversalScanId).toBe(5); // …with the id-tiebreak at the last row → the group is exhausted
  });

  it('does not re-advance once the whole same-`updated` group is exhausted (idempotent terminal state)', async () => {
    const t = new Date('2026-06-01T00:00:00.000Z');
    const rows: Row[] = [1, 2].map((id) => ({ id, updated: t }));
    const repo = repoOver(rows, 2);
    const wm: LedgerWatermark = { lastProcessedId: 0, lastReversalScan: t, lastReversalScanId: 2 }; // already past both
    const booked: number[] = [];

    await runContentChangeScan(settingService, 'test', wm, repo, {}, async (r: Row) => {
      booked.push(r.id);
    });

    expect(booked).toEqual([]); // nothing left past the cursor
    expect(written).toHaveLength(0); // watermark not touched
  });

  it('holds the cursor at the last good row when a row fails (self-healing retry, §4.12 Minor R12-2)', async () => {
    const t1 = new Date('2026-06-01T00:00:00.000Z');
    const t2 = new Date('2026-06-01T00:00:01.000Z');
    const rows: Row[] = [
      { id: 1, updated: t1 },
      { id: 2, updated: t2 },
    ];
    const repo = repoOver(rows, 2);
    const wm: LedgerWatermark = { lastProcessedId: 0, lastReversalScan: new Date(0), lastReversalScanId: 0 };

    await runContentChangeScan(settingService, 'test', wm, repo, {}, async (r: Row) => {
      if (r.id === 2) throw new Error('boom');
    });

    // row 1 committed → cursor advances to (t1, 1); row 2 failed → NOT advanced past it (re-scanned next run)
    expect(written).toHaveLength(1);
    expect(written[0].lastReversalScan.getTime()).toBe(t1.getTime());
    expect(written[0].lastReversalScanId).toBe(1);
  });
});
