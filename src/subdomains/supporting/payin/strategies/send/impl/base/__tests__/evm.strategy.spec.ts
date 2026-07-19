import { createMock } from '@golevelup/ts-jest';
import { Injectable } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ethers } from 'ethers';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { TxBroadcastError } from 'src/integration/blockchain/shared/errors/tx-broadcast.error';
import { AssetType } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { BlockchainAddress } from 'src/shared/models/blockchain-address';
import { TestSharedModule } from 'src/shared/utils/test.shared.module';
import { TestUtil } from 'src/shared/utils/test.util';
import { createCustomCryptoInput } from 'src/subdomains/supporting/payin/entities/__mocks__/crypto-input.entity.mock';
import {
  CryptoInput,
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
import { SendGroup, SendType } from '../send.strategy';
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

    it('marks the pay-in as failed on a reverted input TX', async () => {
      const payIn = createCustomCryptoInput({ id: 1, status: PayInStatus.ACKNOWLEDGED });
      jest
        .spyOn(payInEvmService, 'checkTransactionCompletion')
        .mockRejectedValue(new Error('Transaction 0x1234 has failed'));

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

  describe('dispatch designate-before-broadcast', () => {
    function createGroup() {
      const payIns = [
        createCustomCryptoInput({ id: 1, status: PayInStatus.PREPARED }),
        createCustomCryptoInput({ id: 2, status: PayInStatus.PREPARED }),
      ];
      const group = {
        payIns,
        status: PayInStatus.PREPARED,
        asset: payIns[0].asset,
      } as SendGroup;

      return { group, payIns };
    }

    it('persists Sending on every group member before calling the broadcast sink', async () => {
      const { group, payIns } = createGroup();
      const statusesAtSave: Array<PayInStatus | undefined> = [];
      const saveSpy = jest.spyOn(payInRepo, 'save').mockImplementation(async (payIn) => {
        statusesAtSave.push(payIn.status as PayInStatus);
        return payIn as CryptoInput;
      });
      const broadcastError = new TxBroadcastError('broadcast failed');
      const dispatchSpy = jest.spyOn(strategy as any, 'dispatchSend').mockRejectedValue(broadcastError);

      await expect(strategy['dispatch'](group, SendType.FORWARD, 0.01)).rejects.toBe(broadcastError);

      expect(statusesAtSave).toEqual([PayInStatus.SENDING, PayInStatus.SENDING]);
      expect(payIns.every((payIn) => payIn.status === PayInStatus.SENDING)).toBe(true);
      expect(saveSpy.mock.invocationCallOrder[1]).toBeLessThan(dispatchSpy.mock.invocationCallOrder[0]);
    });

    it('restores each captured status and rethrows a plain pre-broadcast error', async () => {
      const { group, payIns } = createGroup();
      const preBroadcastError = new Error('fee lookup failed');
      jest.spyOn(payInRepo, 'save').mockImplementation(async (payIn) => payIn as CryptoInput);
      jest.spyOn(strategy as any, 'dispatchSend').mockRejectedValue(preBroadcastError);

      await expect(strategy['dispatch'](group, SendType.FORWARD, 0.01)).rejects.toBe(preBroadcastError);

      expect(payIns.map((payIn) => payIn.status)).toEqual([PayInStatus.PREPARED, PayInStatus.PREPARED]);
      expect(payInRepo.save).toHaveBeenCalledTimes(4);
    });

    it('keeps every member Sending and rethrows an ambiguous TxBroadcastError', async () => {
      const { group, payIns } = createGroup();
      const broadcastError = new TxBroadcastError('RPC timeout');
      jest.spyOn(payInRepo, 'save').mockImplementation(async (payIn) => payIn as CryptoInput);
      jest.spyOn(strategy as any, 'dispatchSend').mockRejectedValue(broadcastError);

      await expect(strategy['dispatch'](group, SendType.FORWARD, 0.01)).rejects.toBe(broadcastError);

      expect(payIns.map((payIn) => payIn.status)).toEqual([PayInStatus.SENDING, PayInStatus.SENDING]);
      expect(payInRepo.save).toHaveBeenCalledTimes(2);
    });

    it('keeps every member Sending and logs the tx id when persistence fails after dispatch', async () => {
      const { group, payIns } = createGroup();
      const outTxId = '0xdispatched';
      const persistenceError = new Error('query timeout');
      jest.spyOn(payInRepo, 'save').mockImplementation(async (payIn) => payIn as CryptoInput);
      jest.spyOn(strategy as any, 'dispatchSend').mockResolvedValue(outTxId);
      jest.spyOn(strategy as any, 'updatePayInsWithSendData').mockRejectedValue(persistenceError);
      const logSpy = jest.spyOn(strategy['logger'], 'error').mockImplementation();

      await expect(strategy['dispatch'](group, SendType.FORWARD, 0.01)).rejects.toBe(persistenceError);

      expect(payIns.map((payIn) => payIn.status)).toEqual([PayInStatus.SENDING, PayInStatus.SENDING]);
      expect(payInRepo.save).toHaveBeenCalledTimes(2);
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining(outTxId), persistenceError);
      expect(logSpy.mock.calls[0][0]).toContain('1, 2');
    });
  });
});
