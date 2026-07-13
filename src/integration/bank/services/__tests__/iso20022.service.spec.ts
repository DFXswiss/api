import { BankTxIndicator } from 'src/subdomains/supporting/bank-tx/bank-tx/entities/bank-tx.entity';
import { CamtStatus, CamtTransaction, Iso20022Service, Pain001Payment } from '../iso20022.service';

describe('Iso20022Service camt.054 parsing', () => {
  it('maps a full CDTN entry with root-level NtryDtls, array TxDtls and a virtual IBAN', () => {
    const camt054 = {
      BkToCstmrDbtCdtNtfctn: {
        Ntfctn: {
          Id: 'SYNTHETIC-NTFCTN-ID',
          Acct: { Id: { IBAN: 'SYNTHETIC-ACCOUNT-IBAN' } },
          Ntry: {
            BookgDt: { Dt: '2026-07-01' },
            ValDt: { Dt: '2026-07-02' },
            Amt: { Value: 100, Ccy: 'EUR' },
            CdtDbtInd: 'CDTN',
            Sts: 'BOOK',
          },
        },
        NtryDtls: {
          TxDtls: [
            {
              Refs: { AcctSvcrRef: 'SYNTHETIC-REF-1', EndToEndId: 'SYNTHETIC-E2E-1' },
              RltdPties: {
                Dbtr: { Nm: 'Synthetic Sender', PstlAdr: { AdrLine: ['Street 1', 'City 1'], Ctry: 'CH' } },
                DbtrAcct: { Id: { IBAN: 'SYNTHETIC-COUNTERPARTY-IBAN' } },
                CdtrAcct: { Id: { IBAN: 'SYNTHETIC-VIRTUAL-IBAN' } },
                UltmtDbtr: { Nm: 'Synthetic Ultimate Sender', PstlAdr: { AdrLine: 'Single Line', Ctry: 'LI' } },
              },
              RltdAgts: { DbtrAgt: { FinInstnId: { BIC: 'SYNTHETICBIC1' } } },
              RmtInf: { Ustrd: ['line one', 'line two'] },
              BkTxCd: { Domn: { Cd: 'PMNT', Fmly: { Cd: 'ICDT', SubFmlyCd: 'ESCT' } } },
            },
          ],
        },
      },
    };

    const result = Iso20022Service.parseCamt054Json(camt054);

    expect(result).toEqual(
      expect.objectContaining({
        accountServiceRef: 'SYNTHETIC-REF-1',
        endToEndId: 'SYNTHETIC-E2E-1',
        amount: 100,
        currency: 'EUR',
        creditDebitIndicator: BankTxIndicator.CREDIT,
        accountIban: 'SYNTHETIC-ACCOUNT-IBAN',
        virtualIban: 'SYNTHETIC-VIRTUAL-IBAN',
        name: 'Synthetic Sender',
        addressLine1: 'Street 1',
        addressLine2: 'City 1',
        country: 'CH',
        iban: 'SYNTHETIC-COUNTERPARTY-IBAN',
        bic: 'SYNTHETICBIC1',
        ultimateName: 'Synthetic Ultimate Sender',
        ultimateAddressLine1: 'Single Line',
        ultimateAddressLine2: undefined,
        ultimateCountry: 'LI',
        remittanceInfo: 'line one line two',
        status: 'BOOK',
        domainCode: 'PMNT',
        familyCode: 'ICDT',
        subFamilyCode: 'ESCT',
      }),
    );
    expect(result.bookingDate).toEqual(new Date('2026-07-01'));
    expect(result.valueDate).toEqual(new Date('2026-07-02'));
  });

  it('maps a DBTN entry with nested NtryDtls fallback, non-array TxDtls, BICFI fallback, structured remittance info and TxId fallback reference', () => {
    const camt054 = {
      BkToCstmrDbtCdtNtfctn: {
        Ntfctn: {
          Id: 'SYNTHETIC-NTFCTN-ID',
          Acct: { Id: { IBAN: 'SYNTHETIC-ACCOUNT-IBAN' } },
          Ntry: {
            Amt: { Value: 50, Ccy: 'CHF' },
            CdtDbtInd: 'DBTN',
            Sts: 'BOOK',
            NtryDtls: {
              TxDtls: {
                Refs: { TxId: 'SYNTHETIC-TX-ID' },
                RltdPties: { Cdtr: { Nm: 'Synthetic Recipient' } },
                RltdAgts: { CdtrAgt: { FinInstnId: { BICFI: 'SYNTHETICBICFI' } } },
                RmtInf: { Strd: 'structured remittance info' },
              },
            },
          },
        },
      },
    };

    const result = Iso20022Service.parseCamt054Json(camt054);

    expect(result).toEqual(
      expect.objectContaining({
        accountServiceRef: 'SYNTHETIC-TX-ID',
        endToEndId: undefined,
        creditDebitIndicator: BankTxIndicator.DEBIT,
        virtualIban: undefined,
        name: 'Synthetic Recipient',
        bic: 'SYNTHETICBICFI',
        ultimateName: undefined,
        remittanceInfo: 'structured remittance info',
        addressLine1: undefined,
        addressLine2: undefined,
        country: undefined,
      }),
    );
    // no BookgDt/ValDt in the fixture: both default to "now"
    expect(result.bookingDate.getTime()).toBeCloseTo(Date.now(), -2);
    expect(result.valueDate).toEqual(result.bookingDate);
  });

  it('does not treat a matching creditor IBAN as a virtual IBAN on a credit entry', () => {
    const camt054 = {
      BkToCstmrDbtCdtNtfctn: {
        Ntfctn: {
          Acct: { Id: { IBAN: 'SYNTHETIC-ACCOUNT-IBAN' } },
          Ntry: { Amt: { Value: 1, Ccy: 'EUR' }, CdtDbtInd: 'CDTN', Sts: 'BOOK' },
          NtryDtls: { TxDtls: { RltdPties: { CdtrAcct: { Id: { IBAN: 'SYNTHETIC-ACCOUNT-IBAN' } } } } },
        },
      },
    };

    const result = Iso20022Service.parseCamt054Json(camt054);

    expect(result.virtualIban).toBeUndefined();
  });

  it('falls back to the notification id when no transaction-level reference and no remittance info are present', () => {
    const camt054 = {
      BkToCstmrDbtCdtNtfctn: {
        Ntfctn: {
          Id: 'SYNTHETIC-FALLBACK-NTFCTN-ID',
          Acct: { Id: { IBAN: 'SYNTHETIC-ACCOUNT-IBAN' } },
          Ntry: { Amt: { Value: 1, Ccy: 'EUR' }, CdtDbtInd: 'CDTN', Sts: 'BOOK' },
        },
      },
    };

    const result = Iso20022Service.parseCamt054Json(camt054);

    expect(result.accountServiceRef).toBe('SYNTHETIC-FALLBACK-NTFCTN-ID');
    expect(result.remittanceInfo).toBeUndefined();
    expect(result.domainCode).toBeUndefined();
  });

  it('joins an unstructured remittance info given as a plain string', () => {
    const camt054 = {
      BkToCstmrDbtCdtNtfctn: {
        Ntfctn: {
          Acct: { Id: { IBAN: 'SYNTHETIC-ACCOUNT-IBAN' } },
          Ntry: {
            Amt: { Value: 1, Ccy: 'EUR' },
            CdtDbtInd: 'CDTN',
            Sts: 'BOOK',
            NtryDtls: { TxDtls: { RmtInf: { Ustrd: 'single string remittance' } } },
          },
        },
      },
    };

    const result = Iso20022Service.parseCamt054Json(camt054);

    expect(result.remittanceInfo).toBe('single string remittance');
  });

  it('falls back to the current date when the booking date does not match the expected format', () => {
    const camt054 = {
      BkToCstmrDbtCdtNtfctn: {
        Ntfctn: {
          Acct: { Id: { IBAN: 'SYNTHETIC-ACCOUNT-IBAN' } },
          Ntry: { BookgDt: { Dt: 'not-a-real-date' }, Amt: { Value: 1, Ccy: 'EUR' }, CdtDbtInd: 'CDTN', Sts: 'BOOK' },
        },
      },
    };

    const result = Iso20022Service.parseCamt054Json(camt054);

    expect(result.bookingDate.getTime()).toBeCloseTo(Date.now(), -2);
  });

  it('throws when the camt.054 notification wrapper is missing', () => {
    expect(() => Iso20022Service.parseCamt054Json({})).toThrow('Invalid camt.054 format: missing Ntfctn');
  });

  it('throws when the camt.054 account IBAN is missing', () => {
    const camt054 = { BkToCstmrDbtCdtNtfctn: { Ntfctn: { Ntry: { CdtDbtInd: 'CDTN' } } } };

    expect(() => Iso20022Service.parseCamt054Json(camt054)).toThrow('Invalid camt.054 format: missing account IBAN');
  });
});

