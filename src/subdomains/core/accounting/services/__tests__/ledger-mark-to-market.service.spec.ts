import { createMock } from '@golevelup/ts-jest';
import { CronExpression } from '@nestjs/schedule';
import { Test, TestingModule } from '@nestjs/testing';
import { SettingService } from 'src/shared/models/setting/setting.service';
import { Process } from 'src/shared/services/process.service';
import { DFX_CRONJOB_PARAMS, DfxCronParams } from 'src/shared/utils/cron';
import { TestUtil } from 'src/shared/utils/test.util';
import { AccountType, LedgerAccount } from '../../entities/ledger-account.entity';
import { createCustomLedgerAccount } from '../../entities/__mocks__/ledger-account.entity.mock';
import { LedgerAccountRepository } from '../../repositories/ledger-account.repository';
import { LedgerLegRepository } from '../../repositories/ledger-leg.repository';
import { LedgerBookingJobService } from '../ledger-booking-job.service';
import { LedgerBookingService, LedgerTxInput } from '../ledger-booking.service';
import { LedgerAccountService } from '../ledger-account.service';
import { LedgerMarkCache, LedgerMarkService } from '../ledger-mark.service';
import { LedgerMarkToMarketService } from '../ledger-mark-to-market.service';

interface LegQueryStub {
  candidateIds?: number[]; // selectCandidates getRawMany
  balance?: { native: string; chf: string }; // accountBalance getRawOne
  alreadyBookedCount?: number; // alreadyBooked getCount
}

