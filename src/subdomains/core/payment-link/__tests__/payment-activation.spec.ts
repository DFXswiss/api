import { createMock } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { EvmUtil } from 'src/integration/blockchain/shared/evm/evm.util';
import { LnurlpInvoiceDto } from 'src/integration/lightning/dto/lnurlp.dto';
import { LightningClient } from 'src/integration/lightning/lightning-client';
import { LightningService } from 'src/integration/lightning/services/lightning.service';
import { createCustomAsset } from 'src/shared/models/asset/__mocks__/asset.entity.mock';
import { AssetType } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { TestUtil } from 'src/shared/utils/test.util';
import { Util } from 'src/shared/utils/util';
import { EntityManager } from 'typeorm';
import { createCustomPaymentLinkPayment } from '../__mocks__/payment-link-payment.entity.mock';
import { createDefaultPaymentLink } from '../__mocks__/payment-link.entity.mock';
import { createCustomPaymentQuote } from '../__mocks__/payment-quote.entity.mock';
import { PaymentLinkEvmPaymentDto, TransferInfo } from '../dto/payment-link.dto';
import { PaymentActivationStatus } from '../enums';
import { PaymentActivationRepository } from '../repositories/payment-activation.repository';
import { PaymentActivationService } from '../services/payment-activation.service';
import { PaymentLinkPaymentService } from '../services/payment-link-payment.service';
import { PaymentQuoteService } from '../services/payment-quote.service';
import { PaymentTestHelper } from './payment-test.helper';

