import { SCRYPT_DEPOSIT_NAME_MARKER } from '../fiat-output-job.service';

describe('AddFiatOutputScryptDepositNotifiedDate migration', () => {
  it('adds the column, backfills completed Scrypt LiqManagement rows, and sets lock timeout', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Migration = require('../../../../../migration/1784700000001-AddFiatOutputScryptDepositNotifiedDate');
    const queryRunner = { query: jest.fn().mockResolvedValue(undefined) };

    await new Migration().up(queryRunner);

    const sql = queryRunner.query.mock.calls.map(([statement]) => statement).join('\n');
    expect(sql).toContain('SET LOCAL lock_timeout');
    expect(sql).toContain('ALTER TABLE "fiat_output" ADD "scryptDepositNotifiedDate" TIMESTAMP');
    expect(sql).toContain('2026-07-23 12:00:00');
    expect(sql).toContain(`LIKE '%${SCRYPT_DEPOSIT_NAME_MARKER}%'`);
    expect(sql).toContain(`"type" = 'LiqManagement'`);
    expect(sql).toContain(`"isComplete" = true`);
    expect(sql).toContain(`"scryptDepositNotifiedDate" IS NULL`);
  });

  it('drops the scryptDepositNotifiedDate column on rollback', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Migration = require('../../../../../migration/1784700000001-AddFiatOutputScryptDepositNotifiedDate');
    const queryRunner = { query: jest.fn().mockResolvedValue(undefined) };

    await new Migration().down(queryRunner);

    const sql = queryRunner.query.mock.calls.map(([statement]) => statement).join('\n');
    expect(sql).toContain('DROP COLUMN "scryptDepositNotifiedDate"');
  });
});
