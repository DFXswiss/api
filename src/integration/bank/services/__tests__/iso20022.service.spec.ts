import { Iso20022Service } from '../iso20022.service';

describe('Iso20022Service camt.053 references', () => {
  const entry = {
    Amt: { Value: 1.25, Ccy: 'EUR' },
    CdtDbtInd: 'CRDT',
    BookgDt: { Dt: '2026-07-01' },
    ValDt: { Dt: '2026-07-01' },
    NtryDtls: {
      TxDtls: {
        RltdPties: {
          Dbtr: { Nm: 'Synthetic Sender' },
          DbtrAcct: { Id: { IBAN: 'SYNTHETIC-SENDER-ACCOUNT' } },
        },
      },
    },
  };

  it('parses singleton statements and entries', () => {
    const result = Iso20022Service.parseCamt053Json(statement(entry), 'SYNTHETIC-ACCOUNT-A');

    expect(result).toHaveLength(1);
    expect(result[0].amount).toBe(1.25);
  });

  it('uses a stable account-scoped hash when bank references are absent', () => {
    const first = Iso20022Service.parseCamt053Json(statement(entry), 'SYNTHETIC-ACCOUNT-A')[0];
    const reorderedEntry = {
      ValDt: entry.ValDt,
      NtryDtls: entry.NtryDtls,
      BookgDt: entry.BookgDt,
      CdtDbtInd: entry.CdtDbtInd,
      Amt: { Ccy: 'EUR', Value: 1.25 },
    };
    const reordered = Iso20022Service.parseCamt053Json(statement(reorderedEntry), 'SYNTHETIC-ACCOUNT-A')[0];
    const otherAccount = Iso20022Service.parseCamt053Json(statement(entry), 'SYNTHETIC-ACCOUNT-B')[0];

    expect(first.accountServiceRef).toMatch(/^CAMT-[a-f0-9]{64}$/);
    expect(reordered.accountServiceRef).toBe(first.accountServiceRef);
    expect(otherAccount.accountServiceRef).not.toBe(first.accountServiceRef);
  });

  it('deterministically distinguishes identical entries without bank references', () => {
    const camt053 = { BkToCstmrStmt: { Stmt: { Ntry: [entry, entry] } } };

    const firstParse = Iso20022Service.parseCamt053Json(camt053, 'SYNTHETIC-ACCOUNT-A');
    const secondParse = Iso20022Service.parseCamt053Json(camt053, 'SYNTHETIC-ACCOUNT-A');

    expect(firstParse).toHaveLength(2);
    expect(firstParse[0].accountServiceRef).not.toBe(firstParse[1].accountServiceRef);
    expect(firstParse.map(({ accountServiceRef }) => accountServiceRef)).toEqual(
      secondParse.map(({ accountServiceRef }) => accountServiceRef),
    );
  });

  it('throws on malformed entries in strict mode so a poller cannot advance past dropped data', () => {
    const malformedEntry = { ...entry, CdtDbtInd: undefined };

    expect(Iso20022Service.parseCamt053Json(statement(malformedEntry), 'SYNTHETIC-ACCOUNT-A')).toEqual([]);
    expect(() => Iso20022Service.parseCamt053Json(statement(malformedEntry), 'SYNTHETIC-ACCOUNT-A', true)).toThrow(
      'Missing CdtDbtInd',
    );
  });

  it('does not consume an occurrence suffix when a non-strict entry is discarded', () => {
    let indicatorReads = 0;
    const transientlyMalformedEntry = { ...entry };
    Object.defineProperty(transientlyMalformedEntry, 'CdtDbtInd', {
      enumerable: true,
      get: () => (++indicatorReads === 2 ? undefined : 'CRDT'),
    });

    const result = Iso20022Service.parseCamt053Json(
      { BkToCstmrStmt: { Stmt: { Ntry: [transientlyMalformedEntry, transientlyMalformedEntry] } } },
      'SYNTHETIC-ACCOUNT-A',
    );

    expect(result).toHaveLength(1);
    expect(result[0].accountServiceRef).toMatch(/^CAMT-[a-f0-9]{64}$/);
  });

  it.each([
    [{ ...entry, Amt: undefined }, 'Invalid amount'],
    [{ ...entry, Amt: { Value: 1.25, Ccy: 'EU' } }, 'Invalid currency'],
    [{ ...entry, CdtDbtInd: 'UNKNOWN' }, 'Invalid CdtDbtInd'],
    [{ ...entry, BookgDt: { Dt: '2026-02-31' } }, 'Invalid booking date'],
    [{ ...entry, ValDt: { Dt: '2026-02-31' } }, 'Invalid value date'],
  ])('rejects unsafe CAMT defaults in strict mode', (malformedEntry, expectedError) => {
    expect(() => Iso20022Service.parseCamt053Json(statement(malformedEntry), 'SYNTHETIC-ACCOUNT-A', true)).toThrow(
      expectedError,
    );
  });

  function statement(transactionEntry: object) {
    return { BkToCstmrStmt: { Stmt: { Ntry: transactionEntry } } };
  }
});