describe('Iso20022Service postal address parsing', () => {
  const baseEntry = {
    Amt: { Value: 1, Ccy: 'EUR' },
    CdtDbtInd: 'CRDT',
    BookgDt: { Dt: '2026-07-01' },
  };

  function withDebtorAddress(postalAddress: object) {
    return {
      BkToCstmrStmt: {
        Stmt: {
          Ntry: {
            ...baseEntry,
            NtryDtls: { TxDtls: { RltdPties: { Dbtr: { Nm: 'Synthetic Sender', PstlAdr: postalAddress } } } },
          },
        },
      },
    };
  }

  it('reads a structured street and town address', () => {
    const [result] = Iso20022Service.parseCamt053Json(
      withDebtorAddress({ StrtNm: 'Synthetic Street', BldgNb: '12', PstCd: '9490', TwnNm: 'Synthetic Town' }),
      'SYNTHETIC-ACCOUNT',
    );

    expect(result.addressLine1).toBe('Synthetic Street 12');
    expect(result.addressLine2).toBe('9490 Synthetic Town');
  });

  it('drops an empty city part from a structured address with only a street name', () => {
    const [result] = Iso20022Service.parseCamt053Json(
      withDebtorAddress({ StrtNm: 'Synthetic Street' }),
      'SYNTHETIC-ACCOUNT',
    );

    expect(result.addressLine1).toBe('Synthetic Street');
    expect(result.addressLine2).toBeUndefined();
  });

  it('drops empty street/city parts from a structured address with only a town name', () => {
    const [result] = Iso20022Service.parseCamt053Json(
      withDebtorAddress({ TwnNm: 'Synthetic Town' }),
      'SYNTHETIC-ACCOUNT',
    );

    expect(result.addressLine1).toBeUndefined();
    expect(result.addressLine2).toBe('Synthetic Town');
  });

  it('returns no address lines when the postal address has neither AdrLine nor structured fields', () => {
    const [result] = Iso20022Service.parseCamt053Json(withDebtorAddress({ Ctry: 'CH' }), 'SYNTHETIC-ACCOUNT');

    expect(result.addressLine1).toBeUndefined();
    expect(result.addressLine2).toBeUndefined();
    expect(result.country).toBe('CH');
  });
});

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

