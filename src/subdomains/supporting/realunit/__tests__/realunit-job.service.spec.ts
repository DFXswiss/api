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
    user: { id: 42, address: userAddress },
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
    jest.spyOn(transactionRequestService, 'getUsedSettlementTxIds').mockResolvedValue([]);

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

    expect(transactionRequestService.complete).toHaveBeenCalledWith(10, '0xSettlementTx');
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

  it('should settle at most one quote per settlement tx within a run', async () => {
    const secondQuote = { ...quote, id: 11 };
    jest.spyOn(transactionRequestService, 'getOpenBuyQuotes').mockResolvedValue([quote, secondQuote] as any);
    mockHistory([settlementEvent]);

    await service.completeSettledQuotes();

    expect(transactionRequestService.complete).toHaveBeenCalledTimes(1);
    expect(transactionRequestService.complete).toHaveBeenCalledWith(10, '0xSettlementTx');
  });

  it('should not reuse a settlement tx that already completed a quote in an earlier run', async () => {
    jest.spyOn(transactionRequestService, 'getOpenBuyQuotes').mockResolvedValue([quote] as any);
    jest.spyOn(transactionRequestService, 'getUsedSettlementTxIds').mockResolvedValue(['0xSettlementTx']);
    mockHistory([settlementEvent]);

    await service.completeSettledQuotes();

    expect(transactionRequestService.complete).not.toHaveBeenCalled();
  });

  it('should match the oldest unused settlement transfer', async () => {
    const laterEvent = { ...settlementEvent, txHash: '0xLaterTx', timestamp: new Date('2026-07-01T12:00:00Z') };
    jest.spyOn(transactionRequestService, 'getOpenBuyQuotes').mockResolvedValue([quote] as any);
    mockHistory([laterEvent, settlementEvent]); // ponder returns newest first

    await service.completeSettledQuotes();

    expect(transactionRequestService.complete).toHaveBeenCalledWith(10, '0xSettlementTx');
  });

  it('should fetch the account history only once per address', async () => {
    const secondQuote = { ...quote, id: 11, estimatedAmount: 100 };
    jest.spyOn(transactionRequestService, 'getOpenBuyQuotes').mockResolvedValue([quote, secondQuote] as any);
    mockHistory([settlementEvent]);

    await service.completeSettledQuotes();

    expect(realunitService.getAccountHistory).toHaveBeenCalledTimes(1);
  });

  it('should continue with the next quote when an account is not indexed yet', async () => {
    const secondQuote = { ...quote, id: 11, user: { id: 43, address: '0xIndexedAddress' } };
    jest.spyOn(transactionRequestService, 'getOpenBuyQuotes').mockResolvedValue([quote, secondQuote] as any);
    jest
      .spyOn(realunitService, 'getAccountHistory')
      .mockRejectedValueOnce(new NotFoundException('Account not found'))
      .mockResolvedValueOnce({
        history: [{ ...settlementEvent, transfer: { ...settlementEvent.transfer, to: '0xIndexedAddress' } }],
      } as any);

    await service.completeSettledQuotes();

    expect(transactionRequestService.complete).toHaveBeenCalledTimes(1);
    expect(transactionRequestService.complete).toHaveBeenCalledWith(11, '0xSettlementTx');
  });

  it('should do nothing when the process is disabled', async () => {
    jest.spyOn(processServiceModule, 'DisabledProcess').mockReturnValue(true);

    await service.completeSettledQuotes();

    expect(realunitService.getRealuAsset).not.toHaveBeenCalled();
    expect(transactionRequestService.complete).not.toHaveBeenCalled();
  });
});
