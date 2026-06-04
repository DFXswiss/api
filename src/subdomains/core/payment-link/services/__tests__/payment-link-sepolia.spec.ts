import { createMock } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { InternetComputerService } from 'src/integration/blockchain/icp/services/icp.service';
import { BlockchainRegistryService } from 'src/integration/blockchain/shared/services/blockchain-registry.service';
import { TxValidationService } from 'src/integration/blockchain/shared/services/tx-validation.service';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { TestSharedModule } from 'src/shared/utils/test.shared.module';
import { PricingService } from 'src/subdomains/supporting/pricing/services/pricing.service';
import { PaymentActivation } from '../../entities/payment-activation.entity';
import { PaymentQuote } from '../../entities/payment-quote.entity';
import { PaymentQuoteStatus } from '../../enums';
import { PaymentRequestMapper } from '../../dto/payment-request.mapper';
import { TransferInfo } from '../../dto/payment-link.dto';
import { PaymentQuoteRepository } from '../../repositories/payment-quote.repository';
import { C2BPaymentLinkService } from '../c2b-payment-link.service';
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
