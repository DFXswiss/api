import { createMock } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
import { ethers } from 'ethers';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { InternetComputerService } from 'src/integration/blockchain/icp/services/icp.service';
import { EvmClient } from 'src/integration/blockchain/shared/evm/evm-client';
import { BlockchainRegistryService } from 'src/integration/blockchain/shared/services/blockchain-registry.service';
import { CryptoService } from 'src/integration/blockchain/shared/services/crypto.service';
import { TxValidationService } from 'src/integration/blockchain/shared/services/tx-validation.service';
import { LightningService } from 'src/integration/lightning/services/lightning.service';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { TestSharedModule } from 'src/shared/utils/test.shared.module';
import { PricingService } from 'src/subdomains/supporting/pricing/services/pricing.service';
import { PayoutBitcoinService } from 'src/subdomains/supporting/payout/services/payout-bitcoin.service';
import { PayoutFiroService } from 'src/subdomains/supporting/payout/services/payout-firo.service';
import { PaymentActivation } from '../../entities/payment-activation.entity';
import { PaymentLinkPayment } from '../../entities/payment-link-payment.entity';
import { PaymentQuote } from '../../entities/payment-quote.entity';
import { PaymentQuoteStatus } from '../../enums';
import { PaymentRequestMapper } from '../../dto/payment-request.mapper';
import { TransferInfo } from '../../dto/payment-link.dto';
import { PaymentQuoteRepository } from '../../repositories/payment-quote.repository';
import { C2BPaymentLinkService } from '../c2b-payment-link.service';
import { PaymentActivationService } from '../payment-activation.service';
import { PaymentBalanceService } from '../payment-balance.service';
import { PaymentLinkFeeService } from '../payment-link-fee.service';
import { PaymentQuoteService } from '../payment-quote.service';
import * as ConfigModule from 'src/config/config';