describe('Iso20022Service camt.053 entry field parsing', () => {
  it('maps a full CRDT entry with BIC, remittance array, ultimate party and AcctSvcrRef', () => {
    const camt053 = {
      BkToCstmrStmt: {
        Stmt: {
          Ntry: {
            Amt: { Value: '12.50', Ccy: 'EUR' },
            CdtDbtInd: 'CRDT',
            BookgDt: { Dt: '2026-07-01' },
            ValDt: { Dt: '2026-07-02' },
            NtryDtls: {
              TxDtls: [
                {
                  Refs: { AcctSvcrRef: 'SYNTHETIC-ACCT-SVCR-REF', EndToEndId: 'SYNTHETIC-E2E' },
                  RltdPties: {
                    Dbtr: { Nm: 'Synthetic Sender', PstlAdr: { AdrLine: ['Street 1'], Ctry: 'CH' } },
                    DbtrAcct: { Id: { IBAN: 'SYNTHETIC-DEBTOR-IBAN' } },
                    UltmtDbtr: { Nm: 'Synthetic Ultimate', PstlAdr: { AdrLine: ['Ultimate Street'], Ctry: 'AT' } },
                  },
                  RltdAgts: { DbtrAgt: { FinInstnId: { BIC: 'SYNTHETICBIC2' } } },
                  RmtInf: { Ustrd: ['first', 'second'] },
                  BkTxCd: { Domn: { Cd: 'PMNT', Fmly: { Cd: 'ICDT', SubFmlyCd: 'ESCT' } } },
                },
              ],
            },
          },
        },
      },
    };

    const [result] = Iso20022Service.parseCamt053Json(camt053, 'SYNTHETIC-ACCOUNT-IBAN');

    expect(result).toEqual(
      expect.objectContaining({
        amount: 12.5,
        currency: 'EUR',
        creditDebitIndicator: BankTxIndicator.CREDIT,
        name: 'Synthetic Sender',
        iban: 'SYNTHETIC-DEBTOR-IBAN',
        bic: 'SYNTHETICBIC2',
        addressLine1: 'Street 1',
        country: 'CH',
        ultimateName: 'Synthetic Ultimate',
        ultimateAddressLine1: 'Ultimate Street',
        ultimateCountry: 'AT',
        remittanceInfo: 'first second',
        accountServiceRef: 'SYNTHETIC-ACCT-SVCR-REF',
        endToEndId: 'SYNTHETIC-E2E',
        status: CamtStatus.BOOKED,
        accountIban: 'SYNTHETIC-ACCOUNT-IBAN',
        virtualIban: undefined,
        domainCode: 'PMNT',
        familyCode: 'ICDT',
        subFamilyCode: 'ESCT',
      }),
    );
  });

  it('maps a DBIT entry with BICFI fallback, a single Ustrd string, TxId reference and no ultimate party', () => {
    const camt053 = {
      BkToCstmrStmt: {
        Stmt: {
          Ntry: {
            Amt: { Value: 5, Ccy: 'CHF' },
            CdtDbtInd: 'DBIT',
            BookgDt: { Dt: '2026-07-01' },
            NtryDtls: {
              TxDtls: {
                Refs: { TxId: 'SYNTHETIC-TX-ID' },
                RltdPties: { Cdtr: { Nm: 'Synthetic Creditor' } },
                RltdAgts: { CdtrAgt: { FinInstnId: { BICFI: 'SYNTHETICBICFI2' } } },
                RmtInf: { Ustrd: 'single line remittance' },
              },
            },
          },
        },
      },
    };

    const [result] = Iso20022Service.parseCamt053Json(camt053, 'SYNTHETIC-ACCOUNT-IBAN');

    expect(result).toEqual(
      expect.objectContaining({
        creditDebitIndicator: BankTxIndicator.DEBIT,
        name: 'Synthetic Creditor',
        bic: 'SYNTHETICBICFI2',
        remittanceInfo: 'single line remittance',
        accountServiceRef: 'SYNTHETIC-TX-ID',
        endToEndId: '',
        ultimateName: undefined,
      }),
    );
  });

  it('falls back to entry.AcctSvcrRef, then entry.NtryRef, when transaction-level refs are absent', () => {
    const withEntryAcctSvcrRef = {
      BkToCstmrStmt: {
        Stmt: { Ntry: { Amt: { Value: 1, Ccy: 'EUR' }, CdtDbtInd: 'CRDT', AcctSvcrRef: 'SYNTHETIC-ENTRY-REF' } },
      },
    };
    const withEntryNtryRef = {
      BkToCstmrStmt: {
        Stmt: { Ntry: { Amt: { Value: 1, Ccy: 'EUR' }, CdtDbtInd: 'CRDT', NtryRef: 'SYNTHETIC-NTRY-REF' } },
      },
    };

    expect(Iso20022Service.parseCamt053Json(withEntryAcctSvcrRef, 'SYNTHETIC-ACCOUNT')[0].accountServiceRef).toBe(
      'SYNTHETIC-ENTRY-REF',
    );
    expect(Iso20022Service.parseCamt053Json(withEntryNtryRef, 'SYNTHETIC-ACCOUNT')[0].accountServiceRef).toBe(
      'SYNTHETIC-NTRY-REF',
    );
  });

  it('reads remittance info from AddtlNtryInf when no structured or unstructured RmtInf is present', () => {
    const camt053 = {
      BkToCstmrStmt: {
        Stmt: {
          Ntry: {
            Amt: { Value: 1, Ccy: 'EUR' },
            CdtDbtInd: 'CRDT',
            AddtlNtryInf: 'additional entry information',
          },
        },
      },
    };

    const [result] = Iso20022Service.parseCamt053Json(camt053, 'SYNTHETIC-ACCOUNT');

    expect(result.remittanceInfo).toBe('additional entry information');
  });

  it('reads remittance info from a structured Strd field', () => {
    const camt053 = {
      BkToCstmrStmt: {
        Stmt: {
          Ntry: {
            Amt: { Value: 1, Ccy: 'EUR' },
            CdtDbtInd: 'CRDT',
            NtryDtls: { TxDtls: { RmtInf: { Strd: 'structured entry remittance' } } },
          },
        },
      },
    };

    const [result] = Iso20022Service.parseCamt053Json(camt053, 'SYNTHETIC-ACCOUNT');

    expect(result.remittanceInfo).toBe('structured entry remittance');
  });

  it('reads the first NtryDtls entry when NtryDtls itself is an array', () => {
    const camt053 = {
      BkToCstmrStmt: {
        Stmt: {
          Ntry: {
            Amt: { Value: 1, Ccy: 'EUR' },
            CdtDbtInd: 'CRDT',
            NtryDtls: [{ TxDtls: { RmtInf: { Strd: 'first detail remittance' } } }],
          },
        },
      },
    };

    const [result] = Iso20022Service.parseCamt053Json(camt053, 'SYNTHETIC-ACCOUNT');

    expect(result.remittanceInfo).toBe('first detail remittance');
  });

  it('accepts an unwrapped amount value and defaults currency to CHF', () => {
    const camt053 = { BkToCstmrStmt: { Stmt: { Ntry: { Amt: 42, CdtDbtInd: 'CRDT' } } } };

    const [result] = Iso20022Service.parseCamt053Json(camt053, 'SYNTHETIC-ACCOUNT');

    expect(result.amount).toBe(42);
    expect(result.currency).toBe('CHF');
  });

  it('reads an amount from the #text field', () => {
    const camt053 = { BkToCstmrStmt: { Stmt: { Ntry: { Amt: { '#text': '7.5', Ccy: 'EUR' }, CdtDbtInd: 'CRDT' } } } };

    const [result] = Iso20022Service.parseCamt053Json(camt053, 'SYNTHETIC-ACCOUNT');

    expect(result.amount).toBe(7.5);
  });

  it('returns an empty array when the camt.053 message has no statement', () => {
    expect(Iso20022Service.parseCamt053Json({}, 'SYNTHETIC-ACCOUNT')).toEqual([]);
  });

  it('parses statements and entries provided as arrays and skips statements without entries', () => {
    const camt053 = {
      BkToCstmrStmt: {
        Stmt: [
          { Ntry: undefined },
          {
            Ntry: [
              { Amt: { Value: 1, Ccy: 'EUR' }, CdtDbtInd: 'CRDT' },
              { Amt: { Value: 2, Ccy: 'EUR' }, CdtDbtInd: 'DBIT' },
            ],
          },
        ],
      },
    };

    const result = Iso20022Service.parseCamt053Json(camt053, 'SYNTHETIC-ACCOUNT');

    expect(result).toHaveLength(2);
  });

  it('rejects a strict entry whose booking date is not a well-formed date string', () => {
    const camt053 = {
      BkToCstmrStmt: {
        Stmt: { Ntry: { Amt: { Value: 1, Ccy: 'EUR' }, CdtDbtInd: 'CRDT', BookgDt: { Dt: 'not-a-date' } } },
      },
    };

    expect(() => Iso20022Service.parseCamt053Json(camt053, 'SYNTHETIC-ACCOUNT', true)).toThrow(
      'Invalid booking date in CAMT entry',
    );
  });

  it('skips the value-date check in strict mode when no value date is present', () => {
    const camt053 = {
      BkToCstmrStmt: {
        Stmt: { Ntry: { Amt: { Value: 1, Ccy: 'EUR' }, CdtDbtInd: 'CRDT', BookgDt: { Dt: '2026-07-01' } } },
      },
    };

    const [result] = Iso20022Service.parseCamt053Json(camt053, 'SYNTHETIC-ACCOUNT', true);

    expect(result.valueDate).toEqual(result.bookingDate);
  });

  it('computes a stable default fallback reference when the private entry parser is invoked without one', () => {
    const entry = { Amt: { Value: 1, Ccy: 'EUR' }, CdtDbtInd: 'CRDT' };

    const result: CamtTransaction = (
      Iso20022Service as unknown as Record<string, (...args: unknown[]) => CamtTransaction>
    )['parseCamt053JsonEntry'](entry, 'SYNTHETIC-ACCOUNT');

    expect(result.accountServiceRef).toMatch(/^CAMT-[a-f0-9]{64}$/);
  });
});

