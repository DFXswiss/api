import { createCustomLedgerAccount } from '../../entities/__mocks__/ledger-account.entity.mock';
import { createCustomLedgerLeg } from '../../entities/__mocks__/ledger-leg.entity.mock';
import { AccountType, LedgerAccount } from '../../entities/ledger-account.entity';
import { LedgerLeg } from '../../entities/ledger-leg.entity';
import { LedgerTx } from '../../entities/ledger-tx.entity';
import {
  AccountBalance,
  AccountReconResult,
  AccountReconSnapshot,
  LedgerDtoMapper,
  SuspenseLegRow,
} from '../ledger-dto.mapper';

function tx(custom: Partial<LedgerTx>): LedgerTx {
  return Object.assign(new LedgerTx(), {
    id: 10,
    bookingDate: new Date('2026-06-07T00:00:00.000Z'),
    valueDate: new Date('2026-06-08T00:00:00.000Z'),
    sourceType: 'buy_fiat',
    sourceId: '68310',
    seq: 1,
    ...custom,
  });
}

function leg(custom: Partial<LedgerLeg>, txCustom: Partial<LedgerTx> = {}): LedgerLeg {
  return createCustomLedgerLeg({ id: 1, txId: 10, accountId: 5, amount: 100, tx: tx(txCustom), ...custom });
}

describe('LedgerDtoMapper', () => {
  describe('mapPeriod', () => {
    it('emits ISO strings for from/to', () => {
      const period = LedgerDtoMapper.mapPeriod(
        new Date('2026-06-01T00:00:00.000Z'),
        new Date('2026-06-30T00:00:00.000Z'),
      );
      expect(period).toEqual({ from: '2026-06-01T00:00:00.000Z', to: '2026-06-30T00:00:00.000Z' });
    });
  });

  describe('mapAccountBalance', () => {
    const account = createCustomLedgerAccount({
      id: 5,
      name: 'Scrypt/EUR',
      type: AccountType.ASSET,
      currency: 'EUR',
    });

    it('maps native + chf balances without a recon snapshot', () => {
      const balance: AccountBalance = { account, balanceNative: 1234.5, balanceChf: 1180.25 };

      const dto = LedgerDtoMapper.mapAccountBalance(balance);

      expect(dto).toEqual({
        accountId: 5,
        name: 'Scrypt/EUR',
        type: AccountType.ASSET,
        currency: 'EUR',
        balanceNative: 1234.5,
        balanceChf: 1180.25,
        reconStatus: undefined,
        reconDiff: undefined,
        lastVerified: undefined,
      });
    });

    it('attaches the recon snapshot for an ASSET account', () => {
      const balance: AccountBalance = { account, balanceNative: 1000, balanceChf: 950 };
      const recon: AccountReconSnapshot = {
        reconStatus: 'ok',
        reconDiff: 0.4,
        lastVerified: new Date('2026-06-10T05:00:00.000Z'),
      };

      const dto = LedgerDtoMapper.mapAccountBalance(balance, recon);

      expect(dto.reconStatus).toBe('ok');
      expect(dto.reconDiff).toBe(0.4);
      expect(dto.lastVerified).toBe('2026-06-10T05:00:00.000Z');
    });
  });

  describe('mapLegEntry', () => {
    it('maps a leg with its tx fields and a single counter account', () => {
      const counter: LedgerAccount = createCustomLedgerAccount({ id: 9, name: 'LIABILITY/buyFiat-received' });
      const entry = leg(
        { id: 7, txId: 10, amount: -15000, amountChf: -15000, priceChf: 1 },
        { description: 'fee', reversalOfId: undefined },
      );

      const dto = LedgerDtoMapper.mapLegEntry(entry, entry.tx.bookingDate, entry.tx.valueDate, counter);

      expect(dto.legId).toBe(7);
      expect(dto.txId).toBe(10);
      expect(dto.bookingDate).toBe('2026-06-07T00:00:00.000Z');
      expect(dto.valueDate).toBe('2026-06-08T00:00:00.000Z');
      expect(dto.sourceType).toBe('buy_fiat');
      expect(dto.sourceId).toBe('68310');
      expect(dto.seq).toBe(1);
      expect(dto.counterAccountId).toBe(9);
      expect(dto.counterAccountName).toBe('LIABILITY/buyFiat-received');
      expect(dto.amountNative).toBe(-15000);
      expect(dto.amountChf).toBe(-15000);
      expect(dto.priceChf).toBe(1);
    });

    it('omits the counter account for a multi-leg tx', () => {
      const entry = leg({});
      const dto = LedgerDtoMapper.mapLegEntry(entry, entry.tx.bookingDate, entry.tx.valueDate, undefined);
      expect(dto.counterAccountId).toBeUndefined();
      expect(dto.counterAccountName).toBeUndefined();
    });
  });

  describe('mapReconResult', () => {
    it('maps the full per-account recon result', () => {
      const account = createCustomLedgerAccount({ id: 5, name: 'Binance/USDT', type: AccountType.ASSET });
      const result: AccountReconResult = {
        account,
        ledgerBalance: 100.5,
        externalFeedBalance: 100.0,
        difference: 0.5,
        feedTimestamp: new Date('2026-06-10T04:00:00.000Z'),
        feedAge: 2,
        staleness: 'fresh',
        status: 'diff',
      };

      const dto = LedgerDtoMapper.mapReconResult(result);

      expect(dto).toEqual({
        accountId: 5,
        accountName: 'Binance/USDT',
        ledgerBalance: 100.5,
        externalFeedBalance: 100.0,
        difference: 0.5,
        feedTimestamp: '2026-06-10T04:00:00.000Z',
        feedAge: 2,
        staleness: 'fresh',
        status: 'diff',
      });
    });

    it('leaves feedTimestamp undefined when the feed is missing', () => {
      const account = createCustomLedgerAccount({ id: 5, name: 'Kraken/BTC', type: AccountType.ASSET });
      const dto = LedgerDtoMapper.mapReconResult({
        account,
        ledgerBalance: 1,
        externalFeedBalance: 0,
        difference: 1,
        feedTimestamp: undefined,
        feedAge: undefined,
        staleness: 'missing',
        status: 'unverified',
      });

      expect(dto.feedTimestamp).toBeUndefined();
      expect(dto.feedAge).toBeUndefined();
      expect(dto.staleness).toBe('missing');
    });
  });

  describe('mapSuspenseLeg', () => {
    it('maps a suspense leg with its account currency and age', () => {
      // generic untracked-bank-EUR SUSPENSE account with small, non-calibrated amounts — the mapper test only checks
      // field passthrough, so it must NOT commit the sensitive named-bank↔~600k volume correlation (Minor R12-1).
      const account = createCustomLedgerAccount({
        id: 3,
        name: 'SUSPENSE/untracked-bank-EUR',
        type: AccountType.SUSPENSE,
        currency: 'EUR',
      });
      const entry = leg({ id: 2, amount: 5000, amountChf: 4800, account });
      const row: SuspenseLegRow = { leg: entry, bookingDate: entry.tx.bookingDate, age: 12 };

      const dto = LedgerDtoMapper.mapSuspenseLeg(row);

      expect(dto.legId).toBe(2);
      expect(dto.currency).toBe('EUR');
      expect(dto.amountNative).toBe(5000);
      expect(dto.amountChf).toBe(4800);
      expect(dto.age).toBe(12);
      expect(dto.bookingDate).toBe('2026-06-07T00:00:00.000Z');
    });
  });
});