describe('Payment Activation', () => {
  let lightningServiceMock: LightningService;
  let lightningClientMock: LightningClient;

  let paymentLinkPaymentServiceMock: PaymentLinkPaymentService;
  let paymentQuoteServiceMock: PaymentQuoteService;
  let assetServiceMock: AssetService;

  let entityManagerMock: EntityManager;

  let paymentActivationService: PaymentActivationService;
  let paymentActivationRepo: PaymentActivationRepository;

  beforeAll(async () => {
    lightningServiceMock = createMock<LightningService>();
    lightningClientMock = createMock<LightningClient>();
    jest.spyOn(lightningServiceMock, 'getDefaultClient').mockImplementation(() => lightningClientMock);

    entityManagerMock = createMock<EntityManager>();

    paymentLinkPaymentServiceMock = createMock<PaymentLinkPaymentService>();
    paymentQuoteServiceMock = createMock<PaymentQuoteService>();
    assetServiceMock = createMock<AssetService>();

    const config = {
      url: () => 'https://test.dfx.api:12345/v0.1/payment-webhook',
    };

    const module: TestingModule = await Test.createTestingModule({
      imports: [],
      providers: [
        TestUtil.provideConfig(config),
        { provide: LightningService, useValue: lightningServiceMock },
        { provide: PaymentLinkPaymentService, useValue: paymentLinkPaymentServiceMock },
        { provide: PaymentQuoteService, useValue: paymentQuoteServiceMock },
        { provide: AssetService, useValue: assetServiceMock },

        { provide: EntityManager, useValue: entityManagerMock },
        PaymentActivationRepository,

        PaymentActivationService,
      ],
      controllers: [],
    }).compile();

    paymentActivationService = module.get<PaymentActivationService>(PaymentActivationService);
    (paymentActivationService as any).evmDepositAddress = 'MyEvmPaymentActivationTestDepositAddress';

    paymentActivationRepo = module.get<PaymentActivationRepository>(PaymentActivationRepository);

    (EvmUtil as any).blockchainToChainIdMap = new Map<Blockchain, number>([
      [Blockchain.ETHEREUM, 11111],
      [Blockchain.ARBITRUM, 22222],
      [Blockchain.OPTIMISM, 33333],
      [Blockchain.POLYGON, 44444],
      [Blockchain.BASE, 55555],
    ]);
  });

  describe('Payment Activation', () => {
    it('should be expired', async () => {
      const expiryDate = Util.secondsBefore(10, new Date());

      const payment = createCustomPaymentLinkPayment({ expiryDate });
      jest.spyOn(paymentLinkPaymentServiceMock, 'getPendingPaymentByUniqueId').mockImplementation(async () => payment);

      const quote = createCustomPaymentQuote({ expiryDate });
      jest.spyOn(paymentQuoteServiceMock, 'getActualQuote').mockImplementation(async () => quote);

      const uniqueId = 'plp_12345';
      const transferInfo: TransferInfo = {
        asset: 'BTC',
        amount: 0.00039232,
        method: Blockchain.LIGHTNING,
        quoteUniqueId: null,
      };

      const testCall = async () => paymentActivationService.createPaymentActivationRequest(uniqueId, transferInfo);
      await expect(testCall).rejects.toThrowError('Payment is expired');
    });

    it('should create a new lightning activation', async () => {
      const expiryDate = Util.hoursAfter(1, new Date());
      const paymentRequest =
        'lnbc190n1pntvpmfpp5nzqqqjgzlhpt38rchdlsqvmkwl4pl30rmjqh0df4gvt7jussnmlqhp5gyz0uhe0d6yht6jvu06gwsey2mta5ndp4z4eh5lcrlrrsa72xpyscqzzsxqrdc0sp5qu3vz3lhzhcnqck67ds54lcjum899xly3cjdgm2h3q2qfgfvqw7s9qyyssq9fn4sfefxz5ts7jn4jafyjetfu3qukzy9n43spwfq22zgcfhtp2rw95m8fnxslam7cv6yzfyxsvp0f2sj8ymqrrs62nzxdg0l6e084gqywjd5k';

      const paymentLink = createDefaultPaymentLink();
      const payment = createCustomPaymentLinkPayment({ link: paymentLink, expiryDate });
      jest.spyOn(paymentLinkPaymentServiceMock, 'getPendingPaymentByUniqueId').mockImplementation(async () => payment);

      const quote = createCustomPaymentQuote({ expiryDate });
      jest.spyOn(paymentQuoteServiceMock, 'getActualQuote').mockImplementation(async () => quote);

      jest.spyOn(lightningClientMock, 'getLnBitsWalletPayment').mockImplementation(async () => {
        return Promise.resolve({
          pr: paymentRequest,
        });
      });

      jest.spyOn(assetServiceMock, 'getAssetByUniqueName').mockImplementation(async (uniqueName) => {
        const [blockchain, name] = uniqueName.split('/');
        return createCustomAsset({
          blockchain: Util.toEnum(Blockchain, blockchain),
          name: name,
          dexName: name,
        });
      });

      const paymentActivation = PaymentTestHelper.spyOnPaymentActivationRepo(paymentActivationRepo);

      const uniqueId = 'plp_12345';
      const transferInfo: TransferInfo = {
        asset: 'BTC',
        amount: 0.00039232,
        method: Blockchain.LIGHTNING,
        quoteUniqueId: '',
      };

      const checkPaymentRequest = <LnurlpInvoiceDto>(
        await paymentActivationService.createPaymentActivationRequest(uniqueId, transferInfo)
      );

      expect(paymentActivation.id).toBe(1);
      expect(paymentActivation.status).toBe(PaymentActivationStatus.PENDING);
      expect(paymentActivation.method).toBe(Blockchain.LIGHTNING);
      expect(paymentActivation.amount).toBe(0.00039232);
      expect(paymentActivation.paymentRequest).toBe(paymentRequest);

      expect(checkPaymentRequest.pr).toBe(paymentRequest);
    });

    it('should create a new evm activation', async () => {
      const expiryDate = Util.hoursAfter(1, new Date());

      const paymentLink = createDefaultPaymentLink();
      const payment = createCustomPaymentLinkPayment({ link: paymentLink, expiryDate });
      jest.spyOn(paymentLinkPaymentServiceMock, 'getPendingPaymentByUniqueId').mockImplementation(async () => payment);

      const quote = createCustomPaymentQuote({ expiryDate });
      jest.spyOn(paymentQuoteServiceMock, 'getActualQuote').mockImplementation(async () => quote);

      jest.spyOn(assetServiceMock, 'getAssetByUniqueName').mockImplementation(async (uniqueName) => {
        const [blockchain, name] = uniqueName.split('/');
        return createCustomAsset({
          type: AssetType.TOKEN,
          blockchain: Util.toEnum(Blockchain, blockchain),
          name: name,
          dexName: name,
          decimals: 18,
          chainId: 'MyTestAssetChainId',
        });
      });

      const paymentActivation = PaymentTestHelper.spyOnPaymentActivationRepo(paymentActivationRepo);

      const uniqueId = 'plp_12345';
      const transferInfo: TransferInfo = {
        asset: 'ZCHF',
        amount: 20,
        method: Blockchain.ETHEREUM,
        quoteUniqueId: '',
      };

      const checkPaymentRequest = <PaymentLinkEvmPaymentDto>(
        await paymentActivationService.createPaymentActivationRequest(uniqueId, transferInfo)
      );

      const paymentRequest =
        'ethereum:MyTestAssetChainId@11111/transfer?address=MyEvmPaymentActivationTestDepositAddress&uint256=20000000000000000000';

      expect(paymentActivation.id).toBe(1);
      expect(paymentActivation.status).toBe(PaymentActivationStatus.PENDING);
      expect(paymentActivation.method).toBe(Blockchain.ETHEREUM);
      expect(paymentActivation.amount).toBe(20);
      expect(paymentActivation.paymentRequest).toBe(paymentRequest);

      expect(checkPaymentRequest.blockchain).toBe(Blockchain.ETHEREUM);
      expect(checkPaymentRequest.uri).toBe(paymentRequest);
    });
  });
});
