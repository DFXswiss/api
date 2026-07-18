import { createMock } from '@golevelup/ts-jest';
import { Injectable } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { TxBroadcastError } from 'src/integration/blockchain/shared/errors/tx-broadcast.error';
import { AssetType } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { BlockchainAddress } from 'src/shared/models/blockchain-address';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { TestSharedModule } from 'src/shared/utils/test.shared.module';
import { TestUtil } from 'src/shared/utils/test.util';
import { createCustomCryptoInput } from 'src/subdomains/supporting/payin/entities/__mocks__/crypto-input.entity.mock';
import {
  CryptoInput,
  PayInConfirmationType,
  PayInStatus,
} from 'src/subdomains/supporting/payin/entities/crypto-input.entity';
import { PayInRepository } from 'src/subdomains/supporting/payin/repositories/payin.repository';
import { TransactionHelper } from 'src/subdomains/supporting/payment/services/transaction-helper';
import { PayoutService } from 'src/subdomains/supporting/payout/services/payout.service';
import { PricingService } from 'src/subdomains/supporting/pricing/services/pricing.service';
import { SendStrategyRegistry } from '../send.strategy-registry';
import { SendStrategy, SendType } from '../send.strategy';

@Injectable()
class TestSendStrategy extends SendStrategy {
  protected readonly logger = new DfxLogger(TestSendStrategy);

  constructor(private readonly payInRepo: PayInRepository) {
    super();
  }

  get blockchain(): Blockchain {
    return Blockchain.BITCOIN;
  }

  get assetType(): AssetType {
    return AssetType.COIN;
  }

  get forwardRequired(): boolean {
    return true;
  }

  doSend(_payIns: CryptoInput[], _type: SendType): Promise<void> {
    return Promise.resolve();
  }

  checkConfirmations(_payIns: CryptoInput[], _direction: PayInConfirmationType): Promise<void> {
    return Promise.resolve();
  }

  protected getForwardAddress(): BlockchainAddress {
    throw new Error('Method not implemented');
  }

  send(payIn: CryptoInput, broadcast: () => Promise<{ outTxId: string; feeAmount?: number }>): Promise<void> {
    return this.sendWithBroadcastBoundary(this.payInRepo, payIn, SendType.FORWARD, broadcast);
  }
}

