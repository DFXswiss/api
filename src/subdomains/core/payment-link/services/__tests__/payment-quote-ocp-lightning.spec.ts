import { createMock } from '@golevelup/ts-jest';
import { ServiceUnavailableException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as ConfigModule from 'src/config/config';
import { InternetComputerService } from 'src/integration/blockchain/icp/services/icp.service';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { BlockchainRegistryService } from 'src/integration/blockchain/shared/services/blockchain-registry.service';
import { TxValidationService } from 'src/integration/blockchain/shared/services/tx-validation.service';
import { createCustomAsset } from 'src/shared/models/asset/__mocks__/asset.entity.mock';
import { AssetType } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { Fiat } from 'src/shared/models/fiat/fiat.entity';
import { Price } from 'src/subdomains/supporting/pricing/domain/entities/price';
import { PricingService } from 'src/subdomains/supporting/pricing/services/pricing.service';
import { PaymentLinkPayment } from '../../entities/payment-link-payment.entity';
import { PaymentLink } from '../../entities/payment-link.entity';
import { PaymentStandard } from '../../enums';
import { PaymentQuoteRepository } from '../../repositories/payment-quote.repository';
import { C2BPaymentLinkService } from '../c2b-payment-link.service';
import { PaymentBalanceService } from '../payment-balance.service';
import { PaymentLinkFeeService } from '../payment-link-fee.service';
import { PaymentQuoteService } from '../payment-quote.service';

describe('PaymentQuoteService - OpenCryptoPay Lightning selection', () => {
  let service: PaymentQuoteService;
  let assetService: AssetService;
  let pricingService: PricingService;
  let feeService: PaymentLinkFeeService;
  let paymentQuoteRepo: PaymentQuoteRepository;

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

  const tronTrx = createCustomAsset({
    id: 3,
    name: 'TRX',
    uniqueName: 'Tron/TRX',
    blockchain: Blockchain.TRON,
    type: AssetType.COIN,
    paymentEnabled: true,
    decimals: 6,
  });

  const solanaSol = createCustomAsset({
    id: 4,
    name: 'SOL',
    uniqueName: 'Solana/SOL',
    blockchain: Blockchain.SOLANA,
    type: AssetType.COIN,
    paymentEnabled: true,
    decimals: 9,
  });

  const chf = Object.assign(new Fiat(), { id: 1, name: 'CHF' });
  const invoiceAmount = 10;
  const forexFee = 0.01;
  const rates: Record<string, number> = { BTC: 100_000, ADA: 0.5, TRX: 0.2, SOL: 150 };
  const grossFiat = invoiceAmount / (1 - forexFee);

  function expectedAmount(asset: string, decimals: number): number {
    return Number((grossFiat / rates[asset]).toFixed(decimals));
  }

  function paymentLinkWith(blockchains: Blockchain[]): PaymentLink {
    return { configObj: { blockchains } } as PaymentLink;
  }

  function realMethods(transferAmounts: { method: string }[]): Blockchain[] {
    const blockchainValues = Object.values(Blockchain) as string[];
    return transferAmounts.map((t) => t.method).filter((m): m is Blockchain => blockchainValues.includes(m));
  }

  beforeAll(() => {
    (ConfigModule as Record<string, unknown>).Config = {
      prefixes: { paymentQuoteUidPrefix: 'pq' },
      payment: {
        manualMethods: ['TaprootAsset', 'Spark', 'Arkade'],
        forexFee: () => forexFee,
        quoteTimeout: () => 300,
      },
    };
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });

  beforeEach(async () => {
    assetService = createMock<AssetService>();
    pricingService = createMock<PricingService>();
    feeService = createMock<PaymentLinkFeeService>();
    paymentQuoteRepo = createMock<PaymentQuoteRepository>();

    jest.spyOn(assetService, 'getPaymentAssets').mockResolvedValue([lightningBtc, cardanoAda, tronTrx, solanaSol]);
    jest.spyOn(feeService, 'getMinFee').mockResolvedValue(0);
    // asset→CHF: invert converts CHF amount into asset amount through the real pricing path
    jest.spyOn(pricingService, 'getPrice').mockImplementation(async (from) => {
      const rate = rates[(from as { name: string }).name] ?? 1;
      return Price.create((from as { name: string }).name, 'CHF', 1 / rate);
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentQuoteService,
        { provide: PaymentQuoteRepository, useValue: paymentQuoteRepo },
        { provide: BlockchainRegistryService, useValue: createMock<BlockchainRegistryService>() },
        { provide: AssetService, useValue: assetService },
        { provide: PricingService, useValue: pricingService },
        { provide: PaymentLinkFeeService, useValue: feeService },
        { provide: C2BPaymentLinkService, useValue: createMock<C2BPaymentLinkService>() },
        { provide: PaymentBalanceService, useValue: createMock<PaymentBalanceService>() },
        { provide: TxValidationService, useValue: createMock<TxValidationService>() },
        { provide: InternetComputerService, useValue: createMock<InternetComputerService>() },
      ],
    }).compile();

    service = module.get(PaymentQuoteService);
  });

  afterEach(() => jest.restoreAllMocks());

  it('OCP with Cardano-only config adds Lightning and keeps Cardano with priced amounts', async () => {
    const transferAmounts = await service.createTransferAmounts(
      PaymentStandard.OPEN_CRYPTO_PAY,
      paymentLinkWith([Blockchain.CARDANO]),
      invoiceAmount,
      chf,
    );

    const methods = realMethods(transferAmounts);
    expect(methods.filter((m) => m === Blockchain.LIGHTNING)).toHaveLength(1);
    expect(methods).toContain(Blockchain.CARDANO);
    expect(methods[0]).toBe(Blockchain.LIGHTNING);

    const lightning = transferAmounts.find((t) => t.method === Blockchain.LIGHTNING);
    const cardano = transferAmounts.find((t) => t.method === Blockchain.CARDANO);

    expect(lightning?.assets).toEqual([{ asset: 'BTC', amount: expectedAmount('BTC', 8) }]);
    expect(cardano?.assets).toEqual([{ asset: 'ADA', amount: expectedAmount('ADA', 6) }]);
    expect(pricingService.getPrice).toHaveBeenCalledWith(lightningBtc, chf, expect.anything());
    expect(pricingService.getPrice).toHaveBeenCalledWith(cardanoAda, chf, expect.anything());
  });

  it('OCP with Tron-only config adds Lightning and keeps Tron', async () => {
    const transferAmounts = await service.createTransferAmounts(
      PaymentStandard.OPEN_CRYPTO_PAY,
      paymentLinkWith([Blockchain.TRON]),
      invoiceAmount,
      chf,
    );

    const methods = realMethods(transferAmounts);
    expect(methods.filter((m) => m === Blockchain.LIGHTNING)).toHaveLength(1);
    expect(methods).toContain(Blockchain.TRON);
    expect(methods).not.toContain(Blockchain.CARDANO);

    const lightning = transferAmounts.find((t) => t.method === Blockchain.LIGHTNING);
    const tron = transferAmounts.find((t) => t.method === Blockchain.TRON);
    expect(lightning?.assets[0].amount).toBe(expectedAmount('BTC', 8));
    expect(tron?.assets[0].amount).toBe(expectedAmount('TRX', 6));
  });

  it('OCP config that already includes Lightning does not duplicate it', async () => {
    const transferAmounts = await service.createTransferAmounts(
      PaymentStandard.OPEN_CRYPTO_PAY,
      paymentLinkWith([Blockchain.LIGHTNING, Blockchain.CARDANO]),
      invoiceAmount,
      chf,
    );

    const methods = realMethods(transferAmounts);
    expect(methods.filter((m) => m === Blockchain.LIGHTNING)).toHaveLength(1);
    expect(methods).toContain(Blockchain.CARDANO);
  });

  it('non-OCP standard with Cardano-only config does not add Lightning', async () => {
    const transferAmounts = await service.createTransferAmounts(
      PaymentStandard.PAY_TO_ADDRESS,
      paymentLinkWith([Blockchain.CARDANO]),
      invoiceAmount,
      chf,
    );

    const methods = realMethods(transferAmounts);
    expect(methods).not.toContain(Blockchain.LIGHTNING);
    expect(methods).toContain(Blockchain.CARDANO);
  });

  it('asset-only transfer amounts without amount/currency still list chain assets', async () => {
    const transferAmounts = await service.createTransferAmounts(
      PaymentStandard.OPEN_CRYPTO_PAY,
      paymentLinkWith([Blockchain.CARDANO]),
    );

    const lightning = transferAmounts.find((t) => t.method === Blockchain.LIGHTNING);
    const cardano = transferAmounts.find((t) => t.method === Blockchain.CARDANO);

    expect(lightning?.assets).toEqual([{ asset: 'BTC' }]);
    expect(cardano?.assets).toEqual([{ asset: 'ADA' }]);
    expect(pricingService.getPrice).not.toHaveBeenCalled();
  });

  it.each([Infinity, -Infinity, NaN])(
    'fails closed for non-finite Lightning/BTC amount %p without creating or saving a quote',
    async (nonFiniteAmount) => {
      jest.spyOn(service, 'createTransferAmounts').mockResolvedValue([
        {
          method: Blockchain.LIGHTNING,
          minFee: 0,
          assets: [{ asset: 'BTC', amount: nonFiniteAmount }],
          available: true,
        },
      ]);

      const payment = Object.assign(new PaymentLinkPayment(), {
        amount: invoiceAmount,
        currency: chf,
        expiryDate: new Date(Date.now() + 60_000),
        link: paymentLinkWith([Blockchain.CARDANO]),
      });

      let caught: unknown;
      try {
        await service.createQuote(PaymentStandard.OPEN_CRYPTO_PAY, payment);
      } catch (e) {
        caught = e;
      }

      expect(caught).toBeInstanceOf(ServiceUnavailableException);
      expect((caught as ServiceUnavailableException).getStatus()).toBe(503);
      expect((caught as ServiceUnavailableException).message).toBe('Lightning payment option unavailable');
      expect(paymentQuoteRepo.create).not.toHaveBeenCalled();
      expect(paymentQuoteRepo.save).not.toHaveBeenCalled();
    },
  );
});
