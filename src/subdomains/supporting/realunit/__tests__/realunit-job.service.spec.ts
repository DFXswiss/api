import { createMock } from '@golevelup/ts-jest';
import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { createCustomAsset } from 'src/shared/models/asset/__mocks__/asset.entity.mock';
import * as processServiceModule from 'src/shared/services/process.service';
import { TestSharedModule } from 'src/shared/utils/test.shared.module';
import { TestUtil } from 'src/shared/utils/test.util';
import { TransactionRequestService } from 'src/subdomains/supporting/payment/services/transaction-request.service';
import { RealUnitJobService } from '../realunit-job.service';
import { RealUnitService } from '../realunit.service';

describe('RealUnitJobService', () => {
  let service: RealUnitJobService;

  let realunitService: RealUnitService;
  let transactionRequestService: TransactionRequestService;

  const realuAsset = createCustomAsset({ id: 1, name: 'REALU' });
  const userAddress = '0xUserAddress';

  const quote = {
    id: 10,
    estimatedAmount: 72.123,
    created: new Date('2026-06-29T16:00:00Z'),
    user: { address: userAddress },
  };

  const settlementEvent = {
    txHash: '0xSettlementTx',
    timestamp: new Date('2026-06-30T09:04:00Z'),
    transfer: { from: '0xBrokerbot', to: userAddress, value: '72' },
  };

  function mockHistory(events: any[]): void {
    jest.spyOn(realunitService, 'getAccountHistory').mockResolvedValue({ history: events } as any);
  }

  beforeEach(async () => {
    realunitService = createMock<RealUnitService>();
    transactionRequestService = createMock<TransactionRequestService>();

    jest.spyOn(processServiceModule, 'DisabledProcess').mockReturnValue(false);
    jest.spyOn(realunitService, 'getRealuAsset').mockResolvedValue(realuAsset);

    const module: TestingModule = await Test.createTestingModule({
      imports: [TestSharedModule],
      providers: [
        RealUnitJobService,
        { provide: RealUnitService, useValue: realunitService },
        { provide: TransactionRequestService, useValue: transactionRequestService },

        TestUtil.provideConfig(),
      ],
    }).compile();

    service = module.get<RealUnitJobService>(RealUnitJobService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should complete a quote when the shares arrived on-chain after quote creation', async () => {
    jest.spyOn(transactionRequestService, 'getOpenBuyQuotes').mockResolvedValue([quote] as any);
    mockHistory([settlementEvent]);

    await service.completeSettledQuotes();

    expect(transactionRequestService.complete).toHaveBeenCalledWith(10);
  });

  it('should not complete a quote when the transfer amount does not match', async () => {
    jest.spyOn(transactionRequestService, 'getOpenBuyQuotes').mockResolvedValue([quote] as any);
    mockHistory([{ ...settlementEvent, transfer: { ...settlementEvent.transfer, value: '71' } }]);

    await service.completeSettledQuotes();

    expect(transactionRequestService.complete).not.toHaveBeenCalled();
  });

  it('should not complete a quote for a transfer that predates the quote', async () => {
    jest.spyOn(transactionRequestService, 'getOpenBuyQuotes').mockResolvedValue([quote] as any);
    mockHistory([{ ...settlementEvent, timestamp: new Date('2026-06-25T10:00:00Z') }]);

    await service.completeSettledQuotes();

    expect(transactionRequestService.complete).not.toHaveBeenCalled();
  });

  it('should ignore outgoing transfers', async () => {
    jest.spyOn(transactionRequestService, 'getOpenBuyQuotes').mockResolvedValue([quote] as any);
    mockHistory([{ ...settlementEvent, transfer: { from: userAddress, to: '0xOther', value: '72' } }]);

    await service.completeSettledQuotes();

    expect(transactionRequestService.complete).not.toHaveBeenCalled();
  });

  it('should ignore non-transfer events', async () => {
    jest.spyOn(transactionRequestService, 'getOpenBuyQuotes').mockResolvedValue([quote] as any);
    mockHistory([{ txHash: '0xApprovalTx', timestamp: settlementEvent.timestamp, approval: { value: '72' } }]);

    await service.completeSettledQuotes();

    expect(transactionRequestService.complete).not.toHaveBeenCalled();
  });

  it('should settle at most one quote per settlement tx', async () => {
    const secondQuote = { ...quote, id: 11 };
    jest.spyOn(transactionRequestService, 'getOpenBuyQuotes').mockResolvedValue([quote, secondQuote] as any);
    mockHistory([settlementEvent]);

    await service.completeSettledQuotes();

    expect(transactionRequestService.complete).toHaveBeenCalledTimes(1);
    expect(transactionRequestService.complete).toHaveBeenCalledWith(10);
  });

  it('should continue with the next quote when an account is not indexed yet', async () => {
    const secondQuote = { ...quote, id: 11, user: { address: '0xIndexedAddress' } };
    jest.spyOn(transactionRequestService, 'getOpenBuyQuotes').mockResolvedValue([quote, secondQuote] as any);
    jest
      .spyOn(realunitService, 'getAccountHistory')
      .mockRejectedValueOnce(new NotFoundException('Account not found'))
      .mockResolvedValueOnce({
        history: [{ ...settlementEvent, transfer: { ...settlementEvent.transfer, to: '0xIndexedAddress' } }],
      } as any);

    await service.completeSettledQuotes();

    expect(transactionRequestService.complete).toHaveBeenCalledTimes(1);
    expect(transactionRequestService.complete).toHaveBeenCalledWith(11);
  });

  it('should do nothing when the process is disabled', async () => {
    jest.spyOn(processServiceModule, 'DisabledProcess').mockReturnValue(true);

    await service.completeSettledQuotes();

    expect(realunitService.getRealuAsset).not.toHaveBeenCalled();
    expect(transactionRequestService.complete).not.toHaveBeenCalled();
  });
});
