import { createMock } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
import { Config } from 'src/config/config';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { TestUtil } from 'src/shared/utils/test.util';
import { Util } from 'src/shared/utils/util';
import { PricingService } from 'src/subdomains/supporting/pricing/services/pricing.service';
import { FindManyOptions, In, MoreThanOrEqual } from 'typeorm';
import { ExchangeTx } from '../../entities/exchange-tx.entity';
import { ExchangeName } from '../../enums/exchange.enum';
import { ExchangeTxRepository } from '../../repositories/exchange-tx.repository';
import { ExchangeRegistryService } from '../exchange-registry.service';
import { ExchangeTxService } from '../exchange-tx.service';

describe('ExchangeTxService', () => {
  let service: ExchangeTxService;

  let exchangeTxRepo: ExchangeTxRepository;

  beforeEach(async () => {
    // Freeze time so the recheck horizon and the buffer arithmetic in getSyncSinceDate are
    // deterministic, and so the FindOperator built in the assertion matches the one the
    // service builds within the same instant.
    jest.useFakeTimers({ now: new Date('2026-05-22T12:00:00Z') });

    exchangeTxRepo = createMock<ExchangeTxRepository>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExchangeTxService,
        { provide: ExchangeTxRepository, useValue: exchangeTxRepo },
        { provide: ExchangeRegistryService, useValue: createMock<ExchangeRegistryService>() },
        { provide: AssetService, useValue: createMock<AssetService>() },
        { provide: PricingService, useValue: createMock<PricingService>() },
        { provide: FiatService, useValue: createMock<FiatService>() },
        TestUtil.provideConfig(),
      ],
    }).compile();

    service = module.get<ExchangeTxService>(ExchangeTxService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('getSyncSinceDate', () => {
    // Returns a fixed findOne result without inspecting the query, so the date-logic tests
    // exercise getSyncSinceDate's arithmetic rather than a re-implemented WHERE clause.
    function mockOldestUnsettled(row: Partial<ExchangeTx> | null): void {
      jest.spyOn(exchangeTxRepo, 'findOne').mockResolvedValue(row as ExchangeTx);
    }

    it('should query the oldest unsettled tx within the recheck horizon', async () => {
      mockOldestUnsettled(null);

      await service['getSyncSinceDate'](ExchangeName.KRAKEN);

      // Assert the actual query the service issues - this is what fails if the fix is reverted.
      const findOneArg = jest.mocked(exchangeTxRepo.findOne).mock.calls[0][0] as FindManyOptions<ExchangeTx>;

      expect(findOneArg.where).toEqual({
        exchange: ExchangeName.KRAKEN,
        status: In(['pending', 'failed']),
        externalCreated: MoreThanOrEqual(Util.daysBefore(Config.exchangeTxSyncRecheckDays)),
      });
      expect(findOneArg.order).toEqual({ externalCreated: 'ASC' });
    });

    it('should widen the since date when an unsettled tx lies within the recheck horizon', async () => {
      const externalCreated = Util.daysBefore(2);
      mockOldestUnsettled({ exchange: ExchangeName.KRAKEN, status: 'failed', externalCreated });

      const since = await service['getSyncSinceDate'](ExchangeName.KRAKEN);

      // Earlier than defaultSince, so the 1-hour-buffered tx date wins.
      expect(since.getTime()).toBe(Util.hoursBefore(1, externalCreated).getTime());
      expect(since.getTime()).toBeLessThan(Util.minutesBefore(Config.exchangeTxSyncLimit).getTime());
    });

    it('should keep the default since date when the buffered tx date is not earlier', async () => {
      // A very recent tx: hoursBefore(1, now) is still later than defaultSince, so defaultSince wins.
      const externalCreated = Util.minutesBefore(5);
      mockOldestUnsettled({ exchange: ExchangeName.KRAKEN, status: 'pending', externalCreated });

      const since = await service['getSyncSinceDate'](ExchangeName.KRAKEN);

      expect(since.getTime()).toBe(Util.minutesBefore(Config.exchangeTxSyncLimit).getTime());
    });

    it('should fall back to the default since date when there are no unsettled txs', async () => {
      mockOldestUnsettled(null);

      const since = await service['getSyncSinceDate'](ExchangeName.KRAKEN);

      expect(since.getTime()).toBe(Util.minutesBefore(Config.exchangeTxSyncLimit).getTime());
    });
  });
});
