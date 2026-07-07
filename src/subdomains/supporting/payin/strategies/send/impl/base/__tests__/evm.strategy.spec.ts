import { createMock } from '@golevelup/ts-jest';
import { Injectable } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ethers } from 'ethers';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { AssetType } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { BlockchainAddress } from 'src/shared/models/blockchain-address';
import { TestSharedModule } from 'src/shared/utils/test.shared.module';
import { TestUtil } from 'src/shared/utils/test.util';
import { createCustomCryptoInput } from 'src/subdomains/supporting/payin/entities/__mocks__/crypto-input.entity.mock';
import {
  PayInConfirmationType,
  PayInPurpose,
  PayInStatus,
} from 'src/subdomains/supporting/payin/entities/crypto-input.entity';
import { PayInRepository } from 'src/subdomains/supporting/payin/repositories/payin.repository';
import { PayInEvmService } from 'src/subdomains/supporting/payin/services/base/payin-evm.service';
import { TransactionHelper } from 'src/subdomains/supporting/payment/services/transaction-helper';
import { PayoutService } from 'src/subdomains/supporting/payout/services/payout.service';
import { PricingService } from 'src/subdomains/supporting/pricing/services/pricing.service';
import { EvmStrategy } from '../evm.strategy';
import { SendStrategyRegistry } from '../send.strategy-registry';

@Injectable()
class TestEvmStrategy extends EvmStrategy {
  constructor(payInEvmService: PayInEvmService, payInRepo: PayInRepository) {
    super(payInEvmService, payInRepo);
  }

  get blockchain(): Blockchain {
    return Blockchain.ETHEREUM;
  }

  get assetType(): AssetType {
    return AssetType.COIN;
  }

  protected dispatchSend(): Promise<string> {
    throw new Error('Method not implemented');
  }

  protected prepareSend(): Promise<void> {
    throw new Error('Method not implemented');
  }

  protected checkPreparation(): Promise<boolean> {
    throw new Error('Method not implemented');
  }

  protected getForwardAddress(): BlockchainAddress {
    throw new Error('Method not implemented');
  }
}

describe('EvmStrategy', () => {
  let strategy: TestEvmStrategy;

  let payInEvmService: PayInEvmService;
  let payInRepo: PayInRepository;
  let transactionHelper: TransactionHelper;

  beforeEach(async () => {
    payInEvmService = createMock<PayInEvmService>();
    payInRepo = createMock<PayInRepository>();
    transactionHelper = createMock<TransactionHelper>();

    const module: TestingModule = await Test.createTestingModule({
      imports: [TestSharedModule],
      providers: [
        TestEvmStrategy,
        { provide: PayInEvmService, useValue: payInEvmService },
        { provide: PayInRepository, useValue: payInRepo },
        { provide: TransactionHelper, useValue: transactionHelper },
        { provide: PricingService, useValue: createMock<PricingService>() },
        { provide: PayoutService, useValue: createMock<PayoutService>() },
        { provide: SendStrategyRegistry, useValue: createMock<SendStrategyRegistry>() },
        { provide: AssetService, useValue: createMock<AssetService>() },
        TestUtil.provideConfig(),
      ],
    }).compile();

    strategy = module.get<TestEvmStrategy>(TestEvmStrategy);
  });

  describe('checkConfirmations', () => {
    beforeEach(() => {
      jest.spyOn(transactionHelper, 'getMinConfirmations').mockResolvedValue(1);
    });

    it('marks the pay-in as failed on a permanent input TX error', async () => {
      const payIn = createCustomCryptoInput({ id: 1, status: PayInStatus.ACKNOWLEDGED });
      jest
        .spyOn(payInEvmService, 'checkTransactionCompletion')
        .mockRejectedValue(Object.assign(new Error('invalid hash'), { code: ethers.errors.INVALID_ARGUMENT }));

      await strategy.checkConfirmations([payIn], PayInConfirmationType.INPUT);

      expect(payIn.status).toBe(PayInStatus.FAILED);
      expect(payInRepo.update).toHaveBeenCalledWith(1, { status: PayInStatus.FAILED });
    });

    it('keeps the pay-in unchanged on a transient input error', async () => {
      const payIn = createCustomCryptoInput({ id: 1, status: PayInStatus.ACKNOWLEDGED });
      jest
        .spyOn(payInEvmService, 'checkTransactionCompletion')
        .mockRejectedValue(Object.assign(new Error('timeout'), { code: ethers.errors.TIMEOUT }));

      await strategy.checkConfirmations([payIn], PayInConfirmationType.INPUT);

      expect(payIn.status).toBe(PayInStatus.ACKNOWLEDGED);
      expect(payInRepo.update).not.toHaveBeenCalled();
    });

    it('does not mark the pay-in as failed on a permanent output TX error', async () => {
      const payIn = createCustomCryptoInput({ id: 1, status: PayInStatus.FORWARDED });
      jest
        .spyOn(payInEvmService, 'checkTransactionCompletion')
        .mockRejectedValue(Object.assign(new Error('invalid hash'), { code: ethers.errors.INVALID_ARGUMENT }));

      await strategy.checkConfirmations([payIn], PayInConfirmationType.OUTPUT);

      expect(payIn.status).toBe(PayInStatus.FORWARDED);
      expect(payInRepo.update).not.toHaveBeenCalled();
    });

    it('confirms the pay-in when the input TX is complete', async () => {
      const payIn = createCustomCryptoInput({
        id: 1,
        status: PayInStatus.ACKNOWLEDGED,
        purpose: PayInPurpose.BUY_FIAT,
      });
      jest.spyOn(payInEvmService, 'checkTransactionCompletion').mockResolvedValue(true);

      await strategy.checkConfirmations([payIn], PayInConfirmationType.INPUT);

      expect(payIn.isConfirmed).toBe(true);
      expect(payInRepo.update).toHaveBeenCalledWith(1, { isConfirmed: true, status: undefined });
    });
  });
});
