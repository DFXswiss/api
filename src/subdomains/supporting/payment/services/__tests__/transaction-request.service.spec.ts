import { createMock } from '@golevelup/ts-jest';
import { Test } from '@nestjs/testing';
import { SiftService } from 'src/integration/sift/services/sift.service';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { TestSharedModule } from 'src/shared/utils/test.shared.module';
import { TestUtil } from 'src/shared/utils/test.util';
import { BuyService } from 'src/subdomains/core/buy-crypto/routes/buy/buy.service';
import { SellService } from 'src/subdomains/core/sell-crypto/route/sell.service';
import { SwapService } from 'src/subdomains/core/buy-crypto/routes/swap/swap.service';
import { IsNull, Not } from 'typeorm';
import { FiatPaymentMethod } from '../../dto/payment-method.enum';
import {
  TransactionRequest,
  TransactionRequestStatus,
  TransactionRequestType,
} from '../../entities/transaction-request.entity';
import { TransactionRequestRepository } from '../../repositories/transaction-request.repository';
import { TransactionRequestService } from '../transaction-request.service';

describe('TransactionRequestService bank selection persistence', () => {
  it('stores bankId and virtualIbanId only on the internal BUY request entity', async () => {
    const repo = createMock<TransactionRequestRepository>();
    const sift = createMock<SiftService>();
    jest.spyOn(repo, 'create').mockImplementation((value) => value as TransactionRequest);
    jest
      .spyOn(repo, 'save')
      .mockImplementation(async (value) => Object.assign(value as TransactionRequest, { id: 99 }));

    const module = await Test.createTestingModule({
      imports: [TestSharedModule],
      providers: [
        TransactionRequestService,
        { provide: TransactionRequestRepository, useValue: repo },
        { provide: SiftService, useValue: sift },
        { provide: AssetService, useValue: createMock<AssetService>() },
        { provide: FiatService, useValue: createMock<FiatService>() },
        { provide: BuyService, useValue: createMock<BuyService>() },
        { provide: SellService, useValue: createMock<SellService>() },
        { provide: SwapService, useValue: createMock<SwapService>() },
        TestUtil.provideConfig(),
      ],
    }).compile();
    const service = module.get(TransactionRequestService);
    const request = { paymentMethod: FiatPaymentMethod.BANK } as any;
    const response = {
      id: 0,
      routeId: 42,
      amount: 100,
      estimatedAmount: 0.001,
      exchangeRate: 100000,
      rate: 101000,
      isValid: true,
      exactPrice: false,
      fees: { dfx: 1, network: 0, total: 1 },
      priceSteps: [],
      currency: { id: 2, name: 'EUR' },
      asset: { id: 10, name: 'BTC', blockchain: 'Bitcoin' },
    } as any;

    const entity = await service.create(TransactionRequestType.BUY, request, response, 1, {
      bankId: 19,
      virtualIbanId: 501,
    });

    expect(entity).toMatchObject({ bankId: 19, virtualIbanId: 501 });
    expect(repo.save).toHaveBeenCalledWith(expect.objectContaining({ bankId: 19, virtualIbanId: 501 }));
    expect(response).not.toHaveProperty('bankId');
    expect(response).not.toHaveProperty('virtualIbanId');
  });

  it('logs only bounded identifiers when persistence fails and never logs a customer IBAN', async () => {
    const repo = createMock<TransactionRequestRepository>();
    jest.spyOn(repo, 'create').mockImplementation((value) => value as TransactionRequest);
    jest.spyOn(repo, 'save').mockRejectedValue(new Error('database unavailable'));
    const module = await Test.createTestingModule({
      imports: [TestSharedModule],
      providers: [
        TransactionRequestService,
        { provide: TransactionRequestRepository, useValue: repo },
        { provide: SiftService, useValue: createMock<SiftService>() },
        { provide: AssetService, useValue: createMock<AssetService>() },
        { provide: FiatService, useValue: createMock<FiatService>() },
        { provide: BuyService, useValue: createMock<BuyService>() },
        { provide: SellService, useValue: createMock<SellService>() },
        { provide: SwapService, useValue: createMock<SwapService>() },
        TestUtil.provideConfig(),
      ],
    }).compile();
    const service = module.get(TransactionRequestService);
    const loggerError = jest.spyOn((service as any).logger, 'error').mockImplementation(() => undefined);
    const customerIban = 'LI75088110105923K000E';
    const request = { paymentMethod: FiatPaymentMethod.BANK, note: customerIban } as any;
    const response = {
      routeId: 42,
      amount: 100,
      estimatedAmount: 0.001,
      exchangeRate: 100000,
      rate: 101000,
      iban: customerIban,
      isValid: true,
      exactPrice: false,
      fees: { dfx: 1, network: 0, total: 1 },
      priceSteps: [],
      currency: { id: 2, name: 'EUR' },
      asset: { id: 10, name: 'BTC', blockchain: 'Bitcoin' },
    } as any;

    await expect(service.create(TransactionRequestType.BUY, request, response, 7)).rejects.toThrow(
      'database unavailable',
    );

    const logged = loggerError.mock.calls.flat().join(' ');
    expect(logged).toContain('routeId=42');
    expect(logged).toContain('userId=7');
    expect(logged).not.toContain(customerIban);
    expect(logged).not.toContain(JSON.stringify(request));
    expect(logged).not.toContain(JSON.stringify(response));
  });
});