describe('LedgerMarkToMarketService', () => {
  let service: LedgerMarkToMarketService;

  let jobService: LedgerBookingJobService;
  let settingService: SettingService;
  let bookingService: LedgerBookingService;
  let accountService: LedgerAccountService;
  let markService: LedgerMarkService;
  let ledgerAccountRepository: LedgerAccountRepository;
  let ledgerLegRepository: LedgerLegRepository;

  let booked: LedgerTxInput[];
  let legStub: LegQueryStub;

  const fxIncome = createCustomLedgerAccount({ id: 80, name: 'INCOME/fx-revaluation', type: AccountType.INCOME });
  const fxExpense = createCustomLedgerAccount({ id: 81, name: 'EXPENSE/fx-revaluation', type: AccountType.EXPENSE });

  function markedAccount(assetId: number): LedgerAccount {
    return createCustomLedgerAccount({
      id: 1000 + assetId,
      name: `Asset/${assetId}`,
      type: AccountType.ASSET,
      assetId,
    });
  }

  // a chainable query-builder stub that resolves its terminal method from legStub by query shape
  function legQb(): any {
    const qb: any = {};
    const chain = () => qb;
    qb.innerJoin = chain;
    qb.select = chain;
    qb.addSelect = chain;
    qb.where = chain;
    qb.andWhere = chain;
    qb.groupBy = chain;
    qb.having = chain;
    qb.orderBy = chain;
    qb.limit = chain;
    qb.getRawMany = () => Promise.resolve((legStub.candidateIds ?? []).map((id) => ({ accountId: id })));
    qb.getRawOne = () => Promise.resolve(legStub.balance ?? { native: '0', chf: '0' });
    qb.getCount = () => Promise.resolve(legStub.alreadyBookedCount ?? 0);
    return qb;
  }

  beforeEach(async () => {
    booked = [];
    legStub = {};

    jobService = createMock<LedgerBookingJobService>();
    settingService = createMock<SettingService>();
    bookingService = createMock<LedgerBookingService>();
    accountService = createMock<LedgerAccountService>();
    markService = createMock<LedgerMarkService>();
    ledgerAccountRepository = createMock<LedgerAccountRepository>();
    ledgerLegRepository = createMock<LedgerLegRepository>();

    jest.spyOn(jobService, 'isLedgerReady').mockResolvedValue(true);
    jest.spyOn(bookingService, 'bookTx').mockImplementation((input: LedgerTxInput) => {
      booked.push(input);
      return Promise.resolve({} as any);
    });
    jest.spyOn(accountService, 'findOrCreate').mockImplementation((name: string) => {
      return Promise.resolve(name === 'INCOME/fx-revaluation' ? fxIncome : fxExpense);
    });
    jest.spyOn(ledgerLegRepository, 'createQueryBuilder').mockImplementation(() => legQb());

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LedgerMarkToMarketService,
        TestUtil.provideConfig(),
        { provide: LedgerBookingJobService, useValue: jobService },
        { provide: SettingService, useValue: settingService },
        { provide: LedgerBookingService, useValue: bookingService },
        { provide: LedgerAccountService, useValue: accountService },
        { provide: LedgerMarkService, useValue: markService },
        { provide: LedgerAccountRepository, useValue: ledgerAccountRepository },
        { provide: LedgerLegRepository, useValue: ledgerLegRepository },
      ],
    }).compile();

    service = module.get<LedgerMarkToMarketService>(LedgerMarkToMarketService);
  });

  it('is defined', () => {
    expect(service).toBeDefined();
  });

  it('runs off-peak at 04:00 with its own LEDGER_MARK_TO_MARKET kill-switch (Hard Constraint #5, §5.3)', () => {
    const params: DfxCronParams = Reflect.getMetadata(DFX_CRONJOB_PARAMS, LedgerMarkToMarketService.prototype.run);
    expect(params.expression).toBe(CronExpression.EVERY_DAY_AT_4AM);
    expect(params.process).toBe(Process.LEDGER_MARK_TO_MARKET);
  });

  it('no-ops while the ledger is not ready (cutover-gate)', async () => {
    jest.spyOn(jobService, 'isLedgerReady').mockResolvedValue(false);

    await service.run();

    expect(bookingService.bookTx).not.toHaveBeenCalled();
  });

  it('books a positive revaluation Dr ASSET / Cr INCOME/fx-revaluation when the mark rises', async () => {
    legStub = { candidateIds: [205], balance: { native: '100', chf: '90' }, alreadyBookedCount: 0 };
    jest.spyOn(ledgerAccountRepository, 'findBy').mockResolvedValue([markedAccount(5)]);
    // mark 1.0 → newChf = 100; oldChf = 90; diff +10
    jest
      .spyOn(markService, 'preload')
      .mockResolvedValue(new LedgerMarkCache(new Map([[5, [{ created: new Date('2026-06-01'), priceChf: 1.0 }]]])));

    await service.run();

    expect(booked).toHaveLength(1);
    const tx = booked[0];
    expect(tx.sourceType).toBe('mark_to_market');
    expect(tx.sourceId).toBe('1005');

    const assetLeg = tx.legs.find((l) => l.account.type === AccountType.ASSET);
    expect(assetLeg.amount).toBe(0); // native unchanged, CHF re-valuation only (§5.3)
    expect(assetLeg.amountChf).toBe(10);

    const fxLeg = tx.legs.find((l) => l.account.name === 'INCOME/fx-revaluation');
    expect(fxLeg.amountChf).toBe(-10); // Σ CHF = 0
  });

  it('books a negative revaluation against EXPENSE/fx-revaluation when the mark falls', async () => {
    legStub = { candidateIds: [205], balance: { native: '100', chf: '120' }, alreadyBookedCount: 0 };
    jest.spyOn(ledgerAccountRepository, 'findBy').mockResolvedValue([markedAccount(5)]);
    jest
      .spyOn(markService, 'preload')
      .mockResolvedValue(new LedgerMarkCache(new Map([[5, [{ created: new Date('2026-06-01'), priceChf: 1.0 }]]])));

    await service.run();

    const fxLeg = booked[0].legs.find((l) => l.account.type === AccountType.EXPENSE);
    expect(fxLeg.account.name).toBe('EXPENSE/fx-revaluation');
    expect(booked[0].legs.find((l) => l.account.type === AccountType.ASSET).amountChf).toBe(-20);
  });

  it('does not book when the account is still feedless (no mark → no phantom revaluation)', async () => {
    legStub = { candidateIds: [205], balance: { native: '100', chf: '0' }, alreadyBookedCount: 0 };
    jest.spyOn(ledgerAccountRepository, 'findBy').mockResolvedValue([markedAccount(5)]);
    jest.spyOn(markService, 'preload').mockResolvedValue(new LedgerMarkCache(new Map())); // no mark for asset 5

    await service.run();

    expect(bookingService.bookTx).not.toHaveBeenCalled();
  });

  it('does not book when the CHF difference is sub-cent', async () => {
    legStub = { candidateIds: [205], balance: { native: '100', chf: '100' }, alreadyBookedCount: 0 };
    jest.spyOn(ledgerAccountRepository, 'findBy').mockResolvedValue([markedAccount(5)]);
    jest
      .spyOn(markService, 'preload')
      .mockResolvedValue(new LedgerMarkCache(new Map([[5, [{ created: new Date('2026-06-01'), priceChf: 1.0 }]]])));

    await service.run();

    expect(bookingService.bookTx).not.toHaveBeenCalled();
  });

  it('is idempotent within the same day (already-booked day → no-op)', async () => {
    legStub = { candidateIds: [205], balance: { native: '100', chf: '90' }, alreadyBookedCount: 1 };
    jest.spyOn(ledgerAccountRepository, 'findBy').mockResolvedValue([markedAccount(5)]);
    jest
      .spyOn(markService, 'preload')
      .mockResolvedValue(new LedgerMarkCache(new Map([[5, [{ created: new Date('2026-06-01'), priceChf: 1.0 }]]])));

    await service.run();

    expect(bookingService.bookTx).not.toHaveBeenCalled();
  });

  it('no-ops when no open accounts qualify', async () => {
    legStub = { candidateIds: [] };

    await service.run();

    expect(markService.preload).not.toHaveBeenCalled();
    expect(bookingService.bookTx).not.toHaveBeenCalled();
  });
});