describe('Iso20022Service camt.053 XML parsing', () => {
  it('parses a camt.053 XML document into transactions', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Document>
  <BkToCstmrStmt>
    <Stmt>
      <Ntry>
        <Amt Ccy="EUR">99.90</Amt>
        <CdtDbtInd>CRDT</CdtDbtInd>
        <BookgDt><Dt>2026-07-01</Dt></BookgDt>
      </Ntry>
    </Stmt>
  </BkToCstmrStmt>
</Document>`;

    const result = Iso20022Service.parseCamt053Xml(xml, 'SYNTHETIC-ACCOUNT');

    expect(result).toHaveLength(1);
    expect(result[0].amount).toBe(99.9);
    expect(result[0].currency).toBe('EUR');
  });

  it('parses a camt.053 XML document without a Document root element', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<BkToCstmrStmt>
  <Stmt>
    <Ntry>
      <Amt Ccy="CHF">10</Amt>
      <CdtDbtInd>CRDT</CdtDbtInd>
    </Ntry>
  </Stmt>
</BkToCstmrStmt>`;

    const result = Iso20022Service.parseCamt053Xml(xml, 'SYNTHETIC-ACCOUNT');

    expect(result).toHaveLength(1);
    expect(result[0].amount).toBe(10);
  });
});