describe('TransactionRequestService settlement persistence', () => {
  async function createService(
    repo: ReturnType<typeof createMock<TransactionRequestRepository>>,
  ): Promise<TransactionRequestService> {
    const module = await Test.createTestingModule({
      imports: [TestSharedModule],
      providers: [
        TransactionRequestService,
        { provide: TransactionRequestRepository, useValue: repo },
        { provide: SiftService, useValue: createMock<SiftService>() },
        { provide: AssetService, useValue: createMock<AssetService>() },
        { provide: FiatService, useValue: createMock<FiatService>() },
        { provide: BuyService, useValue: createMock<BuyService>() },
        { provide: SellService, useValue: createMock<SellService>() },
        { provide: SwapService, useValue: createMock<SwapService>() },
        TestUtil.provideConfig(),
      ],
    }).compile();

    return module.get(TransactionRequestService);
  }

  it('persists both the settlement tx and the settlement event id on completion', async () => {
    const repo = createMock<TransactionRequestRepository>();
    const service = await createService(repo);

    await service.complete(7, { txId: '0xTx', eventId: 'history-1-2-to' });

    expect(repo.update).toHaveBeenCalledWith(7, {
      isComplete: true,
      status: TransactionRequestStatus.COMPLETED,
      settlementTxId: '0xTx',
      settlementEventId: 'history-1-2-to',
    });
  });

  it('completes without touching the settlement fields when no settlement is given', async () => {
    const repo = createMock<TransactionRequestRepository>();
    const service = await createService(repo);

    await service.complete(7);

    const payload = repo.update.mock.calls[0][1];
    expect(payload).not.toHaveProperty('settlementTxId');
    expect(payload).not.toHaveProperty('settlementEventId');
  });

  it('returns consumed settlement event ids across all users', async () => {
    const repo = createMock<TransactionRequestRepository>();
    jest
      .spyOn(repo, 'find')
      .mockResolvedValue([{ settlementEventId: 'history-1-2-to' }, { settlementEventId: 'history-3-4-to' }] as any);
    const service = await createService(repo);

    const result = await service.getConsumedSettlementEventIds();

    expect(result).toEqual(['history-1-2-to', 'history-3-4-to']);
    expect(repo.find).toHaveBeenCalledWith({
      where: { settlementEventId: Not(IsNull()) },
      select: { settlementEventId: true },
    });
  });

  it('returns only the legacy settlement txs of one user', async () => {
    const repo = createMock<TransactionRequestRepository>();
    jest.spyOn(repo, 'find').mockResolvedValue([{ settlementTxId: '0xTxA' }, { settlementTxId: '0xTxB' }] as any);
    const service = await createService(repo);

    const result = await service.getLegacySettlementTxIds(42);

    expect(result).toEqual(['0xTxA', '0xTxB']);
    expect(repo.find).toHaveBeenCalledWith({
      where: { user: { id: 42 }, settlementTxId: Not(IsNull()), settlementEventId: IsNull() },
      select: { settlementTxId: true },
    });
  });
});
