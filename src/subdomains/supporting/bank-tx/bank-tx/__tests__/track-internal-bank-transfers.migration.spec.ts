type TrackingMigration = {
  up(queryRunner: { query: jest.Mock }): Promise<void>;
  down(queryRunner: { query: jest.Mock }): Promise<void>;
};

describe('TrackInternalBankTransfers migration', () => {
  const MigrationClass = jest.requireActual(
    '../../../../../../migration/1785801000000-TrackInternalBankTransfers',
  ) as new () => TrackingMigration;

  it('seeds only the active window while retaining audited and post-cutover classifications', async () => {
    const query = jest.fn().mockResolvedValue([]);

    await new MigrationClass().up({ query });

    const backfillSql = query.mock.calls[1][0] as string;
    expect(query).toHaveBeenNthCalledWith(1, 'ALTER TABLE "bank_tx" ADD "isInternalTransfer" boolean');
    expect(backfillSql).toContain("l.subsystem = 'InternalBankTransferBackfill'");
    expect(backfillSql).toContain('COALESCE(MIN(a."classificationDate"), s."trackingCutover")');
    expect(backfillSql).toContain('bt.created >= c."classificationCutover" - INTERVAL \'21 days\'');
    expect(backfillSql).toContain('bt.created >= c."classificationCutover"');
    expect(backfillSql).toContain('FOR UPDATE OF bt');
    expect(backfillSql).toContain("'InternalBankTransferTrackingBackfill'");
    expect(backfillSql).toContain("'previousIsInternalTransfer', NULL");
    expect(backfillSql).toContain("'nextIsInternalTransfer', true");
    expect(backfillSql).toContain('\'changedAt\', s."trackingCutover"');
    expect(backfillSql).toContain('SET "isInternalTransfer" = true');
    expect(backfillSql.indexOf('INSERT INTO "log"')).toBeLessThan(backfillSql.indexOf('UPDATE "bank_tx"'));
    expect(query).toHaveBeenNthCalledWith(
      3,
      'CREATE INDEX "IDX_66dba7f36cb315d68512b34379" ON "bank_tx" ("type", "isInternalTransfer")',
    );
  });

  it('normalizes both IBANs before accepting a post-cutover transfer', async () => {
    const query = jest.fn().mockResolvedValue([]);

    await new MigrationClass().up({ query });

    const backfillSql = query.mock.calls[1][0] as string;
    expect(backfillSql.match(/\[\^A-Za-z0-9\]/g)).toHaveLength(4);
    expect(backfillSql.match(/upper\(regexp_replace\([^\n]+, '\[\^A-Za-z0-9\]', '', 'g'\)\)/g)).toHaveLength(4);
  });

  it('removes the generated index before dropping the column on rollback', async () => {
    const query = jest.fn().mockResolvedValue([]);

    await new MigrationClass().down({ query });

    expect(query).toHaveBeenNthCalledWith(1, 'DROP INDEX "public"."IDX_66dba7f36cb315d68512b34379"');
    expect(query).toHaveBeenNthCalledWith(2, 'ALTER TABLE "bank_tx" DROP COLUMN "isInternalTransfer"');
  });
});
