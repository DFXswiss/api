import { createMock } from '@golevelup/ts-jest';
import { Config } from 'src/config/config';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { TestUtil } from 'src/shared/utils/test.util';
import { Util } from 'src/shared/utils/util';
import { PricingService } from 'src/subdomains/supporting/pricing/services/pricing.service';
import { ExchangeTx } from '../../entities/exchange-tx.entity';
import { ExchangeName } from '../../enums/exchange.enum';
import { ExchangeTxRepository } from '../../repositories/exchange-tx.repository';
import { ExchangeRegistryService } from '../exchange-registry.service';
import { ExchangeTxService } from '../exchange-tx.service';

describe('ExchangeTxService', () => {
  let service: ExchangeTxService;

  let exchangeTxRepo: ExchangeTxRepository;

  beforeEach(() => {
    // Freeze time so the date arithmetic in getSyncSinceDate is deterministic.
    jest.useFakeTimers({ now: new Date('2026-05-22T12:00:00Z') });

    // Populates the Config global with real defaults (incl. exchangeTxSyncRecheckDays).
    TestUtil.provideConfig();

    exchangeTxRepo = createMock<ExchangeTxRepository>();

    service = new ExchangeTxService(
      exchangeTxRepo,
      createMock<ExchangeRegistryService>(),
      createMock<AssetService>(),
      createMock<PricingService>(),
      createMock<FiatService>(),
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('getSyncSinceDate', () => {
    // Mocks findOne so it returns the oldest unsettled tx that satisfies the recheck-horizon
    // filter the service applies (status In ['pending','failed'] AND externalCreated >= horizon).
    function setupRepo(rows: Partial<ExchangeTx>[]): void {
      jest.spyOn(exchangeTxRepo, 'findOne').mockImplementation(async () => {
        const horizon = Util.daysBefore(Config.exchangeTxSyncRecheckDays);

        return (rows
          .filter((row) => row.exchange === ExchangeName.KRAKEN)
          .filter((row) => ['pending', 'failed'].includes(row.status))
          .filter((row) => row.externalCreated >= horizon)
          .sort((a, b) => a.externalCreated.getTime() - b.externalCreated.getTime())[0] ?? null) as ExchangeTx;
      });
    }

    it('should widen the since date when an unsettled tx lies within the recheck horizon', async () => {
      const externalCreated = Util.daysBefore(2);
      setupRepo([{ exchange: ExchangeName.KRAKEN, status: 'failed', externalCreated }]);

      const since = await service['getSyncSinceDate'](ExchangeName.KRAKEN);

      expect(since.getTime()).toBe(Util.hoursBefore(1, externalCreated).getTime());
      expect(since.getTime()).toBeLessThan(Util.minutesBefore(Config.exchangeTxSyncLimit).getTime());
    });

    it('should not widen the since date for an unsettled tx older than the recheck horizon', async () => {
      const externalCreated = Util.daysBefore(Config.exchangeTxSyncRecheckDays + 1);
      setupRepo([{ exchange: ExchangeName.KRAKEN, status: 'pending', externalCreated }]);

      const since = await service['getSyncSinceDate'](ExchangeName.KRAKEN);

      expect(since.getTime()).toBe(Util.minutesBefore(Config.exchangeTxSyncLimit).getTime());
    });

    it('should fall back to the default since date when there are no unsettled txs', async () => {
      setupRepo([{ exchange: ExchangeName.KRAKEN, status: 'ok', externalCreated: Util.daysBefore(2) }]);

      const since = await service['getSyncSinceDate'](ExchangeName.KRAKEN);

      expect(since.getTime()).toBe(Util.minutesBefore(Config.exchangeTxSyncLimit).getTime());
    });
  });
});
