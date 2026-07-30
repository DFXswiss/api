import { createMock } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { CheckStatus } from 'src/subdomains/core/aml/enums/check-status.enum';
import { BuyCrypto } from 'src/subdomains/core/buy-crypto/process/entities/buy-crypto.entity';
import { BuyFiat } from 'src/subdomains/core/sell-crypto/process/buy-fiat.entity';
import { KycLogService } from 'src/subdomains/generic/kyc/services/kyc-log.service';
import { TransactionTypeInternal } from 'src/subdomains/supporting/payment/entities/transaction.entity';
import { TransactionHelper } from 'src/subdomains/supporting/payment/services/transaction-helper';
import { PayInType } from 'src/subdomains/supporting/payin/entities/crypto-input.entity';
import { Crossing, KycFileIdBackfillService } from '../kyc-file-id-backfill.service';
import { UserDataRepository } from '../user-data.repository';
import { User } from '../../user/user.entity';
import { UserService } from '../../user/user.service';

jest.mock('src/config/config', () => ({
  ...jest.requireActual('src/config/config'),
  Config: { tradingLimits: { monthlyDefaultWoKyc: 1000 } },
}));

// Inside the outage window bounded by the service (2026-05-21T14:00:08Z … 2026-07-03T15:47:39Z).
const IN_WINDOW = new Date('2026-06-01T00:00:00Z');
// After #4023 restored assignment, so the live rule had already resumed.
const AFTER_WINDOW = new Date('2026-07-10T00:00:00Z');

/**
 * Covers the predicate that decides which transaction may be *the* crossing.
 *
 * This is deliberately behavioural — each case asserts the returned `Crossing` rather than that a
 * repository was called with a particular WHERE clause. The selection rule previously lived only
 * in that WHERE clause, where a mocked repository bypasses it entirely; it was widened from
 * `amlCheck = PASS` to `amlCheck != FAIL` (the volume rule, which belongs one level down in
 * `getVolumeSince`) and nothing failed. Hence `isEligibleCrossing` as an explicit predicate, and
 * hence these tests.
 */
describe('KycFileIdBackfillService', () => {
  let service: KycFileIdBackfillService;
  let userService: jest.Mocked<UserService>;
  let transactionHelper: jest.Mocked<TransactionHelper>;
  let buyCryptoRepo: { find: jest.Mock };
  let buyFiatRepo: { find: jest.Mock };

  const buyCrypto = (over: Partial<BuyCrypto>): BuyCrypto =>
    Object.assign(new BuyCrypto(), { id: 1, created: IN_WINDOW, amlCheck: CheckStatus.PASS, amountInChf: 0 }, over);

  /** Volume the live rule would have seen, minus the transaction's own contribution. */
  const previousVolume = (chf: number) => transactionHelper.getVolumeSince.mockResolvedValue(chf);

  const computeCrossing = (): Promise<Crossing | null> => service['computeCrossing'](1, 1000);

  beforeEach(async () => {
    buyCryptoRepo = { find: jest.fn().mockResolvedValue([]) };
    buyFiatRepo = { find: jest.fn().mockResolvedValue([]) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        KycFileIdBackfillService,
        { provide: UserDataRepository, useValue: createMock<UserDataRepository>() },
        { provide: getRepositoryToken(BuyCrypto), useValue: buyCryptoRepo },
        { provide: getRepositoryToken(BuyFiat), useValue: buyFiatRepo },
        { provide: UserService, useValue: createMock<UserService>() },
        { provide: TransactionHelper, useValue: createMock<TransactionHelper>() },
        { provide: KycLogService, useValue: createMock<KycLogService>() },
      ],
    }).compile();

    service = module.get(KycFileIdBackfillService);
    userService = module.get(UserService);
    transactionHelper = module.get(TransactionHelper);

    userService.getAllUserDataUsers.mockResolvedValue([Object.assign(new User(), { id: 10 })]);
    previousVolume(0);
  });

  it('does not pick a non-PASS transaction, even above the threshold', async () => {
    // The live assignment sits inside `if (amlCheck === PASS)`, so this crossing was never issued
    // — and per aml-helper, crossing the threshold is itself what can hold a tx at Pending.
    buyCryptoRepo.find.mockResolvedValue([buyCrypto({ id: 1, amlCheck: CheckStatus.PENDING, amountInChf: 4000 })]);

    await expect(computeCrossing()).resolves.toBeNull();
  });

  it('skips a non-PASS transaction and picks the PASS one behind it', async () => {
    buyCryptoRepo.find.mockResolvedValue([
      buyCrypto({ id: 1, amlCheck: CheckStatus.PENDING, amountInChf: 4000 }),
      buyCrypto({ id: 2, amlCheck: CheckStatus.PASS, amountInChf: 200 }),
    ]);
    // The Pending 4000 still counts toward the volume — that is the `!= FAIL` rule, and it lives
    // in getVolumeSince, not in the selection.
    previousVolume(4000);

    await expect(computeCrossing()).resolves.toMatchObject({
      crossingTxId: 2,
      crossingTxType: TransactionTypeInternal.BUY_CRYPTO,
      volumeAtCrossing: 4200,
    });
  });

  it('does not pick a transaction from after the outage window closed', async () => {
    // #4023 had restored assignment by then, so a still-null kycFileId is the live rule declining,
    // not a lost write. Without the ceiling the backfill re-derives current AML state instead.
    buyCryptoRepo.find.mockResolvedValue([
      buyCrypto({ id: 1, created: AFTER_WINDOW, amlCheck: CheckStatus.PASS, amountInChf: 4000 }),
    ]);

    await expect(computeCrossing()).resolves.toBeNull();
  });

  it('does not pick a payment pay-in', async () => {
    buyCryptoRepo.find.mockResolvedValue([
      buyCrypto({ id: 1, amountInChf: 4000, cryptoInput: { txType: PayInType.PAYMENT } as never }),
    ]);

    await expect(computeCrossing()).resolves.toBeNull();
  });

  it('picks the earliest qualifying transaction, not the largest', async () => {
    buyCryptoRepo.find.mockResolvedValue([
      buyCrypto({ id: 1, created: new Date('2026-06-01T00:00:00Z'), amountInChf: 1500 }),
      buyCrypto({ id: 2, created: new Date('2026-06-02T00:00:00Z'), amountInChf: 9000 }),
    ]);

    await expect(computeCrossing()).resolves.toMatchObject({ crossingTxId: 1, crossingDate: IN_WINDOW });
  });

  it('returns null when the volume never exceeds the threshold', async () => {
    buyCryptoRepo.find.mockResolvedValue([buyCrypto({ id: 1, amountInChf: 1000 })]);

    // Strictly greater, matching `last30dVolume > monthlyDefaultWoKyc`.
    await expect(computeCrossing()).resolves.toBeNull();
  });
});