// Sepolia is an allowed payment-link chain on non-PRD (PaymentLinkBlockchains includes it; TestBlockchains is
// empty off PRD). These specs lock in that the engine routes Sepolia through the EVM handlers — the new
// `case Blockchain.SEPOLIA` lines — instead of falling through to the default throw.
describe('Payment-link engine - Sepolia routing', () => {
  describe('PaymentBalanceService.getDepositAddress', () => {
    let service: PaymentBalanceService;

    const EVM_DEPOSIT_ADDRESS = '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0';

    beforeEach(async () => {
      const module: TestingModule = await Test.createTestingModule({
        imports: [TestSharedModule],
        providers: [PaymentBalanceService],
      })
        .useMocker(() => createMock())
        .compile();

      service = module.get<PaymentBalanceService>(PaymentBalanceService);
      // set the EVM deposit address directly (onModuleInit would derive it from a configured seed)
      service['evmDepositAddress'] = EVM_DEPOSIT_ADDRESS;
    });

    it('returns the EVM deposit address for Sepolia (same as the mainnet EVM chains)', () => {
      expect(service.getDepositAddress(Blockchain.SEPOLIA)).toBe(EVM_DEPOSIT_ADDRESS);
      expect(service.getDepositAddress(Blockchain.ETHEREUM)).toBe(EVM_DEPOSIT_ADDRESS);
    });
  });

  describe('PaymentLinkFeeService.calculateFee / getMinFee', () => {
    let service: PaymentLinkFeeService;
    let blockchainRegistryService: BlockchainRegistryService;

    const SEPOLIA_GAS_PRICE = ethers.BigNumber.from(1_500_000_000);

    beforeEach(async () => {
      const module: TestingModule = await Test.createTestingModule({
        imports: [TestSharedModule],
        providers: [
          PaymentLinkFeeService,
          { provide: BlockchainRegistryService, useValue: createMock<BlockchainRegistryService>() },
          { provide: PayoutBitcoinService, useValue: createMock<PayoutBitcoinService>() },
          { provide: PayoutFiroService, useValue: createMock<PayoutFiroService>() },
        ],
      }).compile();

      service = module.get<PaymentLinkFeeService>(PaymentLinkFeeService);
      blockchainRegistryService = module.get<BlockchainRegistryService>(BlockchainRegistryService);

      const evmClient = createMock<EvmClient>();
      jest.spyOn(evmClient, 'getRecommendedGasPrice').mockResolvedValue(SEPOLIA_GAS_PRICE);
      jest.spyOn(blockchainRegistryService, 'getEvmClient').mockReturnValue(evmClient);
    });

    it('routes Sepolia to the EVM gas-price client and caches a real fee (not undefined)', async () => {
      // calculateFee is private; exercise it through the public updateFees → getMinFee path
      const fee = await (
        service as unknown as { calculateFee: (blockchain: Blockchain) => Promise<number> }
      ).calculateFee(Blockchain.SEPOLIA);

      expect(blockchainRegistryService.getEvmClient).toHaveBeenCalledWith(Blockchain.SEPOLIA);
      expect(fee).toBe(+SEPOLIA_GAS_PRICE);
      expect(fee).not.toBeUndefined();
    });

    it('getMinFee returns the cached Sepolia gas-price after updateFees', async () => {
      jest.spyOn(ConfigModule, 'GetConfig').mockReturnValue({
        environment: ConfigModule.Environment.DEV,
      } as ReturnType<typeof ConfigModule.GetConfig>);

      await service.updateFees();

      await expect(service.getMinFee(Blockchain.SEPOLIA)).resolves.toBe(+SEPOLIA_GAS_PRICE);
    });
  });

  describe('PaymentActivationService.createBlockchainRequest', () => {
    let service: PaymentActivationService;
    let paymentBalanceService: PaymentBalanceService;
    let cryptoService: CryptoService;

    const EVM_DEPOSIT_ADDRESS = '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0';
    const PAYMENT_REQUEST = 'ethereum:0xToken@11155111/transfer?address=0xRecipient&uint256=1';

    beforeEach(async () => {
      const module: TestingModule = await Test.createTestingModule({
        imports: [TestSharedModule],
        providers: [PaymentActivationService],
      })
        .useMocker((token) => {
          if (token === LightningService) {
            const lightningService = createMock<LightningService>();
            jest.spyOn(lightningService, 'getDefaultClient').mockReturnValue(createMock());
            return lightningService;
          }
          return createMock();
        })
        .compile();

      service = module.get<PaymentActivationService>(PaymentActivationService);
      paymentBalanceService = module.get<PaymentBalanceService>(PaymentBalanceService);
      cryptoService = module.get<CryptoService>(CryptoService);

      jest.spyOn(paymentBalanceService, 'getDepositAddress').mockReturnValue(EVM_DEPOSIT_ADDRESS);
      jest.spyOn(cryptoService, 'getPaymentRequest').mockResolvedValue(PAYMENT_REQUEST);
      jest
        .spyOn(service as unknown as { getAssetByInfo: () => Promise<Asset> }, 'getAssetByInfo')
        .mockResolvedValue({} as Asset);
    });

    it('routes Sepolia to the EVM deposit-address branch (not the default invalid-method throw)', async () => {
      const transferInfo: TransferInfo = {
        method: Blockchain.SEPOLIA,
        asset: 'ZCHF',
        amount: 1,
      } as TransferInfo;

      const result = await (
        service as unknown as {
          createBlockchainRequest: (
            payment: PaymentLinkPayment,
            transferInfo: TransferInfo,
            expirySec: number,
            quote: PaymentQuote,
          ) => Promise<{ paymentRequest: string; paymentHash?: string }>;
        }
      ).createBlockchainRequest({} as PaymentLinkPayment, transferInfo, 60, new PaymentQuote());

      expect(paymentBalanceService.getDepositAddress).toHaveBeenCalledWith(Blockchain.SEPOLIA);
      expect(result.paymentRequest).toBe(PAYMENT_REQUEST);
    });
  });

  describe('PaymentQuoteService.executeHexPayment', () => {
    let service: PaymentQuoteService;

    function createActualQuote(): PaymentQuote {
      const quote = new PaymentQuote();
      quote.uniqueId = 'quote-sepolia-1';
      quote.status = PaymentQuoteStatus.ACTUAL;
      quote.activations = null;
      return quote;
    }

    beforeEach(async () => {
      const paymentQuoteRepo = createMock<PaymentQuoteRepository>();
      jest.spyOn(paymentQuoteRepo, 'findOne').mockResolvedValue(createActualQuote());
      jest.spyOn(paymentQuoteRepo, 'save').mockImplementation(async (q) => q as PaymentQuote);

      const module: TestingModule = await Test.createTestingModule({
        imports: [TestSharedModule],
        providers: [
          PaymentQuoteService,
          { provide: PaymentQuoteRepository, useValue: paymentQuoteRepo },
          { provide: BlockchainRegistryService, useValue: createMock<BlockchainRegistryService>() },
          { provide: AssetService, useValue: createMock<AssetService>() },
          { provide: PricingService, useValue: createMock<PricingService>() },
          { provide: PaymentLinkFeeService, useValue: createMock<PaymentLinkFeeService>() },
          { provide: C2BPaymentLinkService, useValue: createMock<C2BPaymentLinkService>() },
          { provide: PaymentBalanceService, useValue: createMock<PaymentBalanceService>() },
          { provide: TxValidationService, useValue: createMock<TxValidationService>() },
          { provide: InternetComputerService, useValue: createMock<InternetComputerService>() },
        ],
      }).compile();

      service = module.get<PaymentQuoteService>(PaymentQuoteService);
    });

    it('routes Sepolia to the EVM hex handler (not the default throw)', async () => {
      const doEvmHexPayment = jest
        .spyOn(service as unknown as { doEvmHexPayment: (method: Blockchain) => Promise<void> }, 'doEvmHexPayment')
        .mockResolvedValue(undefined);

      // use `tx` (not `hex`) so the checkbot sign-verification branch is skipped and the method switch is reached
      const transferInfo: TransferInfo = {
        method: Blockchain.SEPOLIA,
        tx: '0xTxHash',
        quoteUniqueId: 'quote-sepolia-1',
      } as TransferInfo;

      const quote = await service.executeHexPayment(transferInfo);

      expect(doEvmHexPayment).toHaveBeenCalledTimes(1);
      expect(doEvmHexPayment.mock.calls[0][0]).toBe(Blockchain.SEPOLIA);
      // the default branch records a TX_FAILED on the quote; the EVM route must not have failed it
      expect(quote.status).not.toBe(PaymentQuoteStatus.TX_FAILED);
    });
  });

  describe('PaymentRequestMapper.toPaymentRequest', () => {
    beforeAll(() => {
      (ConfigModule as Record<string, unknown>).Config = { url: () => 'https://example.com' };
    });

    afterAll(() => {
      jest.restoreAllMocks();
    });

    it('routes Sepolia to the EVM payment-link payment (not the default throw)', () => {
      const activation = {
        method: Blockchain.SEPOLIA,
        paymentRequest: 'ethereum:0xToken@11155111/transfer?address=0xRecipient&uint256=1',
        expiryDate: new Date('2026-06-04T00:00:00.000Z'),
        payment: { uniqueId: 'pl-payment-1' },
      } as unknown as PaymentActivation;

      const result = PaymentRequestMapper.toPaymentRequest(activation);

      expect(result).toMatchObject({
        blockchain: Blockchain.SEPOLIA,
        uri: activation.paymentRequest,
        expiryDate: activation.expiryDate,
      });
    });
  });
});
