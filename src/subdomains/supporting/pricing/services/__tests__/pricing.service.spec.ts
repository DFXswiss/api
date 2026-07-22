import { createMock } from '@golevelup/ts-jest';
import { ConfigService, Configuration } from 'src/config/config';
import { BinanceService } from 'src/integration/exchange/services/binance.service';
import { KrakenService } from 'src/integration/exchange/services/kraken.service';
import { KucoinService } from 'src/integration/exchange/services/kucoin.service';
import { MexcService } from 'src/integration/exchange/services/mexc.service';
import { ScryptService } from 'src/integration/exchange/services/scrypt.service';
import { XtService } from 'src/integration/exchange/services/xt.service';
import { createCustomAsset } from 'src/shared/models/asset/__mocks__/asset.entity.mock';
import { createCustomFiat } from 'src/shared/models/fiat/__mocks__/fiat.entity.mock';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { NotificationService } from 'src/subdomains/supporting/notification/services/notification.service';
import { PriceInvalidException } from '../../domain/exceptions/price-invalid.exception';
import { PriceUnavailableException } from '../../domain/exceptions/price-unavailable.exception';
import { PriceRuleRepository } from '../../repositories/price-rule.repository';
import { AssetPricesService } from '../asset-prices.service';
import { CoinGeckoService } from '../integration/coin-gecko.service';
import { CurrencyService } from '../integration/currency.service';
import { FixerService } from '../integration/fixer.service';
import { PricingConstantService } from '../integration/pricing-constant.service';
import { PricingDeuroService } from '../integration/pricing-deuro.service';
import { PricingDexService } from '../integration/pricing-dex.service';
import { PricingEbel2xService } from '../integration/pricing-ebel2x.service';
import { PricingFrankencoinService } from '../integration/pricing-frankencoin.service';
import { PricingJuiceService } from '../integration/pricing-juice.service';
import { PricingRealUnitService } from '../integration/pricing-realunit.service';
import { PricingService, PriceValidity } from '../pricing.service';

describe('PricingService', () => {
  let service: PricingService;
  let priceRuleRepo: PriceRuleRepository;

  const from = createCustomAsset({ id: 7, name: 'ETH' });
  const to = createCustomFiat({ id: 3, name: 'CHF' });

  beforeAll(() => {
    new ConfigService(new Configuration());
  });

  beforeEach(() => {
    jest.spyOn(DfxLogger.prototype, 'info').mockImplementation();

    priceRuleRepo = createMock<PriceRuleRepository>();

    // constructed directly: the module graph has an import cycle that breaks Nest DI metadata in specs
    service = new PricingService(
      priceRuleRepo,
      createMock<NotificationService>(),
      createMock<FiatService>(),
      createMock<AssetPricesService>(),
      createMock<KrakenService>(),
      createMock<BinanceService>(),
      createMock<KucoinService>(),
      createMock<MexcService>(),
      createMock<XtService>(),
      createMock<ScryptService>(),
      createMock<CoinGeckoService>(),
      createMock<PricingDexService>(),
      createMock<FixerService>(),
      createMock<CurrencyService>(),
      createMock<PricingFrankencoinService>(),
      createMock<PricingDeuroService>(),
      createMock<PricingJuiceService>(),
      createMock<PricingEbel2xService>(),
      createMock<PricingRealUnitService>(),
      createMock<PricingConstantService>(),
    );
  });

  afterEach(() => jest.restoreAllMocks());

  describe('#getPrice', () => {
    it('wraps a connection-class failure of the price path in PriceUnavailableException with the cause attached', async () => {
      const connectionError = Object.assign(new Error('connect ETIMEDOUT 203.0.113.10:443'), { code: 'ETIMEDOUT' });
      jest.spyOn(priceRuleRepo, 'createQueryBuilder').mockImplementation(() => {
        throw connectionError;
      });

      const error = await service.getPrice(from, to, PriceValidity.ANY).then(
        () => fail('expected getPrice to reject'),
        (e) => e,
      );

      expect(error).toBeInstanceOf(PriceUnavailableException);
      expect(error).toBeInstanceOf(PriceInvalidException);
      expect(error.cause).toBe(connectionError);
    });

    it('wraps a non-connection failure in plain PriceInvalidException', async () => {
      jest.spyOn(priceRuleRepo, 'createQueryBuilder').mockImplementation(() => {
        throw new Error('boom');
      });

      const error = await service.getPrice(from, to, PriceValidity.ANY).then(
        () => fail('expected getPrice to reject'),
        (e) => e,
      );

      expect(error).toBeInstanceOf(PriceInvalidException);
      expect(error).not.toBeInstanceOf(PriceUnavailableException);
    });
  });
});