describe('Iso20022Service pain.001 generation', () => {
  const payment: Pain001Payment = {
    messageId: 'SYNTHETIC-MSG-ID',
    endToEndId: 'SYNTHETIC-E2E-ID',
    amount: 123.45,
    currency: 'EUR',
    debtor: { name: 'Synthetic Debtor', country: 'CH', iban: 'SYNTHETIC-DEBTOR-IBAN', bic: 'SYNTHETICDBIC' },
    creditor: {
      name: 'Synthetic Creditor & Co <Ltd>',
      country: 'LI',
      iban: 'SYNTHETIC-CREDITOR-IBAN',
      bic: 'SYNTHETICCBIC',
      address: 'Synthetic Street',
      houseNumber: '5',
      zip: '9490',
      city: 'Synthetic City',
    },
    remittanceInfo: 'Synthetic remittance note',
    executionDate: new Date('2026-07-15'),
  };

  it('builds a complete pain.001 JSON structure including the optional remittance info', () => {
    const json = Iso20022Service.createPain001Json(payment);

    expect(json.CstmrCdtTrfInitn.GrpHdr).toEqual(
      expect.objectContaining({ MsgId: 'SYNTHETIC-MSG-ID', CtrlSum: 123.45, InitgPty: { Nm: 'Synthetic Debtor' } }),
    );
    const txInfo = json.CstmrCdtTrfInitn.PmtInf[0].CdtTrfTxInf[0];
    expect(txInfo.PmtId).toEqual({ EndToEndId: 'SYNTHETIC-E2E-ID' });
    expect(txInfo.Amt.InstdAmt).toEqual({ Ccy: 'EUR', value: 123.45 });
    expect(txInfo.Cdtr.PstlAdr).toEqual({
      StrtNm: 'Synthetic Street',
      BldgNb: '5',
      PstCd: '9490',
      TwnNm: 'Synthetic City',
      Ctry: 'LI',
    });
    expect(txInfo.CdtrAcct).toEqual({ Id: { IBAN: 'SYNTHETIC-CREDITOR-IBAN' } });
    expect(txInfo.RmtInf).toEqual({ Ustrd: 'Synthetic remittance note' });
  });

  it('omits the optional creditor address fields and remittance info when absent', () => {
    const minimalPayment: Pain001Payment = {
      ...payment,
      creditor: { name: 'Synthetic Minimal Creditor', country: 'LI', iban: 'SYNTHETIC-CREDITOR-IBAN' },
      remittanceInfo: undefined,
    };

    const json = Iso20022Service.createPain001Json(minimalPayment);
    const txInfo = json.CstmrCdtTrfInitn.PmtInf[0].CdtTrfTxInf[0];

    expect(txInfo.Cdtr.PstlAdr).toEqual({ Ctry: 'LI' });
    expect(txInfo).not.toHaveProperty('RmtInf');
  });

  it('builds a complete pain.001 XML document, escaping unsafe characters and including remittance info', () => {
    const xml = Iso20022Service.createPain001Xml(payment);

    expect(xml).toContain('<MsgId>SYNTHETIC-MSG-ID</MsgId>');
    expect(xml).toContain('<Nm>Synthetic Creditor &amp; Co &lt;Ltd&gt;</Nm>');
    expect(xml).toContain('<InstdAmt Ccy="EUR">123.45</InstdAmt>');
    expect(xml).toContain('<ReqdExctnDt>2026-07-15</ReqdExctnDt>');
    expect(xml).toContain('<RmtInf><Ustrd>Synthetic remittance note</Ustrd></RmtInf>');
  });

  it('omits the RmtInf element from the pain.001 XML document when no remittance info is given', () => {
    const xml = Iso20022Service.createPain001Xml({ ...payment, remittanceInfo: undefined });

    expect(xml).not.toContain('<RmtInf>');
  });

  it('defaults the pain.001 execution date to today when none is given', () => {
    const xml = Iso20022Service.createPain001Xml({ ...payment, executionDate: undefined });

    expect(xml).toMatch(/<ReqdExctnDt>\d{4}-\d{2}-\d{2}<\/ReqdExctnDt>/);
  });
});
