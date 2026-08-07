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
import { Price } from '../../domain/entities/price';
import { PriceRule, PriceSource } from '../../domain/entities/price-rule.entity';
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
import { PricingDenarioService } from '../integration/pricing-denario.service';
import { PricingProvider } from '../integration/pricing-provider';
import { PricingRealUnitService } from '../integration/pricing-realunit.service';
import { PricingService, PriceValidity } from '../pricing.service';

describe('PricingService', () => {
  let service: PricingService;
  let priceRuleRepo: PriceRuleRepository;
  let coinGeckoService: CoinGeckoService;
  let denarioService: PricingDenarioService;
  let constantService: PricingConstantService;

  const from = createCustomAsset({ id: 7, name: 'ETH' });
  const to = createCustomFiat({ id: 3, name: 'CHF' });

  const connectionError = () => Object.assign(new Error('connect ETIMEDOUT 203.0.113.10:443'), { code: 'ETIMEDOUT' });

  const createCoinGeckoRule = (id: number): PriceRule =>
    Object.assign(new PriceRule(), {
      id,
      priceSource: PriceSource.COIN_GECKO,
      priceAsset: 'ethereum',
      priceReference: 'chf',
      priceValiditySeconds: 300,
      // leave currentPrice/priceTimestamp unset so shouldUpdate is true and the provider is called
    });

  /** Fresh rule with a valid cached buy price so shouldUpdate is false (no provider call). */
  const createCachedRule = (partial: Partial<PriceRule> & { id: number; priceSource: string }): PriceRule =>
    Object.assign(new PriceRule(), {
      priceAsset: 'asset',
      priceReference: 'usd',
      priceValiditySeconds: 3600,
      currentPrice: 0.5,
      priceTimestamp: new Date(),
      ...partial,
    });

  const mockQueryBuilder = (rule: PriceRule | ((itemId: number) => PriceRule | undefined)) => {
    const qb = {
      innerJoin: jest.fn().mockReturnThis(),
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getOne: jest.fn(),
    };
    if (typeof rule === 'function') {
      qb.where.mockImplementation((_sql: string, params: { id: number }) => {
        qb.getOne.mockResolvedValue(rule(params.id));
        return qb;
      });
    } else {
      qb.getOne.mockResolvedValue(rule);
    }
    return qb as any;
  };

  /** Real getPriceStep so PriceRule.getPrice can build steps without a live provider. */
  const withPriceStep = <T extends PricingProvider>(svc: T): T => {
    svc.getPriceStep = PricingProvider.prototype.getPriceStep.bind(svc);
    return svc;
  };

  beforeAll(() => {
    new ConfigService(new Configuration());
  });

  beforeEach(() => {
    jest.spyOn(DfxLogger.prototype, 'info').mockImplementation();

    priceRuleRepo = createMock<PriceRuleRepository>();
    coinGeckoService = withPriceStep(createMock<CoinGeckoService>());
    denarioService = withPriceStep(createMock<PricingDenarioService>());
    constantService = withPriceStep(createMock<PricingConstantService>());

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
      coinGeckoService,
      createMock<PricingDexService>(),
      createMock<FixerService>(),
      createMock<CurrencyService>(),
      createMock<PricingFrankencoinService>(),
      createMock<PricingDeuroService>(),
      createMock<PricingJuiceService>(),
      createMock<PricingEbel2xService>(),
      createMock<PricingRealUnitService>(),
      denarioService,
      constantService,
    );
  });

  afterEach(() => jest.restoreAllMocks());

  describe('#getPrice', () => {
    it('does not classify a DB/repository connection-class failure as a price outage', async () => {
      const dbConnectionError = connectionError();
      jest.spyOn(priceRuleRepo, 'createQueryBuilder').mockImplementation(() => {
        throw dbConnectionError;
      });

      const error = await service.getPrice(from, to, PriceValidity.ANY).then(
        () => fail('expected getPrice to reject'),
        (e) => e,
      );

      expect(error).toBeInstanceOf(PriceInvalidException);
      expect(error).not.toBeInstanceOf(PriceUnavailableException);
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

    it('classifies a connection-class provider failure as PriceUnavailableException with the cause preserved', async () => {
      const providerError = connectionError();
      jest.spyOn(coinGeckoService, 'getPrice').mockRejectedValue(providerError);
      jest
        .spyOn(priceRuleRepo, 'createQueryBuilder')
        .mockImplementation(() => mockQueryBuilder(createCoinGeckoRule(1)));

      const error = await service.getPrice(from, to, PriceValidity.ANY).then(
        () => fail('expected getPrice to reject'),
        (e) => e,
      );

      expect(error).toBeInstanceOf(PriceUnavailableException);
      expect(error).toBeInstanceOf(PriceInvalidException);

      // Walk the cause chain: getAssetPrice wraps getRulePrice wraps getPriceFrom's PriceUnavailableException
      // which carries the original provider error.
      let foundProviderError = false;
      for (let cur: unknown = error; cur instanceof Error; cur = cur.cause) {
        if (
          cur === providerError ||
          ((cur as NodeJS.ErrnoException).code === 'ETIMEDOUT' && cur.message.includes('ETIMEDOUT'))
        ) {
          foundProviderError = true;
          break;
        }
      }
      expect(foundProviderError).toBe(true);
    });

    it('without sellPriceSource: both directions use currentPrice exactly as today', async () => {
      // Single-rule chains, no reference hop. currentPrice is the Price divisor (convert = amount/price).
      const askDivisor = 1 / 4511.00359;
      const dgc = createCustomAsset({ id: 101, name: 'DGC' });
      const usd = createCustomFiat({ id: 201, name: 'USD' });

      const dgcRule = createCachedRule({
        id: 11,
        priceSource: PriceSource.DENARIO,
        priceAsset: 'DGC',
        priceReference: 'USD',
        currentPrice: askDivisor,
        // no sellPriceSource / currentSellPrice — legacy single-sided rule
      });
      // USD is the terminal reference unit: identity price so the chain does not rescale.
      const usdRule = createCachedRule({
        id: 12,
        priceSource: PriceSource.CONSTANT,
        priceAsset: 'USD',
        priceReference: 'USD',
        currentPrice: 1,
      });

      jest.spyOn(priceRuleRepo, 'createQueryBuilder').mockImplementation(() =>
        mockQueryBuilder((itemId) => {
          if (itemId === dgc.id) return dgcRule;
          if (itemId === usd.id) return usdRule;
          return undefined;
        }),
      );

      // Asset → fiat: from-side preferSell is a no-op without currentSellPrice.
      const sellLike = await service.getPrice(dgc, usd, PriceValidity.ANY);
      expect(Math.abs(sellLike.convert(1) - 4511.00359)).toBeLessThanOrEqual(0.0001);

      // Fiat → asset: to-side uses buy currentPrice, inverted.
      const buyLike = await service.getPrice(usd, dgc, PriceValidity.ANY);
      expect(Math.abs(buyLike.convert(1) - 1 / 4511.00359)).toBeLessThanOrEqual(1e-10);

      // Anti-mutation: a wrong preferSell that invented a sell price would diverge from ask.
      expect(Math.abs(sellLike.convert(1) - 4259.41142)).toBeGreaterThan(0.0001);
    });

    it('with currentSellPrice: from-side uses sell, to-side uses buy; reference hops stay buy', async () => {
      const askDivisor = 1 / 4511.00359;
      const bidDivisor = 1 / 4259.41142;
      // Reference hop: 1 USDT = 1 USD (divisor 1). A wrong hop-to-sell would only show if this differed.
      const hopDivisor = 1;

      const dgc = createCustomAsset({ id: 101, name: 'DGC' });
      const usdt = createCustomAsset({ id: 102, name: 'USDT' });
      const usd = createCustomFiat({ id: 201, name: 'USD' });

      const dgcRule = createCachedRule({
        id: 21,
        priceSource: PriceSource.DENARIO,
        priceAsset: 'DGC',
        priceReference: 'USD',
        currentPrice: askDivisor,
        sellPriceSource: 'Denario:bid',
        currentSellPrice: bidDivisor,
        // First rule of the from-chain: sell side must use currentSellPrice.
        reference: usdt,
      });
      const usdtRule = createCachedRule({
        id: 22,
        priceSource: PriceSource.CONSTANT,
        priceAsset: 'USDT',
        priceReference: 'USD',
        // Reference hop: must keep currentPrice even when the chain is on the sell side.
        currentPrice: hopDivisor,
        sellPriceSource: 'Constant:0.5',
        currentSellPrice: 0.5, // deliberately wrong if used — would break convert(1)
      });
      const usdRule = createCachedRule({
        id: 23,
        priceSource: PriceSource.CONSTANT,
        priceAsset: 'USD',
        priceReference: 'USD',
        currentPrice: 1,
      });

      jest.spyOn(priceRuleRepo, 'createQueryBuilder').mockImplementation(() =>
        mockQueryBuilder((itemId) => {
          if (itemId === dgc.id) return dgcRule;
          if (itemId === usdt.id) return usdtRule;
          if (itemId === usd.id) return usdRule;
          return undefined;
        }),
      );

      // Sell path: DGC → USD. from-chain = [dgcRule(sell), usdtRule(buy hop)].
      const sellPrice = await service.getPrice(dgc, usd, PriceValidity.ANY);
      expect(Math.abs(sellPrice.convert(1) - 4259.41142)).toBeLessThanOrEqual(0.0001);
      // Anti-mutation: must not still be the ask.
      expect(Math.abs(sellPrice.convert(1) - 4511.00359)).toBeGreaterThan(0.0001);
      // Anti-mutation: must not have used the hop's currentSellPrice (0.5).
      expect(Math.abs(sellPrice.convert(1) - 4259.41142 * 2)).toBeGreaterThan(1);

      // Buy path: USD → DGC. to-chain uses buy prices only, then invert.
      const buyPrice = await service.getPrice(usd, dgc, PriceValidity.ANY);
      expect(Math.abs(buyPrice.convert(1) - 1 / 4511.00359)).toBeLessThanOrEqual(1e-10);
      // Anti-mutation: must not invert the bid.
      expect(Math.abs(buyPrice.convert(1) - 1 / 4259.41142)).toBeGreaterThan(1e-8);
    });
  });

  describe('#updatePrices / doUpdatePriceFor', () => {
    it('with sellPriceSource: fetches both sides and saves them with one priceTimestamp', async () => {
      const askDivisor = 1 / 4511.00359;
      const bidDivisor = 1 / 4259.41142;

      const rule = Object.assign(new PriceRule(), {
        id: 31,
        priceSource: PriceSource.DENARIO,
        priceAsset: 'DGC',
        priceReference: 'USD',
        sellPriceSource: 'Denario:bid',
        priceValiditySeconds: 300,
        // no current prices → shouldUpdate true
      });

      jest.spyOn(denarioService, 'getPrice').mockImplementation(async (from, _to, param) => {
        if (param === 'bid') return Price.create(from, 'USD', bidDivisor, true);
        return Price.create(from, 'USD', askDivisor, true);
      });
      jest.spyOn(priceRuleRepo, 'find').mockResolvedValue([rule]);
      jest.spyOn(priceRuleRepo, 'save').mockImplementation(async (r) => r as PriceRule);

      await service.updatePrices();

      expect(denarioService.getPrice).toHaveBeenCalledWith('DGC', 'USD', undefined);
      expect(denarioService.getPrice).toHaveBeenCalledWith('DGC', 'USD', 'bid');
      expect(priceRuleRepo.save).toHaveBeenCalledTimes(1);

      const saved = (priceRuleRepo.save as jest.Mock).mock.calls[0][0] as PriceRule;
      expect(saved.currentPrice).toBeCloseTo(askDivisor, 12);
      expect(saved.currentSellPrice).toBeCloseTo(bidDivisor, 12);
      expect(saved.priceTimestamp).toBeInstanceOf(Date);
    });

    it('with sellPriceSource: leaves the rule untouched when the sell quote fails', async () => {
      const priorTimestamp = new Date('2026-01-01T00:00:00Z');
      const rule = Object.assign(new PriceRule(), {
        id: 32,
        priceSource: PriceSource.DENARIO,
        priceAsset: 'DGC',
        priceReference: 'USD',
        sellPriceSource: 'Denario:bid',
        currentPrice: 0.0002,
        currentSellPrice: 0.00021,
        priceTimestamp: priorTimestamp,
        priceValiditySeconds: 300,
      });
      // Force shouldUpdate so doUpdatePriceFor runs despite a cached price.
      Object.defineProperty(rule, 'shouldUpdate', { get: () => true });

      jest.spyOn(denarioService, 'getPrice').mockImplementation(async (from, _to, param) => {
        if (param === 'bid') return Price.create(from, 'USD', 1 / 4259.41142, false); // invalid sell
        return Price.create(from, 'USD', 1 / 4511.00359, true);
      });
      jest.spyOn(priceRuleRepo, 'find').mockResolvedValue([rule]);
      jest.spyOn(priceRuleRepo, 'save').mockImplementation(async (r) => r as PriceRule);

      await service.updatePrices();

      expect(priceRuleRepo.save).not.toHaveBeenCalled();
      expect(rule.currentPrice).toBe(0.0002);
      expect(rule.currentSellPrice).toBe(0.00021);
      expect(rule.priceTimestamp).toBe(priorTimestamp);
    });

    it('without sellPriceSource: still saves only currentPrice (backward compatible)', async () => {
      const rule = Object.assign(new PriceRule(), {
        id: 33,
        priceSource: PriceSource.COIN_GECKO,
        priceAsset: 'ethereum',
        priceReference: 'chf',
        priceValiditySeconds: 300,
      });

      jest.spyOn(coinGeckoService, 'getPrice').mockResolvedValue(Price.create('ethereum', 'chf', 0.0003, true));
      jest.spyOn(priceRuleRepo, 'find').mockResolvedValue([rule]);
      jest.spyOn(priceRuleRepo, 'save').mockImplementation(async (r) => r as PriceRule);

      await service.updatePrices();

      expect(priceRuleRepo.save).toHaveBeenCalledTimes(1);
      const saved = (priceRuleRepo.save as jest.Mock).mock.calls[0][0] as PriceRule;
      expect(saved.currentPrice).toBe(0.0003);
      expect(saved.currentSellPrice).toBeUndefined();
      expect(saved.priceTimestamp).toBeInstanceOf(Date);
    });
  });
});
