import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { AccountType } from '../../entities/ledger-account.entity';
import {
  LedgerAccountBalanceDto,
  LedgerAccountsResponseDto,
  LedgerLegEntryDto,
  LedgerLegsResponseDto,
  LedgerPeriodDto,
} from '../ledger-account.dto';
import {
  EquityComparisonDto,
  EquityComparisonPeriodDto,
  EquityDecompositionDto,
  MarginPeriodDto,
  MarginResponseDto,
} from '../ledger-margin.dto';
import {
  LedgerEquityComparisonQuery,
  LedgerLegsQuery,
  LedgerMarginQuery,
  LedgerPeriodQuery,
} from '../ledger-query.dto';
import {
  AccountReconResultDto,
  ReconStatusResponseDto,
  SuspenseLegDto,
  SuspenseResponseDto,
} from '../ledger-reconciliation.dto';

// These response DTOs are pure field carriers; instantiating them executes the class declarations and proves the
// public shape (field names + assignability) the mapper and controller depend on.
// NB: these DTOs must be instantiated with `new` (not a typed object literal) so the runtime class declarations
// actually execute — a type-only annotation is erased and would leave the file uncovered.
describe('ledger account/margin/reconciliation response DTOs', () => {
  it('builds a LedgerAccountsResponseDto with nested balances and period', () => {
    const period = Object.assign(new LedgerPeriodDto(), { from: '2026-01-01', to: '2026-03-31' });
    const balance = Object.assign(new LedgerAccountBalanceDto(), {
      accountId: 5,
      name: 'Scrypt/EUR',
      type: AccountType.ASSET,
      currency: 'EUR',
      balanceNative: 1234.5,
      balanceChf: 1180.25,
      reconStatus: 'ok',
      reconDiff: 0,
      lastVerified: '2026-03-31T05:00:00.000Z',
    });
    const dto = Object.assign(new LedgerAccountsResponseDto(), { period, accounts: [balance] });

    expect(dto).toBeInstanceOf(LedgerAccountsResponseDto);
    expect(dto.period.from).toBe('2026-01-01');
    expect(dto.accounts[0].type).toBe(AccountType.ASSET);
    expect(dto.accounts[0].balanceChf).toBe(1180.25);
  });

  it('builds a LedgerLegsResponseDto with a leg entry', () => {
    const leg = Object.assign(new LedgerLegEntryDto(), {
      legId: 7,
      txId: 10,
      bookingDate: '2026-06-07T00:00:00.000Z',
      valueDate: '2026-06-08T00:00:00.000Z',
      sourceType: 'buy_fiat',
      sourceId: '99001',
      seq: 1,
      counterAccountId: 9,
      counterAccountName: 'LIABILITY/buyFiat-received',
      amountNative: -15000,
      amountChf: -15000,
      priceChf: 1,
    });
    const dto = Object.assign(new LedgerLegsResponseDto(), {
      accountId: 5,
      accountName: 'Scrypt/EUR',
      currency: 'EUR',
      period: Object.assign(new LedgerPeriodDto(), { from: '2026-01-01', to: '2026-03-31' }),
      openingBalance: 0,
      closingBalance: -15000,
      legs: [leg],
      total: 1,
    });

    expect(dto).toBeInstanceOf(LedgerLegsResponseDto);
    expect(dto.legs[0]).toBeInstanceOf(LedgerLegEntryDto);
    expect(dto.legs[0].counterAccountName).toBe('LIABILITY/buyFiat-received');
    expect(dto.closingBalance).toBe(-15000);
    expect(dto.total).toBe(1);
  });

  it('builds a MarginResponseDto with a decomposed period and totals', () => {
    const period = Object.assign(new MarginPeriodDto(), {
      date: '2026-06-07',
      feeIncome: 100,
      executionCosts: 40,
      otherOpex: 10,
      realizedMargin: 60,
      fxPnl: -2,
    });
    const dto = Object.assign(new MarginResponseDto(), {
      periods: [period],
      totalFeeIncome: 100,
      totalExecutionCosts: 40,
      totalOtherOpex: 10,
      totalRealizedMargin: 60,
    });

    expect(dto).toBeInstanceOf(MarginResponseDto);
    expect(dto.periods[0]).toBeInstanceOf(MarginPeriodDto);
    expect(dto.periods[0].realizedMargin).toBe(60);
    expect(dto.totalRealizedMargin).toBe(60);
  });

  it('builds an EquityComparisonDto with a decomposition', () => {
    const decomposition = Object.assign(new EquityDecompositionDto(), {
      transitPhantom: 5,
      staleFeed: 3,
      spreadFees: 2,
      other: 1,
    });
    const period = Object.assign(new EquityComparisonPeriodDto(), {
      date: '2026-06-07',
      journalEquity: 1000,
      financialDataLogTotal: 989,
      difference: 11,
      decomposition,
    });
    const dto = Object.assign(new EquityComparisonDto(), { periods: [period] });

    expect(dto).toBeInstanceOf(EquityComparisonDto);
    expect(dto.periods[0]).toBeInstanceOf(EquityComparisonPeriodDto);
    expect(dto.periods[0].decomposition).toBeInstanceOf(EquityDecompositionDto);
    expect(dto.periods[0].difference).toBe(11);
    expect(dto.periods[0].decomposition?.transitPhantom).toBe(5);
  });

  it('builds a ReconStatusResponseDto with a per-account result', () => {
    const account = Object.assign(new AccountReconResultDto(), {
      accountId: 5,
      accountName: 'Binance/USDT',
      ledgerBalance: 100.5,
      externalFeedBalance: 100,
      difference: 0.5,
      feedTimestamp: '2026-06-10T04:00:00.000Z',
      feedAge: 2,
      staleness: 'fresh',
      status: 'diff',
    });
    const dto = Object.assign(new ReconStatusResponseDto(), {
      runAt: '2026-06-10T05:00:00.000Z',
      accounts: [account],
    });

    expect(dto).toBeInstanceOf(ReconStatusResponseDto);
    expect(dto.accounts[0]).toBeInstanceOf(AccountReconResultDto);
    expect(dto.accounts[0].status).toBe('diff');
    expect(dto.accounts[0].staleness).toBe('fresh');
  });

  it('builds a SuspenseResponseDto with a suspense leg', () => {
    const leg = Object.assign(new SuspenseLegDto(), {
      legId: 2,
      txId: 10,
      bookingDate: '2026-06-07T00:00:00.000Z',
      sourceType: 'bank_tx',
      sourceId: '5000',
      amountNative: 5000,
      amountChf: 4800,
      currency: 'EUR',
      age: 12,
    });
    const dto = Object.assign(new SuspenseResponseDto(), { totalChf: 4800, legs: [leg] });

    expect(dto).toBeInstanceOf(SuspenseResponseDto);
    expect(dto.legs[0]).toBeInstanceOf(SuspenseLegDto);
    expect(dto.totalChf).toBe(4800);
    expect(dto.legs[0].age).toBe(12);
  });
});