describe('SendStrategy', () => {
  let strategy: TestSendStrategy;
  let payInRepo: PayInRepository;

  beforeEach(async () => {
    payInRepo = createMock<PayInRepository>();

    const module: TestingModule = await Test.createTestingModule({
      imports: [TestSharedModule],
      providers: [
        TestSendStrategy,
        { provide: PayInRepository, useValue: payInRepo },
        { provide: TransactionHelper, useValue: createMock<TransactionHelper>() },
        { provide: PricingService, useValue: createMock<PricingService>() },
        { provide: PayoutService, useValue: createMock<PayoutService>() },
        { provide: SendStrategyRegistry, useValue: createMock<SendStrategyRegistry>() },
        { provide: AssetService, useValue: createMock<AssetService>() },
        TestUtil.provideConfig(),
      ],
    }).compile();

    strategy = module.get<TestSendStrategy>(TestSendStrategy);
  });

  it('persists Sending before calling the broadcast sink', async () => {
    const payIn = createCustomCryptoInput({ id: 1, status: PayInStatus.PREPARED });
    const statusesAtSave: Array<PayInStatus | undefined> = [];
    const saveSpy = jest.spyOn(payInRepo, 'save').mockImplementation(async (savedPayIn) => {
      statusesAtSave.push(savedPayIn.status);
      return savedPayIn as CryptoInput;
    });
    const broadcastError = new TxBroadcastError('broadcast failed');
    const broadcast = jest.fn().mockRejectedValue(broadcastError);

    await expect(strategy.send(payIn, broadcast)).rejects.toBe(broadcastError);

    expect(statusesAtSave).toEqual([PayInStatus.SENDING]);
    expect(saveSpy.mock.invocationCallOrder[0]).toBeLessThan(broadcast.mock.invocationCallOrder[0]);
  });

  it('keeps Sending and rethrows an ambiguous TxBroadcastError', async () => {
    const payIn = createCustomCryptoInput({ id: 1, status: PayInStatus.PREPARED });
    const broadcastError = new TxBroadcastError('RPC timeout');
    jest.spyOn(payInRepo, 'save').mockImplementation(async (savedPayIn) => savedPayIn as CryptoInput);

    await expect(strategy.send(payIn, () => Promise.reject(broadcastError))).rejects.toBe(broadcastError);

    expect(payIn.status).toBe(PayInStatus.SENDING);
    expect(payInRepo.save).toHaveBeenCalledTimes(1);
  });

  it('keeps Sending and rethrows when persistence fails after broadcast', async () => {
    const payIn = createCustomCryptoInput({ id: 1, status: PayInStatus.PREPARED });
    const persistenceError = new Error('query timeout');
    jest.spyOn(payInRepo, 'save').mockImplementation(async (savedPayIn) => savedPayIn as CryptoInput);
    jest.spyOn(strategy as any, 'updatePayInWithSendData').mockRejectedValue(persistenceError);

    await expect(strategy.send(payIn, () => Promise.resolve({ outTxId: 'tx-id' }))).rejects.toBe(persistenceError);

    expect(payIn.status).toBe(PayInStatus.SENDING);
    expect(payInRepo.save).toHaveBeenCalledTimes(1);
  });

  it('restores the captured status and rethrows a plain pre-broadcast error', async () => {
    const payIn = createCustomCryptoInput({ id: 1, status: PayInStatus.PREPARED });
    const preBroadcastError = new Error('fee lookup failed');
    jest.spyOn(payInRepo, 'save').mockImplementation(async (savedPayIn) => savedPayIn as CryptoInput);

    await expect(strategy.send(payIn, () => Promise.reject(preBroadcastError))).rejects.toBe(preBroadcastError);

    expect(payIn.status).toBe(PayInStatus.PREPARED);
    expect(payInRepo.save).toHaveBeenCalledTimes(2);
  });

  it('keeps SENDING and rethrows a TxBroadcastError when broadcast resolves with an empty outTxId', async () => {
    const payIn = createCustomCryptoInput({ id: 1, status: PayInStatus.PREPARED });
    const broadcast = () => Promise.resolve({ outTxId: '' });
    jest.spyOn(payInRepo, 'save').mockImplementation(async (savedPayIn) => savedPayIn as CryptoInput);

    await expect(strategy.send(payIn, broadcast)).rejects.toBeInstanceOf(TxBroadcastError);

    expect(payIn.status).toBe(PayInStatus.SENDING);
    expect(payInRepo.save).toHaveBeenCalledTimes(1);
  });

  it('persists the forwarded pay-in on a fully successful broadcast', async () => {
    const payIn = createCustomCryptoInput({ id: 1, status: PayInStatus.PREPARED });
    const broadcast = () => Promise.resolve({ outTxId: '0xsent', feeAmount: 0.01 });
    jest.spyOn(payInRepo, 'save').mockImplementation(async (savedPayIn) => savedPayIn as CryptoInput);
    jest
      .spyOn(strategy as any, 'updatePayInWithSendData')
      .mockImplementation(async (payIn: CryptoInput, _type: unknown, outTxId: string, feeAmount?: number) =>
        payIn.forward(outTxId, feeAmount),
      );

    await expect(strategy.send(payIn, broadcast)).resolves.toBeUndefined();

    expect(strategy['updatePayInWithSendData']).toHaveBeenCalledWith(payIn, expect.anything(), '0xsent', 0.01);
    expect(payInRepo.save).toHaveBeenCalledTimes(2);
    expect(payIn.status).toBe(PayInStatus.FORWARDED);
  });

  it('keeps the DB marker fail-closed when the SECOND save fails after a successful broadcast', async () => {
    const payIn = createCustomCryptoInput({ id: 1, status: PayInStatus.PREPARED });
    const broadcast = () => Promise.resolve({ outTxId: '0xsent', feeAmount: 0 });
    jest
      .spyOn(strategy as any, 'updatePayInWithSendData')
      .mockImplementation(async (payIn: CryptoInput, _type: unknown, outTxId: string, feeAmount?: number) =>
        payIn.forward(outTxId, feeAmount),
      );
    const persistenceError = new Error('connection reset');
    jest.spyOn(payInRepo, 'save').mockResolvedValueOnce(payIn).mockRejectedValueOnce(persistenceError);

    await expect(strategy.send(payIn, broadcast)).rejects.toBe(persistenceError);

    expect(payIn.status).toBe(PayInStatus.FORWARDED);
    expect(payInRepo.save).toHaveBeenCalledTimes(2);
  });
});
