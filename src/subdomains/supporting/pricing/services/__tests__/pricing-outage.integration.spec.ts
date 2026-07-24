import { createMock } from '@golevelup/ts-jest';
import { mock } from 'jest-mock-extended';
import { ConfigService, Configuration } from 'src/config/config';
import { BinanceService } from 'src/integration/exchange/services/binance.service';
import { KrakenService } from 'src/integration/exchange/services/kraken.service';
import { KucoinService } from 'src/integration/exchange/services/kucoin.service';
import { MexcService } from 'src/integration/exchange/services/mexc.service';
import { ScryptService } from 'src/integration/exchange/services/scrypt.service';
import { XtService } from 'src/integration/exchange/services/xt.service';
import { createCustomAsset } from 'src/shared/models/asset/__mocks__/asset.entity.mock';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { createCustomFiat } from 'src/shared/models/fiat/__mocks__/fiat.entity.mock';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { SettingService } from 'src/shared/models/setting/setting.service';
import { DfxLogger, LogLevel } from 'src/shared/services/dfx-logger';
import { UserDataService } from 'src/subdomains/generic/user/models/user-data/user-data.service';
import { WalletService } from 'src/subdomains/generic/user/models/wallet/wallet.service';
import { BankService } from 'src/subdomains/supporting/bank/bank/bank.service';
import { FeeService } from 'src/subdomains/supporting/payment/services/fee.service';
import { BlockchainFeeRepository } from 'src/subdomains/supporting/payment/repositories/blockchain-fee.repository';
import { FeeRepository } from 'src/subdomains/supporting/payment/repositories/fee.repository';
import { PayoutService } from 'src/subdomains/supporting/payout/services/payout.service';
import { NotificationService } from 'src/subdomains/supporting/notification/services/notification.service';
import { PriceRule, PriceSource } from '../../domain/entities/price-rule.entity';
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
import { PricingService, PriceCurrency, PriceValidity } from '../pricing.service';

/**
 * End-to-end outage classification: only the CoinGecko HTTP client is mocked.
 * Real CoinGeckoService -> real PricingService -> real FeeService.
 */
describe('pricing outage integration (CoinGecko client mock only)', () => {
  const feeAsset = createCustomAsset({ id: 398, name: 'ETH' });
  const chf = createCustomFiat({ id: 3, name: 'CHF' });

  const connectFailure = () =>
    Object.assign(new Error('connect ETIMEDOUT 203.0.113.10:443'), { code: 'ETIMEDOUT' });

  const createCoinGeckoRule = (): PriceRule =>
    Object.assign(new PriceRule(), {
      id: 11,
      priceSource: PriceSource.COIN_GECKO,
      priceAsset: 'ethereum',
      priceReference: 'chf',
      priceValiditySeconds: 300,
    });

  let coinGeckoService: CoinGeckoService;
  let pricingService: PricingService;
  let feeService: FeeService;
  let priceRuleRepo: PriceRuleRepository;
  let blockchainFeeRepo: ReturnType<typeof mock<BlockchainFeeRepository>>;
  let payoutService: ReturnType<typeof mock<PayoutService>>;
  let simplePrice: jest.Mock;

  beforeAll(() => {
    new ConfigService(new Configuration());
  });

  beforeEach(() => {
    jest.spyOn(DfxLogger.prototype, 'error').mockImplementation();
    jest.spyOn(DfxLogger.prototype, 'info').mockImplementation();

    // Real CoinGeckoService with only the HTTP client mocked at the lowest boundary
    coinGeckoService = new CoinGeckoService();
    simplePrice = jest.fn().mockRejectedValue(connectFailure());
    (coinGeckoService as any).client = { simplePrice };
    (coinGeckoService as any).currencies = ['usd', 'eur', 'chf', 'btc', 'eth'];

    priceRuleRepo = createMock<PriceRuleRepository>();
    jest.spyOn(priceRuleRepo, 'createQueryBuilder').mockImplementation(
      () =>
        ({
          innerJoin: jest.fn().mockReturnThis(),
          leftJoinAndSelect: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          getOne: jest.fn().mockResolvedValue(createCoinGeckoRule()),
        }) as any,
    );

    pricingService = new PricingService(
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
      createMock<PricingConstantService>(),
    );
    // PriceCurrency.CHF lookup used by calculateBlockchainFeeInChf
    (pricingService as any).fiatMap.set(PriceCurrency.CHF, chf);

    blockchainFeeRepo = mock<BlockchainFeeRepository>();
    payoutService = mock<PayoutService>();
    payoutService.estimateBlockchainFee.mockResolvedValue({ asset: feeAsset, amount: 0.001 });

    feeService = new FeeService(
      mock<FeeRepository>(),
      mock<AssetService>(),
      mock<FiatService>(),
      mock<UserDataService>(),
      mock<SettingService>(),
      mock<WalletService>(),
      blockchainFeeRepo,
      payoutService,
      pricingService,
      mock<BankService>(),
    );
  });

  afterEach(() => jest.restoreAllMocks());

  it('surfaces a CoinGecko connection outage as PriceUnavailableException through FeeService', async () => {
    const error = await (feeService as any)
      .calculateBlockchainFeeInChf(feeAsset, PriceValidity.ANY)
      .then(
        () => fail('expected calculateBlockchainFeeInChf to reject'),
        (e: unknown) => e,
      );

    expect(error).toBeInstanceOf(PriceUnavailableException);

    let foundConnectionError = false;
    for (let cur: unknown = error; cur instanceof Error; cur = cur.cause) {
      if (
        (cur as NodeJS.ErrnoException).code === 'ETIMEDOUT' ||
        (cur.message ?? '').includes('ETIMEDOUT') ||
        (cur.message ?? '').includes('connect ETIMEDOUT')
      ) {
        foundConnectionError = true;
        break;
      }
    }
    expect(foundConnectionError).toBe(true);

    // Bounded retry in CoinGeckoService (2 tries) ran for real
    expect(simplePrice).toHaveBeenCalledTimes(2);
  });

  it('logs a fresh CoinGecko outage at WARN in updateBlockchainFees (no exception injection)', async () => {
    blockchainFeeRepo.find.mockResolvedValue([{ asset: feeAsset, amount: 1, updated: new Date() } as any]);
    const loggerLog = jest.spyOn(DfxLogger.prototype, 'log').mockImplementation();

    await feeService.updateBlockchainFees();

    expect(loggerLog).toHaveBeenCalledWith(
      LogLevel.WARN,
      expect.stringContaining(String(feeAsset.id)),
      expect.any(PriceUnavailableException),
    );
    expect(loggerLog).not.toHaveBeenCalledWith(LogLevel.ERROR, expect.anything(), expect.anything());
    expect(blockchainFeeRepo.save).not.toHaveBeenCalled();
  });
});
