import { createMock } from '@golevelup/ts-jest';
import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { GetConfig } from 'src/config/config';
import { createCustomAsset } from 'src/shared/models/asset/__mocks__/asset.entity.mock';
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
  // the settlement filter now requires from == issuer (brokerbot), so the fixture must use the
  // address the service itself reads via GetConfig() — GetConfig() reads process.env directly on
  // every call (bypassing TestUtil.provideConfig()/the injected ConfigService), so this always
  // matches whatever RealUnitJobService computes in its constructor, regardless of ENVIRONMENT
  const brokerbotAddress = GetConfig().blockchain.realunit.brokerbotAddress;

  const quote = {
    id: 10,
    estimatedAmount: 72.123,
    created: new Date('2026-06-29T16:00:00Z'),
    user: { id: 42, address: userAddress },
  };

  const settlementEvent = {
    id: 'history-25631176-470-to',
    txHash: '0xSettlementTx',
    timestamp: new Date('2026-06-30T09:04:00Z'),
    transfer: { from: brokerbotAddress, to: userAddress, value: '72' },
  };

  function mockHistory(events: any[]): void {
    jest.spyOn(realunitService, 'getAccountHistory').mockResolvedValue({ history: events } as any);
  }

  beforeEach(async () => {
    realunitService = createMock<RealUnitService>();
    transactionRequestService = createMock<TransactionRequestService>();

    jest.spyOn(realunitService, 'getRealuAsset').mockResolvedValue(realuAsset);
    jest.spyOn(transactionRequestService, 'getConsumedSettlementEventIds').mockResolvedValue([]);
    jest.spyOn(transactionRequestService, 'getLegacySettlementTxIds').mockResolvedValue([]);
    jest.spyOn(transactionRequestService, 'completeSettlement').mockResolvedValue(true);

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

    expect(transactionRequestService.completeSettlement).toHaveBeenCalledWith(10, {
      txId: '0xSettlementTx',
      eventId: 'history-25631176-470-to',
    });
  });

  it('should not complete a quote when the transfer amount does not match', async () => {
    jest.spyOn(transactionRequestService, 'getOpenBuyQuotes').mockResolvedValue([quote] as any);
    mockHistory([{ ...settlementEvent, transfer: { ...settlementEvent.transfer, value: '71' } }]);

    await service.completeSettledQuotes();

    expect(transactionRequestService.completeSettlement).not.toHaveBeenCalled();
  });

  it('should not complete a quote for a transfer that predates the quote', async () => {
    jest.spyOn(transactionRequestService, 'getOpenBuyQuotes').mockResolvedValue([quote] as any);
    mockHistory([{ ...settlementEvent, timestamp: new Date('2026-06-25T10:00:00Z') }]);

    await service.completeSettledQuotes();

    expect(transactionRequestService.completeSettlement).not.toHaveBeenCalled();
  });

  it('should ignore outgoing transfers', async () => {
    jest.spyOn(transactionRequestService, 'getOpenBuyQuotes').mockResolvedValue([quote] as any);
    mockHistory([{ ...settlementEvent, transfer: { from: userAddress, to: '0xOther', value: '72' } }]);

    await service.completeSettledQuotes();

    expect(transactionRequestService.completeSettlement).not.toHaveBeenCalled();
  });

  it('should ignore non-transfer events', async () => {
    jest.spyOn(transactionRequestService, 'getOpenBuyQuotes').mockResolvedValue([quote] as any);
    mockHistory([
      {
        id: 'history-25631176-470-approval',
        txHash: '0xApprovalTx',
        timestamp: settlementEvent.timestamp,
        approval: { value: '72' },
      },
    ]);

    await service.completeSettledQuotes();

    expect(transactionRequestService.completeSettlement).not.toHaveBeenCalled();
  });

  it('should settle at most one quote per settlement tx within a run', async () => {
    const secondQuote = { ...quote, id: 11 };
    jest.spyOn(transactionRequestService, 'getOpenBuyQuotes').mockResolvedValue([quote, secondQuote] as any);
    mockHistory([settlementEvent]);

    await service.completeSettledQuotes();

    expect(transactionRequestService.completeSettlement).toHaveBeenCalledTimes(1);
    expect(transactionRequestService.completeSettlement).toHaveBeenCalledWith(10, {
      txId: '0xSettlementTx',
      eventId: 'history-25631176-470-to',
    });
  });

  it('should not reuse a settlement transfer that already completed a quote in an earlier run', async () => {
    jest.spyOn(transactionRequestService, 'getOpenBuyQuotes').mockResolvedValue([quote] as any);
    jest
      .spyOn(transactionRequestService, 'getConsumedSettlementEventIds')
      .mockResolvedValue(['history-25631176-470-to']);
    mockHistory([settlementEvent]);

    await service.completeSettledQuotes();

    expect(transactionRequestService.completeSettlement).not.toHaveBeenCalled();
  });

  it('should complete multiple quotes settled in a single batch tx', async () => {
    const smallQuote = { ...quote, id: 10, estimatedAmount: 219.71 };
    const largeQuote = { ...quote, id: 11, estimatedAmount: 22047 };
    jest.spyOn(transactionRequestService, 'getOpenBuyQuotes').mockResolvedValue([smallQuote, largeQuote] as any);
    mockHistory([
      {
        ...settlementEvent,
        id: 'history-25631176-219-to',
        txHash: '0xBatchTx',
        transfer: { ...settlementEvent.transfer, value: '219' },
      },
      {
        ...settlementEvent,
        id: 'history-25631176-22047-to',
        txHash: '0xBatchTx',
        transfer: { ...settlementEvent.transfer, value: '22047' },
      },
    ]);

    await service.completeSettledQuotes();

    expect(transactionRequestService.completeSettlement).toHaveBeenCalledTimes(2);
    expect(transactionRequestService.completeSettlement).toHaveBeenCalledWith(10, {
      txId: '0xBatchTx',
      eventId: 'history-25631176-219-to',
    });
    expect(transactionRequestService.completeSettlement).toHaveBeenCalledWith(11, {
      txId: '0xBatchTx',
      eventId: 'history-25631176-22047-to',
    });
  });

  it('should complete a quote from a batch tx whose other transfer already settled an earlier request', async () => {
    const largeQuote = { ...quote, id: 11, estimatedAmount: 22047 };
    jest.spyOn(transactionRequestService, 'getOpenBuyQuotes').mockResolvedValue([largeQuote] as any);
    jest
      .spyOn(transactionRequestService, 'getConsumedSettlementEventIds')
      .mockResolvedValue(['history-25631176-219-to']);
    mockHistory([
      {
        ...settlementEvent,
        id: 'history-25631176-219-to',
        txHash: '0xBatchTx',
        transfer: { ...settlementEvent.transfer, value: '219' },
      },
      {
        ...settlementEvent,
        id: 'history-25631176-22047-to',
        txHash: '0xBatchTx',
        transfer: { ...settlementEvent.transfer, value: '22047' },
      },
    ]);

    await service.completeSettledQuotes();

    expect(transactionRequestService.completeSettlement).toHaveBeenCalledWith(11, {
      txId: '0xBatchTx',
      eventId: 'history-25631176-22047-to',
    });
  });

  it('should not reuse a same-amount transfer within a batch tx across runs', async () => {
    jest.spyOn(transactionRequestService, 'getOpenBuyQuotes').mockResolvedValue([quote] as any);
    jest
      .spyOn(transactionRequestService, 'getConsumedSettlementEventIds')
      .mockResolvedValue(['history-25631176-470-to']);
    mockHistory([{ ...settlementEvent, txHash: '0xBatchTx' }]);

    await service.completeSettledQuotes();

    expect(transactionRequestService.completeSettlement).not.toHaveBeenCalled();
  });

  it('should complete a second same-amount quote when the batch tx contains two matching transfers', async () => {
    jest.spyOn(transactionRequestService, 'getOpenBuyQuotes').mockResolvedValue([quote] as any);
    jest
      .spyOn(transactionRequestService, 'getConsumedSettlementEventIds')
      .mockResolvedValue(['history-25631176-470-to']);
    mockHistory([
      { ...settlementEvent, id: 'history-25631176-470-to', txHash: '0xBatchTx' },
      {
        ...settlementEvent,
        id: 'history-25631177-471-to',
        txHash: '0xBatchTx',
        timestamp: new Date('2026-06-30T09:04:00Z'),
      },
    ]);

    await service.completeSettledQuotes();

    expect(transactionRequestService.completeSettlement).toHaveBeenCalledWith(10, {
      txId: '0xBatchTx',
      eventId: 'history-25631177-471-to',
    });
  });

  it('should complete a quote when the consumed transfer is not the first event of the batch tx', async () => {
    const largeQuote = { ...quote, id: 11, estimatedAmount: 22047 };
    jest.spyOn(transactionRequestService, 'getOpenBuyQuotes').mockResolvedValue([largeQuote] as any);
    jest
      .spyOn(transactionRequestService, 'getConsumedSettlementEventIds')
      .mockResolvedValue(['history-25631176-219-to']);
    // the consumed transfer is the second event here, so a tx-hash-only match would skip the wrong one
    mockHistory([
      {
        ...settlementEvent,
        id: 'history-25631176-22047-to',
        txHash: '0xBatchTx',
        transfer: { ...settlementEvent.transfer, value: '22047' },
      },
      {
        ...settlementEvent,
        id: 'history-25631176-219-to',
        txHash: '0xBatchTx',
        transfer: { ...settlementEvent.transfer, value: '219' },
      },
    ]);

    await service.completeSettledQuotes();

    expect(transactionRequestService.completeSettlement).toHaveBeenCalledWith(11, {
      txId: '0xBatchTx',
      eventId: 'history-25631176-22047-to',
    });
  });

  it('should match the oldest unused settlement transfer', async () => {
    const laterEvent = {
      ...settlementEvent,
      id: 'history-25631200-999-to',
      txHash: '0xLaterTx',
      timestamp: new Date('2026-07-01T12:00:00Z'),
    };
    jest.spyOn(transactionRequestService, 'getOpenBuyQuotes').mockResolvedValue([quote] as any);
    mockHistory([laterEvent, settlementEvent]); // ponder returns newest first

    await service.completeSettledQuotes();

    expect(transactionRequestService.completeSettlement).toHaveBeenCalledWith(10, {
      txId: '0xSettlementTx',
      eventId: 'history-25631176-470-to',
    });
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

    expect(transactionRequestService.completeSettlement).toHaveBeenCalledTimes(1);
    expect(transactionRequestService.completeSettlement).toHaveBeenCalledWith(11, {
      txId: '0xSettlementTx',
      eventId: 'history-25631176-470-to',
    });
  });

  it('should not reuse a settlement tx that completed a request before event ids were recorded', async () => {
    jest.spyOn(transactionRequestService, 'getOpenBuyQuotes').mockResolvedValue([quote] as any);
    jest.spyOn(transactionRequestService, 'getLegacySettlementTxIds').mockResolvedValue(['0xBatchTx']);
    mockHistory([{ ...settlementEvent, id: 'history-25631176-999-to', txHash: '0xBatchTx' }]);

    await service.completeSettledQuotes();

    expect(transactionRequestService.completeSettlement).not.toHaveBeenCalled();
  });

  it('should complete a quote from a tx unrelated to a legacy settlement', async () => {
    jest.spyOn(transactionRequestService, 'getOpenBuyQuotes').mockResolvedValue([quote] as any);
    jest.spyOn(transactionRequestService, 'getLegacySettlementTxIds').mockResolvedValue(['0xBatchTx']);
    mockHistory([{ ...settlementEvent, id: 'history-25631176-999-to', txHash: '0xUnrelatedTx' }]);

    await service.completeSettledQuotes();

    expect(transactionRequestService.completeSettlement).toHaveBeenCalledWith(10, {
      txId: '0xUnrelatedTx',
      eventId: 'history-25631176-999-to',
    });
  });

  it('should distinguish two identical transfers of the same tx by their event id', async () => {
    const secondQuote = { ...quote, id: 11 };
    jest.spyOn(transactionRequestService, 'getOpenBuyQuotes').mockResolvedValue([quote, secondQuote] as any);
    mockHistory([
      { ...settlementEvent, id: 'history-25631176-470-to' },
      { ...settlementEvent, id: 'history-25631176-471-to', timestamp: new Date('2026-06-30T09:05:00Z') },
    ]);

    await service.completeSettledQuotes();

    expect(transactionRequestService.completeSettlement).toHaveBeenCalledTimes(2);
    expect(transactionRequestService.completeSettlement).toHaveBeenCalledWith(10, {
      txId: '0xSettlementTx',
      eventId: 'history-25631176-470-to',
    });
    expect(transactionRequestService.completeSettlement).toHaveBeenCalledWith(11, {
      txId: '0xSettlementTx',
      eventId: 'history-25631176-471-to',
    });
  });

  it('should ignore a self-transfer that the indexer records twice for the same account', async () => {
    const secondQuote = { ...quote, id: 11 };
    jest.spyOn(transactionRequestService, 'getOpenBuyQuotes').mockResolvedValue([quote, secondQuote] as any);
    // from == to, so the ponder writes both a -to and a -from row to this account's history, each
    // carrying the same transfer — a receiver-only filter would settle both quotes from one transfer
    mockHistory([
      {
        ...settlementEvent,
        id: 'history-25631176-470-to',
        transfer: { from: userAddress, to: userAddress, value: '72' },
      },
      {
        ...settlementEvent,
        id: 'history-25631176-470-from',
        transfer: { from: userAddress, to: userAddress, value: '72' },
      },
    ]);

    await service.completeSettledQuotes();

    expect(transactionRequestService.completeSettlement).not.toHaveBeenCalled();
  });

  it('should ignore a transfer that did not come from the issuer', async () => {
    jest.spyOn(transactionRequestService, 'getOpenBuyQuotes').mockResolvedValue([quote] as any);
    mockHistory([{ ...settlementEvent, transfer: { from: '0xSomeOtherWallet', to: userAddress, value: '72' } }]);

    await service.completeSettledQuotes();

    expect(transactionRequestService.completeSettlement).not.toHaveBeenCalled();
  });

  it('should not reuse an event that another account with the same address already consumed', async () => {
    jest.spyOn(transactionRequestService, 'getOpenBuyQuotes').mockResolvedValue([quote] as any);
    jest
      .spyOn(transactionRequestService, 'getConsumedSettlementEventIds')
      .mockResolvedValue(['history-25631176-470-to']);
    mockHistory([settlementEvent]);

    await service.completeSettledQuotes();

    expect(transactionRequestService.completeSettlement).not.toHaveBeenCalled();
  });

  it('should leave the event available when another instance claimed the quote first', async () => {
    const secondQuote = { ...quote, id: 11 };
    jest.spyOn(transactionRequestService, 'getOpenBuyQuotes').mockResolvedValue([quote, secondQuote] as any);
    jest.spyOn(transactionRequestService, 'completeSettlement').mockResolvedValue(false);
    mockHistory([settlementEvent]);

    await service.completeSettledQuotes();

    expect(transactionRequestService.completeSettlement).toHaveBeenCalledTimes(2);
    expect(transactionRequestService.completeSettlement).toHaveBeenCalledWith(10, {
      txId: '0xSettlementTx',
      eventId: 'history-25631176-470-to',
    });
    expect(transactionRequestService.completeSettlement).toHaveBeenCalledWith(11, {
      txId: '0xSettlementTx',
      eventId: 'history-25631176-470-to',
    });
  });

  it('should ignore an issuer transfer addressed to someone else', async () => {
    jest.spyOn(transactionRequestService, 'getOpenBuyQuotes').mockResolvedValue([quote] as any);
    // right issuer, right amount, right time — only the recipient differs
    mockHistory([{ ...settlementEvent, transfer: { from: brokerbotAddress, to: '0xOtherAddress', value: '72' } }]);

    await service.completeSettledQuotes();

    expect(transactionRequestService.completeSettlement).not.toHaveBeenCalled();
  });

  it('should ignore a self-transfer of the issuer to itself', async () => {
    // for an account whose own address is the issuer's, both rows of a self-transfer pass the
    // recipient and the issuer check — only the explicit guard keeps them from settling two quotes
    const issuerQuote = { ...quote, id: 12, user: { id: 44, address: brokerbotAddress } };
    const secondIssuerQuote = { ...issuerQuote, id: 13 };
    jest
      .spyOn(transactionRequestService, 'getOpenBuyQuotes')
      .mockResolvedValue([issuerQuote, secondIssuerQuote] as any);
    mockHistory([
      {
        ...settlementEvent,
        id: 'history-25631176-470-to',
        transfer: { from: brokerbotAddress, to: brokerbotAddress, value: '72' },
      },
      {
        ...settlementEvent,
        id: 'history-25631176-470-from',
        transfer: { from: brokerbotAddress, to: brokerbotAddress, value: '72' },
      },
    ]);

    await service.completeSettledQuotes();

    expect(transactionRequestService.completeSettlement).not.toHaveBeenCalled();
  });
});
