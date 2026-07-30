import { createMock } from '@golevelup/ts-jest';
import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as ConfigModule from 'src/config/config';
import { InternetComputerService } from 'src/integration/blockchain/icp/services/icp.service';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { BlockchainRegistryService } from 'src/integration/blockchain/shared/services/blockchain-registry.service';
import { TxValidationService } from 'src/integration/blockchain/shared/services/tx-validation.service';
import { LightningHelper } from 'src/integration/lightning/lightning-helper';
import { createCustomAsset } from 'src/shared/models/asset/__mocks__/asset.entity.mock';
import { AssetType } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { Fiat } from 'src/shared/models/fiat/fiat.entity';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { UserDataService } from 'src/subdomains/generic/user/models/user-data/user-data.service';
import { DepositRouteService } from 'src/subdomains/supporting/address-pool/route/deposit-route.service';
import { Price } from 'src/subdomains/supporting/pricing/domain/entities/price';
import { PricingService } from 'src/subdomains/supporting/pricing/services/pricing.service';
import { PaymentLinkPayment } from '../../entities/payment-link-payment.entity';
import { PaymentLink } from '../../entities/payment-link.entity';
import { PaymentQuote } from '../../entities/payment-quote.entity';
import { PaymentLinkMode, PaymentLinkPaymentStatus, PaymentQuoteStatus, PaymentStandard } from '../../enums';
import { PaymentLinkRepository } from '../../repositories/payment-link.repository';
import { PaymentQuoteRepository } from '../../repositories/payment-quote.repository';
import { C2BPaymentLinkService } from '../c2b-payment-link.service';
import { PaymentBalanceService } from '../payment-balance.service';
import { PaymentLinkFeeService } from '../payment-link-fee.service';
import { PaymentLinkPaymentService } from '../payment-link-payment.service';
import { PaymentLinkService } from '../payment-link.service';
import { PaymentQuoteService } from '../payment-quote.service';

describe('PaymentLinkService - createPayRequest Lightning requirement', () => {
  let service: PaymentLinkService;
  let paymentLinkPaymentService: PaymentLinkPaymentService;
  let paymentQuoteService: PaymentQuoteService;

  beforeEach(async () => {
    paymentLinkPaymentService = createMock<PaymentLinkPaymentService>();
    paymentQuoteService = createMock<PaymentQuoteService>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentLinkService,
        { provide: PaymentLinkRepository, useValue: createMock<PaymentLinkRepository>() },
        { provide: PaymentLinkPaymentService, useValue: paymentLinkPaymentService },
        { provide: PaymentQuoteService, useValue: paymentQuoteService },
        { provide: UserDataService, useValue: createMock<UserDataService>() },
        { provide: DepositRouteService, useValue: createMock<DepositRouteService>() },
        { provide: C2BPaymentLinkService, useValue: createMock<C2BPaymentLinkService>() },
      ],
    }).compile();

    service = module.get(PaymentLinkService);
  });

  afterEach(() => jest.restoreAllMocks());

  function pendingPaymentWithCardanoOnlyLink(): PaymentLinkPayment {
    const link = {
      uniqueId: 'pl_test',
      externalId: undefined,
      mode: PaymentLinkMode.MULTIPLE,
      configObj: {
        standards: [PaymentStandard.OPEN_CRYPTO_PAY],
        displayQr: false,
        recipient: {},
        blockchains: [Blockchain.CARDANO],
      },
      getMatchingStandard: () => PaymentStandard.OPEN_CRYPTO_PAY,
      route: { route: { label: 'test-route' } },
    } as unknown as PaymentLink;

    return Object.assign(new PaymentLinkPayment(), {
      uniqueId: 'plp_test',
      status: PaymentLinkPaymentStatus.PENDING,
      amount: 10,
      currency: { name: 'CHF' },
      link,
    });
  }

  function quoteFromTransferAmountsJson(transferAmountsJson: string): PaymentQuote {
    return Object.assign(new PaymentQuote(), {
      uniqueId: 'pq_test',
      status: PaymentQuoteStatus.ACTUAL,
      expiryDate: new Date(),
      transferAmounts: transferAmountsJson,
    });
  }

  // amountJson is embedded as a raw JSON literal (e.g. '0', 'null', '1e999'), not via JSON.stringify,
  // so values that stringify would collapse (null/Infinity) reach the guard as written.
  function quoteWithLightningBtcAmountLiteral(amountJson: string): PaymentQuote {
    return quoteFromTransferAmountsJson(
      `[{"method":"${Blockchain.LIGHTNING}","minFee":0,"assets":[{"asset":"BTC","amount":${amountJson}}],"available":true},` +
        `{"method":"${Blockchain.CARDANO}","minFee":0,"assets":[{"asset":"ADA","amount":20}],"available":true}]`,
    );
  }

  function quoteWithoutLightning(): PaymentQuote {
    return quoteFromTransferAmountsJson(
      JSON.stringify([
        {
          method: Blockchain.CARDANO,
          minFee: 0,
          assets: [{ asset: 'ADA', amount: 20 }],
          available: true,
        },
      ]),
    );
  }

  async function expectPayRequestNotFound(quote: PaymentQuote): Promise<void> {
    const pendingPayment = pendingPaymentWithCardanoOnlyLink();
    jest.spyOn(paymentLinkPaymentService, 'getPendingPaymentByUniqueId').mockResolvedValue(pendingPayment);
    jest.spyOn(paymentQuoteService, 'createQuote').mockResolvedValue(quote);

    let caught: unknown;
    try {
      await service.createPayRequest('pl_test');
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(NotFoundException);
    expect((caught as NotFoundException).getStatus()).toBe(404);
    expect((caught as NotFoundException).message).toBe('No BTC transfer amount found');
  }

  it('throws NotFoundException when the quote has no Lightning/BTC amount', async () => {
    await expectPayRequestNotFound(quoteWithoutLightning());
  });

  it('throws NotFoundException when Lightning/BTC amount is zero', async () => {
    await expectPayRequestNotFound(quoteWithLightningBtcAmountLiteral('0'));
  });

  it('throws NotFoundException when persisted Lightning/BTC amount is null', async () => {
    await expectPayRequestNotFound(quoteWithLightningBtcAmountLiteral('null'));
  });

  it('throws NotFoundException when persisted Lightning/BTC amount overflows to Infinity', async () => {
    await expectPayRequestNotFound(quoteWithLightningBtcAmountLiteral('1e999'));
  });
});

