type Migration = {
  up(queryRunner: { query: jest.Mock }): Promise<void>;
  down(queryRunner: { query: jest.Mock }): Promise<void>;
};

describe('ClassifyInternalBankTransfers migration', () => {
  const MigrationClass = jest.requireActual(
    '../../../../../../migration/1785738105000-ClassifyInternalBankTransfers',
  ) as new () => Migration;

  it('audits the exact previous state before updating both transaction records', async () => {
    const query = jest.fn().mockResolvedValue([]);

    await new MigrationClass().up({ query });

    const sql = query.mock.calls[0][0] as string;
    expect(sql).toContain('FOR UPDATE OF bt');
    expect(sql).toContain('FOR UPDATE OF tx');
    expect(sql).toContain('previousBankTxType');
    expect(sql).toContain('previousTransactionType');
    expect(sql).toContain("'InternalBankTransferBackfill'");
    expect(sql).toContain('WHERE bt.id = a."bankTxId" AND EXISTS (SELECT 1 FROM "audit")');
    expect(sql).toContain('AND EXISTS (SELECT 1 FROM "audit")');
    expect(sql.indexOf('INSERT INTO "log"')).toBeLessThan(sql.indexOf('UPDATE bank_tx'));
  });

  it('uses the same non-alphanumeric IBAN normalization as the runtime', async () => {
    const query = jest.fn().mockResolvedValue([]);

    await new MigrationClass().up({ query });

    const sql = query.mock.calls[0][0] as string;
    expect(sql.match(/\[\^A-Za-z0-9\]/g)).toHaveLength(4);
    expect(sql).not.toContain("'\\s'");
    expect(sql.match(/upper\(regexp_replace\([^\n]+, '\[\^A-Za-z0-9\]', '', 'g'\)\)/g)).toHaveLength(4);
    expect(sql).not.toMatch(/regexp_replace\(upper\(/);
  });

  it('does not destructively reverse audited classifications', async () => {
    const query = jest.fn();

    await new MigrationClass().down({ query });

    expect(query).not.toHaveBeenCalled();
  });
});
