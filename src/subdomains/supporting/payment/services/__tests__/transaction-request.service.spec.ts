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
import { FiatPaymentMethod } from '../../dto/payment-method.enum';
import { TransactionRequest, TransactionRequestType } from '../../entities/transaction-request.entity';
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