describe('PaymentLinkService + PaymentQuoteService - composed OpenCryptoPay Lightning', () => {
  let paymentLinkService: PaymentLinkService;
  let paymentLinkPaymentService: PaymentLinkPaymentService;
  let assetService: AssetService;
  let pricingService: PricingService;
  let feeService: PaymentLinkFeeService;
  let paymentQuoteRepo: PaymentQuoteRepository;
  let loggerErrorSpy: jest.SpyInstance;

  const lightningBtc = createCustomAsset({
    id: 1,
    name: 'BTC',
    uniqueName: 'Lightning/BTC',
    blockchain: Blockchain.LIGHTNING,
    type: AssetType.COIN,
    paymentEnabled: true,
    decimals: 8,
  });

  const cardanoAda = createCustomAsset({
    id: 2,
    name: 'ADA',
    uniqueName: 'Cardano/ADA',
    blockchain: Blockchain.CARDANO,
    type: AssetType.COIN,
    paymentEnabled: true,
    decimals: 6,
  });

  const chf = Object.assign(new Fiat(), { id: 1, name: 'CHF' });
  const invoiceAmount = 10;
  const forexFee = 0.01;
  const btcChfRate = 100_000;
  const adaChfRate = 0.5;

  // price.invert().convert(amount / (1 - fee)) with Price.create(asset, CHF, 1/rate)
  const grossFiat = invoiceAmount / (1 - forexFee);
  const expectedBtcAmount = Number((grossFiat / btcChfRate).toFixed(8));
  const expectedAdaAmount = Number((grossFiat / adaChfRate).toFixed(6));
  const expectedMsat = LightningHelper.btcToMsat(expectedBtcAmount);

  // At 100_000 CHF/BTC and forexFee 0.01: 0.0001 / 0.99 / 100_000 rounds to 0 and is dropped
  // from transfer amounts (getTransferAmountAsset skips non-positive results), so no Lightning entry.
  const subSatoshiInvoiceAmount = 0.0001;

  function cardanoOnlyLink(): PaymentLink {
    return {
      uniqueId: 'pl_cardano_only',
      externalId: undefined,
      mode: PaymentLinkMode.MULTIPLE,
      configObj: {
        standards: [PaymentStandard.OPEN_CRYPTO_PAY],
        displayQr: false,
        recipient: { name: 'Test Merchant' },
        blockchains: [Blockchain.CARDANO],
      },
      getMatchingStandard: () => PaymentStandard.OPEN_CRYPTO_PAY,
      displayName: () => 'Test Merchant',
      route: { route: { label: 'test-route' }, userData: {} },
    } as unknown as PaymentLink;
  }

  function pendingPayment(link: PaymentLink, amount = invoiceAmount): PaymentLinkPayment {
    return Object.assign(new PaymentLinkPayment(), {
      uniqueId: 'plp_cardano_only',
      status: PaymentLinkPaymentStatus.PENDING,
      amount,
      currency: chf,
      link,
      expiryDate: new Date(Date.now() + 60_000),
    });
  }

  function priceForAsset(from: { name: string }): Price {
    const rates: Record<string, number> = { BTC: btcChfRate, ADA: adaChfRate };
    const rate = rates[from.name] ?? 1;
    return Price.create(from.name, 'CHF', 1 / rate);
  }

  beforeAll(() => {
    (ConfigModule as Record<string, unknown>).Config = {
      url: () => 'https://api.example.com',
      prefixes: { paymentQuoteUidPrefix: 'pq' },
      payment: {
        manualMethods: ['TaprootAsset', 'Spark', 'Arkade'],
        forexFee: () => forexFee,
        quoteTimeout: () => 300,
      },
    };
  });

  beforeEach(async () => {
    paymentLinkPaymentService = createMock<PaymentLinkPaymentService>();
    assetService = createMock<AssetService>();
    pricingService = createMock<PricingService>();
    feeService = createMock<PaymentLinkFeeService>();
    paymentQuoteRepo = createMock<PaymentQuoteRepository>();
    loggerErrorSpy = jest.spyOn(DfxLogger.prototype, 'error').mockImplementation(() => undefined);

    jest.spyOn(feeService, 'getMinFee').mockResolvedValue(0);
    jest.spyOn(paymentQuoteRepo, 'create').mockImplementation((entity) => Object.assign(new PaymentQuote(), entity));
    jest.spyOn(paymentQuoteRepo, 'save').mockImplementation(async (quote: PaymentQuote) => quote);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentLinkService,
        PaymentQuoteService,
        { provide: PaymentLinkRepository, useValue: createMock<PaymentLinkRepository>() },
        { provide: PaymentLinkPaymentService, useValue: paymentLinkPaymentService },
        { provide: PaymentQuoteRepository, useValue: paymentQuoteRepo },
        { provide: BlockchainRegistryService, useValue: createMock<BlockchainRegistryService>() },
        { provide: AssetService, useValue: assetService },
        { provide: PricingService, useValue: pricingService },
        { provide: PaymentLinkFeeService, useValue: feeService },
        { provide: C2BPaymentLinkService, useValue: createMock<C2BPaymentLinkService>() },
        { provide: PaymentBalanceService, useValue: createMock<PaymentBalanceService>() },
        { provide: TxValidationService, useValue: createMock<TxValidationService>() },
        { provide: InternetComputerService, useValue: createMock<InternetComputerService>() },
        { provide: UserDataService, useValue: createMock<UserDataService>() },
        { provide: DepositRouteService, useValue: createMock<DepositRouteService>() },
      ],
    }).compile();

    paymentLinkService = module.get(PaymentLinkService);
  });

  afterEach(() => jest.restoreAllMocks());

  it('Cardano-only OCP pay request gets Lightning min/max and both transfer amounts', async () => {
    const link = cardanoOnlyLink();
    const payment = pendingPayment(link);

    jest.spyOn(paymentLinkPaymentService, 'getPendingPaymentByUniqueId').mockResolvedValue(payment);
    jest.spyOn(assetService, 'getPaymentAssets').mockResolvedValue([lightningBtc, cardanoAda]);
    jest.spyOn(pricingService, 'getPrice').mockImplementation(async (from) => priceForAsset(from as { name: string }));

    const payRequest = await paymentLinkService.createPayRequest(link.uniqueId);

    expect(payRequest.minSendable).toBe(expectedMsat);
    expect(payRequest.maxSendable).toBe(expectedMsat);
    expect(payRequest.minSendable).toBeGreaterThan(0);
    expect(payRequest.maxSendable).toBe(payRequest.minSendable);

    const lightning = payRequest.transferAmounts.filter((t) => t.method === Blockchain.LIGHTNING);
    const cardano = payRequest.transferAmounts.filter((t) => t.method === Blockchain.CARDANO);

    expect(lightning).toHaveLength(1);
    expect(lightning[0].assets).toHaveLength(1);
    expect(lightning[0].assets[0].asset).toBe('BTC');
    // transferAmountsForPayRequest stringifies amounts via the quote serializer
    expect(Number(lightning[0].assets[0].amount)).toBeCloseTo(expectedBtcAmount, 8);

    expect(cardano).toHaveLength(1);
    expect(cardano[0].assets).toHaveLength(1);
    expect(cardano[0].assets[0].asset).toBe('ADA');
    expect(Number(cardano[0].assets[0].amount)).toBeCloseTo(expectedAdaAmount, 6);

    expect(pricingService.getPrice).toHaveBeenCalledWith(lightningBtc, chf, expect.anything());
    expect(pricingService.getPrice).toHaveBeenCalledWith(cardanoAda, chf, expect.anything());
    expect(paymentQuoteRepo.save).toHaveBeenCalledTimes(1);
    expect(paymentQuoteRepo.create).toHaveBeenCalledTimes(1);

    const savedQuote = (paymentQuoteRepo.save as jest.Mock).mock.calls[0][0] as PaymentQuote;
    expect(typeof savedQuote.transferAmounts).toBe('string');
    expect(savedQuote.getTransferAmountFor(Blockchain.LIGHTNING, 'BTC')?.amount).toBeCloseTo(expectedBtcAmount, 8);
  });

  it('saves the quote but rejects pay request when Lightning/BTC payment asset is missing', async () => {
    const link = cardanoOnlyLink();
    const payment = pendingPayment(link);

    jest.spyOn(paymentLinkPaymentService, 'getPendingPaymentByUniqueId').mockResolvedValue(payment);
    jest.spyOn(assetService, 'getPaymentAssets').mockResolvedValue([cardanoAda]);
    jest.spyOn(pricingService, 'getPrice').mockImplementation(async (from) => priceForAsset(from as { name: string }));

    let caught: unknown;
    try {
      await paymentLinkService.createPayRequest(link.uniqueId);
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(NotFoundException);
    expect((caught as NotFoundException).getStatus()).toBe(404);
    expect((caught as NotFoundException).message).toBe('No BTC transfer amount found');
    expect(paymentQuoteRepo.save).toHaveBeenCalledTimes(1);
  });

  it('saves the quote but rejects pay request when BTC pricing fails', async () => {
    const link = cardanoOnlyLink();
    const payment = pendingPayment(link);

    jest.spyOn(paymentLinkPaymentService, 'getPendingPaymentByUniqueId').mockResolvedValue(payment);
    jest.spyOn(assetService, 'getPaymentAssets').mockResolvedValue([lightningBtc, cardanoAda]);
    jest.spyOn(pricingService, 'getPrice').mockImplementation(async (from) => {
      if ((from as { name: string }).name === 'BTC') throw new Error('BTC price unavailable');
      return priceForAsset(from as { name: string });
    });

    let caught: unknown;
    try {
      await paymentLinkService.createPayRequest(link.uniqueId);
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(NotFoundException);
    expect((caught as NotFoundException).getStatus()).toBe(404);
    expect((caught as NotFoundException).message).toBe('No BTC transfer amount found');
    expect(paymentQuoteRepo.save).toHaveBeenCalledTimes(1);
    expect(loggerErrorSpy).toHaveBeenCalledWith(
      `Quote: Failed to get price of currency CHF and asset Lightning/BTC`,
      expect.any(Error),
    );
  });

  it('rejects pay request when sub-satoshi invoice drops Lightning from the quote', async () => {
    const link = cardanoOnlyLink();
    const payment = pendingPayment(link, subSatoshiInvoiceAmount);

    jest.spyOn(paymentLinkPaymentService, 'getPendingPaymentByUniqueId').mockResolvedValue(payment);
    jest.spyOn(assetService, 'getPaymentAssets').mockResolvedValue([lightningBtc, cardanoAda]);
    jest.spyOn(pricingService, 'getPrice').mockImplementation(async (from) => priceForAsset(from as { name: string }));

    let caught: unknown;
    try {
      await paymentLinkService.createPayRequest(link.uniqueId);
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(NotFoundException);
    expect((caught as NotFoundException).getStatus()).toBe(404);
    expect((caught as NotFoundException).message).toBe('No BTC transfer amount found');
    expect(paymentQuoteRepo.save).toHaveBeenCalledTimes(1);

    const savedQuote = (paymentQuoteRepo.save as jest.Mock).mock.calls[0][0] as PaymentQuote;
    expect(savedQuote.getTransferAmountFor(Blockchain.LIGHTNING, 'BTC')).toBeUndefined();
  });
});
