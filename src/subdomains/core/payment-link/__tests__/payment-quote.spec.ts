import { createMock } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { EvmGasPriceService } from 'src/integration/blockchain/shared/evm/evm-gas-price.service';
import { createCustomPrice } from 'src/integration/exchange/dto/__mocks__/price.dto.mock';
import { LightningService } from 'src/integration/lightning/services/lightning.service';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { TestUtil } from 'src/shared/utils/test.util';
import { LnUrlForwardService } from 'src/subdomains/generic/forwarding/services/lnurl-forward.service';
import { PricingService } from 'src/subdomains/supporting/pricing/services/pricing.service';
import { EntityManager } from 'typeorm';
import { createCustomPaymentLinkPayment } from '../__mocks__/payment-link-payment.entity.mock';
import { createDefaultPaymentLink } from '../__mocks__/payment-link.entity.mock';
import { PaymentLinkPayRequestDto } from '../dto/payment-link.dto';
import { PaymentQuoteRepository } from '../repositories/payment-quote.repository';
import { PaymentActivationService } from '../services/payment-activation.service';
import { PaymentLinkPaymentService } from '../services/payment-link-payment.service';
import { PaymentLinkService } from '../services/payment-link.service';
import { PaymentQuoteService } from '../services/payment-quote.service';
import { PaymentTestHelper } from './payment-test.helper';

describe('Payment Quote', () => {
  let lightningServiceMock: LightningService;

  let assetServiceMock: AssetService;
  let pricingServiceMock: PricingService;
  let evmGasPriceServiceMock: EvmGasPriceService;

  let entityManagerMock: EntityManager;

  let paymentLinkServiceMock: PaymentLinkService;
  let paymentLinkPaymentServiceMock: PaymentLinkPaymentService;
  let paymentActivationServiceMock: PaymentActivationService;

  let lnUrlForwardService: LnUrlForwardService;

  let paymentQuoteRepo: PaymentQuoteRepository;

  beforeAll(async () => {
    lightningServiceMock = createMock<LightningService>();
    entityManagerMock = createMock<EntityManager>();

    assetServiceMock = createMock<AssetService>();
    pricingServiceMock = createMock<PricingService>();
    evmGasPriceServiceMock = createMock<EvmGasPriceService>();

    paymentLinkServiceMock = createMock<PaymentLinkService>();
    paymentLinkPaymentServiceMock = createMock<PaymentLinkPaymentService>();
    paymentActivationServiceMock = createMock<PaymentActivationService>();

    const config = {
      url: () => 'https://test.dfx.api:12345/v0.1/payment-quote',
      payment: { fee: 0.02 },
    };

    const module: TestingModule = await Test.createTestingModule({
      imports: [],
      providers: [
        TestUtil.provideConfig(config),
        { provide: LightningService, useValue: lightningServiceMock },

        { provide: AssetService, useValue: assetServiceMock },
        { provide: PricingService, useValue: pricingServiceMock },
        { provide: EvmGasPriceService, useValue: evmGasPriceServiceMock },

        { provide: PaymentLinkService, useValue: paymentLinkServiceMock },
        { provide: PaymentLinkPaymentService, useValue: paymentLinkPaymentServiceMock },
        { provide: PaymentActivationService, useValue: paymentActivationServiceMock },

        { provide: EntityManager, useValue: entityManagerMock },
        PaymentQuoteRepository,

        LnUrlForwardService,
        PaymentQuoteService,
      ],
      controllers: [],
    }).compile();

    lnUrlForwardService = module.get<LnUrlForwardService>(LnUrlForwardService);

    paymentQuoteRepo = module.get<PaymentQuoteRepository>(PaymentQuoteRepository);
  });

  describe('Create Payment Quote', () => {
    it('should create a new quote', async () => {
      const paymentLink = createDefaultPaymentLink();
      const pendingPayment = createCustomPaymentLinkPayment({ link: paymentLink });
      jest.spyOn(paymentLinkPaymentServiceMock, 'getPendingPaymentByUniqueId').mockResolvedValue(pendingPayment);

      jest.spyOn(evmGasPriceServiceMock, 'getGasPrice').mockImplementation((blockchain) => {
        return blockchain === Blockchain.POLYGON ? 0.01 : 0.05;
      });

      const price = createCustomPrice({ isValid: true, source: 'BTC', target: 'ZCHF', price: 0.000018 });
      jest.spyOn(pricingServiceMock, 'getPrice').mockResolvedValue(price);

      PaymentTestHelper.spyOnAsset(assetServiceMock);
      PaymentTestHelper.spyOnPaymentQuoteRepo(paymentQuoteRepo, 'pl_x1y2z3');

      const checkDto = <PaymentLinkPayRequestDto>await lnUrlForwardService.lnurlpForward('pl_x1y2z3');

      expect(checkDto.tag).toBe('payRequest');
      expect(checkDto.callback).toBe('https://test.dfx.api:12345/v0.1/payment-quote/lnurlp/cb/pl_x1y2z3');
      expect(checkDto.minSendable).toBe(226745000);
      expect(checkDto.maxSendable).toBe(226745000);
      expect(checkDto.metadata).toBe('[["text/plain", "TestLinkName"]]');
      expect(checkDto.displayName).toBe('TestLinkName');
      expect(checkDto.quote.id).toBe('pl_x1y2z3');
      expect(checkDto.requestedAmount.asset).toBe('CHF');
      expect(checkDto.requestedAmount.amount).toBe(123.45);

      expect(checkDto.transferAmounts.length).toBe(3);

      expect(checkDto.transferAmounts[0].method).toBe('Lightning');
      expect(checkDto.transferAmounts[0].minFee).toBe(0);
      expect(checkDto.transferAmounts[0].assets[0].asset).toBe('BTC');
      expect(checkDto.transferAmounts[0].assets[0].amount).toBe(0.00226745);

      expect(checkDto.transferAmounts[1].method).toBe('Ethereum');
      expect(checkDto.transferAmounts[1].minFee).toBe(0.05);
      expect(checkDto.transferAmounts[1].assets[0].asset).toBe('ZCHF');
      expect(checkDto.transferAmounts[1].assets[0].amount).toBe(123.45);

      expect(checkDto.transferAmounts[2].method).toBe('Polygon');
      expect(checkDto.transferAmounts[2].minFee).toBe(0.01);
      expect(checkDto.transferAmounts[2].assets[0].asset).toBe('ZCHF');
      expect(checkDto.transferAmounts[2].assets[0].amount).toBe(123.45);
    });
  });
});