// Query DTOs carry class-validator + @Type transforms; exercising plainToInstance + validateSync runs the
// decorator metadata and proves the coercion/validation rules each endpoint relies on.
describe('ledger query DTOs', () => {
  it('coerces from/to to Dates on LedgerPeriodQuery', () => {
    const dto = plainToInstance(LedgerPeriodQuery, {
      from: '2026-01-01T00:00:00.000Z',
      to: '2026-03-31T00:00:00.000Z',
    });

    expect(dto.from).toBeInstanceOf(Date);
    expect(dto.to).toBeInstanceOf(Date);
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('accepts an empty LedgerPeriodQuery (all optional)', () => {
    const dto = plainToInstance(LedgerPeriodQuery, {});

    expect(dto.from).toBeUndefined();
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('rejects a non-date from on LedgerPeriodQuery', () => {
    const dto = plainToInstance(LedgerPeriodQuery, { from: 'not-a-date' });
    const errors = validateSync(dto);

    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('from');
    expect(errors[0].constraints).toHaveProperty('isDate');
  });

  it('coerces from/to to Dates and page to a number on LedgerLegsQuery', () => {
    const dto = plainToInstance(LedgerLegsQuery, {
      from: '2026-01-01T00:00:00.000Z',
      to: '2026-03-31T00:00:00.000Z',
      page: '3',
    });

    expect(dto.from).toBeInstanceOf(Date);
    expect(dto.to).toBeInstanceOf(Date);
    expect(dto.page).toBe(3);
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('rejects a negative page on LedgerLegsQuery', () => {
    const dto = plainToInstance(LedgerLegsQuery, { page: '-1' });
    const errors = validateSync(dto);

    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('page');
    expect(errors[0].constraints).toHaveProperty('min');
  });

  it('coerces from/to and keeps dailySample as a string on LedgerMarginQuery', () => {
    const dto = plainToInstance(LedgerMarginQuery, {
      from: '2026-01-01T00:00:00.000Z',
      to: '2026-03-31T00:00:00.000Z',
      dailySample: 'false',
    });

    expect(dto.from).toBeInstanceOf(Date);
    expect(dto.to).toBeInstanceOf(Date);
    expect(dto.dailySample).toBe('false');
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('rejects a non-string dailySample on LedgerMarginQuery', () => {
    const dto = plainToInstance(LedgerMarginQuery, { dailySample: 5 as unknown as string });
    const errors = validateSync(dto);

    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('dailySample');
    expect(errors[0].constraints).toHaveProperty('isString');
  });

  it('coerces from and keeps dailySample on LedgerEquityComparisonQuery', () => {
    const dto = plainToInstance(LedgerEquityComparisonQuery, {
      from: '2026-01-01T00:00:00.000Z',
      dailySample: 'true',
    });

    expect(dto.from).toBeInstanceOf(Date);
    expect(dto.dailySample).toBe('true');
    expect(validateSync(dto)).toHaveLength(0);
  });
});
