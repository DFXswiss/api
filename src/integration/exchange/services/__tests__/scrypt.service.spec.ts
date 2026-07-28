import {
  ScryptBalanceTransaction,
  ScryptOrderStatus,
  ScryptTransactionStatus,
  ScryptTransactionType,
} from '../../dto/scrypt.dto';
import {
  ScryptAmendRejectedError,
  ScryptMessageType,
  ScryptRequestTimeoutError,
  ScryptUnconfirmedWriteError,
  ScryptVenueRejectionError,
  ScryptWebSocketConnection,
} from '../scrypt-websocket-connection';
import { ScryptService } from '../scrypt.service';

jest.mock('src/config/config', () => {
  const mockConfig = {
    scrypt: {
      apiKey: 'k',
      apiSecret: 's',
      wsUrl: 'wss://x',
    },
  };
  return {
    Config: mockConfig,
    GetConfig: () => mockConfig,
  };
});

jest.mock('../scrypt-websocket-connection', () => {
  const actual = jest.requireActual('../scrypt-websocket-connection');
  return {
    ...actual,
    ScryptWebSocketConnection: jest.fn().mockImplementation(() => ({
      fetchAll: jest.fn().mockResolvedValue([]),
      fetch: jest.fn().mockResolvedValue([]),
      subscribeToStream: jest.fn().mockReturnValue(() => undefined),
      onReconnect: jest.fn(),
      send: jest.fn(),
      requestAndWaitForUpdate: jest.fn(),
    })),
  };
});

async function flushPromises(): Promise<void> {
  for (let i = 0; i < 30; i++) {
    await Promise.resolve();
  }
}

describe('ScryptService', () => {
  let service: ScryptService;
  let instance: {
    fetchAll: jest.Mock;
    onReconnect: jest.Mock;
    subscribeToStream: jest.Mock;
    send: jest.Mock;
  };

  beforeEach(async () => {
    (ScryptWebSocketConnection as jest.MockedClass<typeof ScryptWebSocketConnection>).mockClear();
    service = new ScryptService();
    instance = (ScryptWebSocketConnection as jest.MockedClass<typeof ScryptWebSocketConnection>).mock.results[0]
      .value as any;
    // Constructor warm-up fetchAll calls settle on empty arrays before tests reconfigure.
    await flushPromises();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('catchUpAfterReconnect fetches fresh state and applies terminal-aware balance-tx cache writes', async () => {
    const now = new Date().toISOString();

    const existingNonTerminal = {
      ClReqID: 'a',
      TransactionID: 'tx-a-old',
      Status: ScryptTransactionStatus.COMPLETED,
      Timestamp: now,
    };
    const existingTerminal = {
      ClReqID: 'b',
      TransactionID: 'tx-b-terminal',
      Status: ScryptTransactionStatus.REJECTED,
      Timestamp: now,
    };
    (service as any).balanceTransactions.set('a', existingNonTerminal);
    (service as any).balanceTransactions.set('b', existingTerminal);
    const terminalBBefore = (service as any).balanceTransactions.get('b');

    const freshTerminalA = {
      ClReqID: 'a',
      TransactionID: 'tx-a-new',
      Status: ScryptTransactionStatus.COMPLETED,
      TxHash: 'hash1',
      Timestamp: now,
    };
    const freshNonTerminalB = {
      ClReqID: 'b',
      TransactionID: 'tx-b-nonterminal',
      Status: ScryptTransactionStatus.COMPLETED,
      Timestamp: now,
    };
    const freshReport = {
      ClOrdID: 'ord-1',
      SubmitTime: now,
      OrderID: 'oid-1',
    };

    instance.fetchAll.mockImplementation(async (streamName: string) => {
      if (streamName === ScryptMessageType.BALANCE_TRANSACTION) {
        return [freshTerminalA, freshNonTerminalB];
      }
      if (streamName === ScryptMessageType.EXECUTION_REPORT) {
        return [freshReport];
      }
      return [];
    });

    await (service as any).catchUpAfterReconnect();

    expect((service as any).balanceTransactions.get('a')).toEqual(freshTerminalA);
    expect((service as any).balanceTransactions.get('b')).toBe(terminalBBefore);
    expect((service as any).balanceTransactions.get('b')).toEqual(existingTerminal);
    expect((service as any).executionReports.get('ord-1')).toEqual(freshReport);
  });

  it('cacheBalanceTransaction allows terminal→terminal correction (does not block all updates once terminal)', () => {
    const now = new Date().toISOString();
    const existingTerminal = {
      ClReqID: 'c',
      TransactionID: 'tx-c-old',
      Status: ScryptTransactionStatus.REJECTED,
      Timestamp: now,
    };
    const freshTerminal = {
      ClReqID: 'c',
      TransactionID: 'tx-c-corrected',
      Status: ScryptTransactionStatus.COMPLETED,
      TxHash: 'hash-corrected',
      Timestamp: now,
    };

    (service as any).balanceTransactions.set('c', existingTerminal);
    (service as any).cacheBalanceTransaction(freshTerminal);

    expect((service as any).balanceTransactions.get('c')).toBe(freshTerminal);
    expect((service as any).balanceTransactions.get('c')).toEqual(freshTerminal);
  });

  it('cacheBalanceTransaction does not suppress keyless non-terminal after keyless terminal (ClReqID optional)', () => {
    const now = new Date().toISOString();
    const terminalNoKey = {
      TransactionID: 'tx-keyless-terminal',
      Status: ScryptTransactionStatus.FAILED,
      Timestamp: now,
    };
    const nonTerminalNoKey = {
      TransactionID: 'tx-keyless-nonterminal',
      Status: ScryptTransactionStatus.COMPLETED,
      Timestamp: now,
    };

    (service as any).cacheBalanceTransaction(terminalNoKey);
    (service as any).cacheBalanceTransaction(nonTerminalNoKey);

    expect((service as any).balanceTransactions.get(undefined)).toEqual(nonTerminalNoKey);
  });

  it('registers catch-up via connection.onReconnect in the constructor', async () => {
    expect(instance.onReconnect).toHaveBeenCalledTimes(1);
    expect(instance.onReconnect).toHaveBeenCalledWith(expect.any(Function));

    const registeredCallback = instance.onReconnect.mock.calls[0][0] as () => void | Promise<void>;
    instance.fetchAll.mockClear();

    await registeredCallback();
    await flushPromises();

    expect(instance.fetchAll).toHaveBeenCalledWith(ScryptMessageType.EXECUTION_REPORT);
    expect(instance.fetchAll).toHaveBeenCalledWith(ScryptMessageType.BALANCE_TRANSACTION);
  });

  it('catchUpAfterReconnect applies the fulfilled stream even when the other stream rejects (Promise.allSettled isolation)', async () => {
    const now = new Date().toISOString();
    const freshBalanceTx = {
      ClReqID: 'iso-1',
      TransactionID: 'tx-iso-new',
      Status: ScryptTransactionStatus.COMPLETED,
      TxHash: 'hash-iso',
      Timestamp: now,
    };
    const rejectionError = new Error('execution reports fetch failed');

    const loggerErrorSpy = jest.spyOn((service as any).logger, 'error').mockImplementation(() => undefined);

    const registeredCallback = instance.onReconnect.mock.calls[0][0] as () => void | Promise<void>;
    instance.fetchAll.mockClear();
    instance.fetchAll.mockImplementation(async (streamName: string) => {
      if (streamName === ScryptMessageType.EXECUTION_REPORT) throw rejectionError;
      if (streamName === ScryptMessageType.BALANCE_TRANSACTION) return [freshBalanceTx];
      return [];
    });

    await registeredCallback();
    await flushPromises();

    expect((service as any).balanceTransactions.get('iso-1')).toEqual(freshBalanceTx);
    expect((service as any).executionReports.size).toBe(0);
    expect(loggerErrorSpy).toHaveBeenCalledTimes(1);
    expect(loggerErrorSpy).toHaveBeenCalledWith(
      'Scrypt reconnect catch-up (execution reports) failed:',
      rejectionError,
    );
  });

  it('live BalanceTransaction subscriber goes through the terminal-aware guard', () => {
    const now = new Date().toISOString();
    const existingTerminal = {
      ClReqID: 'live-1',
      TransactionID: 'tx-live-terminal',
      Status: ScryptTransactionStatus.REJECTED,
      Timestamp: now,
    };
    (service as any).balanceTransactions.set('live-1', existingTerminal);
    const terminalBefore = (service as any).balanceTransactions.get('live-1');

    const balanceTxCall = instance.subscribeToStream.mock.calls.find(
      ([streamName]) => streamName === ScryptMessageType.BALANCE_TRANSACTION,
    );
    expect(balanceTxCall).toBeDefined();
    const liveSubscriber = balanceTxCall![1] as (transactions: unknown[]) => void;

    const nonTerminalUpdate = {
      ClReqID: 'live-1',
      TransactionID: 'tx-live-nonterminal',
      Status: ScryptTransactionStatus.COMPLETED,
      Timestamp: now,
    };
    liveSubscriber([nonTerminalUpdate]);

    expect((service as any).balanceTransactions.get('live-1')).toBe(terminalBefore);
    expect((service as any).balanceTransactions.get('live-1')).toEqual(existingTerminal);
  });

  it('live ExecutionReport subscriber goes through the terminal-aware guard', () => {
    const now = new Date().toISOString();
    const existingTerminal = {
      ClOrdID: 'ord-live-1',
      Symbol: 'BTC-USD',
      Side: 'Buy',
      OrdStatus: ScryptOrderStatus.FILLED,
      OrderQty: '1',
      CumQty: '1',
      LeavesQty: '0',
      SubmitTime: now,
    };
    (service as any).executionReports.set('ord-live-1', existingTerminal);
    const terminalBefore = (service as any).executionReports.get('ord-live-1');

    const executionReportCall = instance.subscribeToStream.mock.calls.find(
      ([streamName]) => streamName === ScryptMessageType.EXECUTION_REPORT,
    );
    expect(executionReportCall).toBeDefined();
    const liveSubscriber = executionReportCall![1] as (reports: unknown[]) => void;

    const nonTerminalUpdate = {
      ClOrdID: 'ord-live-1',
      Symbol: 'BTC-USD',
      Side: 'Buy',
      OrdStatus: ScryptOrderStatus.NEW,
      OrderQty: '1',
      CumQty: '0',
      LeavesQty: '1',
      SubmitTime: now,
    };
    liveSubscriber([nonTerminalUpdate]);

    expect((service as any).executionReports.get('ord-live-1')).toBe(terminalBefore);
    expect((service as any).executionReports.get('ord-live-1')).toEqual(existingTerminal);
  });

  it('getOrderStatus fallback does not clobber a live terminal push that arrived during the API await', async () => {
    const now = new Date().toISOString();
    const staleNonTerminal = {
      ClOrdID: 'X',
      Symbol: 'BTC-USD',
      Side: 'Buy',
      OrdStatus: ScryptOrderStatus.NEW,
      OrderQty: '1',
      CumQty: '0',
      LeavesQty: '1',
      SubmitTime: now,
    };
    const liveTerminal = {
      ClOrdID: 'X',
      Symbol: 'BTC-USD',
      Side: 'Buy',
      OrdStatus: ScryptOrderStatus.FILLED,
      OrderQty: '1',
      CumQty: '1',
      LeavesQty: '0',
      SubmitTime: now,
    };

    expect((service as any).executionReports.get('X')).toBeUndefined();

    (instance as any).fetch.mockImplementation(async () => {
      (service as any).cacheExecutionReport(liveTerminal);
      return [staleNonTerminal];
    });

    const result = await (service as any).getOrderStatus('X');

    expect(result).toEqual(expect.objectContaining({ status: ScryptOrderStatus.FILLED }));
    expect((service as any).executionReports.get('X')).toEqual(liveTerminal);
  });

  it('constructor warm-up BalanceTransaction fetch goes through the terminal-aware guard', async () => {
    const now = new Date().toISOString();
    const terminalRecord = {
      ClReqID: 'warm-1',
      TransactionID: 'tx-warm-terminal',
      Status: ScryptTransactionStatus.COMPLETED,
      TxHash: 'hash-warm',
      Timestamp: now,
    };
    const nonTerminalDuplicate = {
      ClReqID: 'warm-1',
      TransactionID: 'tx-warm-nonterminal',
      Status: ScryptTransactionStatus.COMPLETED,
      Timestamp: now,
    };

    const MockedConnection = ScryptWebSocketConnection as jest.MockedClass<typeof ScryptWebSocketConnection>;
    MockedConnection.mockImplementationOnce(
      () =>
        ({
          fetchAll: jest.fn().mockImplementation(async (streamName: string) => {
            if (streamName === ScryptMessageType.BALANCE_TRANSACTION) {
              return [terminalRecord, nonTerminalDuplicate];
            }
            return [];
          }),
          fetch: jest.fn().mockResolvedValue([]),
          subscribeToStream: jest.fn().mockReturnValue(() => undefined),
          onReconnect: jest.fn(),
          send: jest.fn(),
          requestAndWaitForUpdate: jest.fn(),
        }) as any,
    );

    const freshService = new ScryptService();
    await flushPromises();

    const freshInstance = MockedConnection.mock.results[MockedConnection.mock.results.length - 1].value as any;
    expect(freshInstance.fetchAll).toHaveBeenCalled();

    expect((freshService as any).balanceTransactions.get('warm-1')).toEqual(terminalRecord);
    expect((freshService as any).balanceTransactions.get('warm-1')).toBe(terminalRecord);
  });

  it('live BalanceTransaction without Timestamp is still cached (no age cutoff on live path)', () => {
    const balanceTxCall = instance.subscribeToStream.mock.calls.find(
      ([streamName]) => streamName === ScryptMessageType.BALANCE_TRANSACTION,
    );
    expect(balanceTxCall).toBeDefined();
    const liveSubscriber = balanceTxCall![1] as (transactions: unknown[]) => void;

    const liveNoTimestamp = {
      ClReqID: 'live-no-ts',
      TransactionID: 'tx-live-no-ts',
      Status: ScryptTransactionStatus.COMPLETED,
    };
    liveSubscriber([liveNoTimestamp]);

    expect((service as any).balanceTransactions.get('live-no-ts')).toEqual(liveNoTimestamp);
  });

  it('live ExecutionReport older than 365 days is still cached (no age cutoff on live path)', () => {
    const executionReportCall = instance.subscribeToStream.mock.calls.find(
      ([streamName]) => streamName === ScryptMessageType.EXECUTION_REPORT,
    );
    expect(executionReportCall).toBeDefined();
    const liveSubscriber = executionReportCall![1] as (reports: unknown[]) => void;

    const oldSubmitTime = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000).toISOString();
    const oldReport = {
      ClOrdID: 'ord-live-old',
      Symbol: 'BTC-USD',
      Side: 'Buy',
      OrdStatus: ScryptOrderStatus.NEW,
      OrderQty: '1',
      CumQty: '0',
      LeavesQty: '1',
      SubmitTime: oldSubmitTime,
    };
    liveSubscriber([oldReport]);

    expect((service as any).executionReports.get('ord-live-old')).toEqual(oldReport);
  });

  it('constructor warm-up drops BalanceTransaction older than 365 days (bulk age filter)', async () => {
    const oldTimestamp = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000).toISOString();
    const oldBalanceTx = {
      ClReqID: 'warm-old',
      TransactionID: 'tx-warm-old',
      Status: ScryptTransactionStatus.COMPLETED,
      Timestamp: oldTimestamp,
    };

    const MockedConnection = ScryptWebSocketConnection as jest.MockedClass<typeof ScryptWebSocketConnection>;
    MockedConnection.mockImplementationOnce(
      () =>
        ({
          fetchAll: jest.fn().mockImplementation(async (streamName: string) => {
            if (streamName === ScryptMessageType.BALANCE_TRANSACTION) {
              return [oldBalanceTx];
            }
            return [];
          }),
          fetch: jest.fn().mockResolvedValue([]),
          subscribeToStream: jest.fn().mockReturnValue(() => undefined),
          onReconnect: jest.fn(),
          send: jest.fn(),
          requestAndWaitForUpdate: jest.fn(),
        }) as any,
    );

    const freshService = new ScryptService();
    await flushPromises();

    expect((freshService as any).balanceTransactions.get('warm-old')).toBeUndefined();
  });

  it('catchUpAfterReconnect coalesces overlapping reconnects into a second full run', async () => {
    let resolveFirstExecutionReport: (value: unknown[]) => void;
    const firstExecutionReportPromise = new Promise<unknown[]>((resolve) => {
      resolveFirstExecutionReport = resolve;
    });
    let fetchAllCallCount = 0;

    instance.fetchAll.mockClear();
    instance.fetchAll.mockImplementation((streamName: string) => {
      fetchAllCallCount += 1;
      if (fetchAllCallCount === 1 && streamName === ScryptMessageType.EXECUTION_REPORT) {
        return firstExecutionReportPromise;
      }
      return Promise.resolve([]);
    });

    const inFlight = (service as any).catchUpAfterReconnect();

    // Overlapping reconnect while first catch-up is still pending on EXECUTION_REPORT
    await (service as any).catchUpAfterReconnect();

    resolveFirstExecutionReport!([]);
    await inFlight;
    await flushPromises();

    const executionReportCalls = instance.fetchAll.mock.calls.filter(
      ([streamName]) => streamName === ScryptMessageType.EXECUTION_REPORT,
    );
    const balanceTransactionCalls = instance.fetchAll.mock.calls.filter(
      ([streamName]) => streamName === ScryptMessageType.BALANCE_TRANSACTION,
    );
    expect(executionReportCalls).toHaveLength(2);
    expect(balanceTransactionCalls).toHaveLength(2);
  });

  describe('getDepositStatus', () => {
    it('returns null on cache miss', () => {
      expect(service.getDepositStatus('missing-req-id')).toBeNull();
    });

    it('returns null when the cached transaction is a withdrawal', () => {
      const clReqId = 'withdraw-req';
      (service as any).balanceTransactions.set(clReqId, {
        TransactionID: 'tx-w-1',
        ClReqID: clReqId,
        Currency: 'CHF',
        TransactionType: ScryptTransactionType.WITHDRAWAL,
        Status: ScryptTransactionStatus.COMPLETED,
        Quantity: '100',
      } satisfies ScryptBalanceTransaction);

      expect(service.getDepositStatus(clReqId)).toBeNull();
    });

    it('returns the mapped deposit status for a cached deposit transaction', () => {
      const clReqId = 'deposit-req';
      (service as any).balanceTransactions.set(clReqId, {
        TransactionID: 'tx-d-1',
        ClReqID: clReqId,
        Currency: 'CHF',
        TransactionType: ScryptTransactionType.DEPOSIT,
        Status: ScryptTransactionStatus.COMPLETED,
        Quantity: '250.5',
        RejectReason: 'reason-code',
        RejectText: 'human readable',
      } satisfies ScryptBalanceTransaction);

      expect(service.getDepositStatus(clReqId)).toEqual({
        id: 'tx-d-1',
        status: ScryptTransactionStatus.COMPLETED,
        rejectReason: 'reason-code',
        rejectText: 'human readable',
      });
    });
  });

  describe('sendDepositRequest', () => {
    it('sends a NewDepositRequest with TxHashes derived from reqId when txHashes is omitted', async () => {
      const timeStamp = new Date('2026-07-23T12:00:00.000Z');
      await service.sendDepositRequest({
        currency: 'CHF',
        amount: 123.45,
        reqId: 'DEPOSIT-99',
        timeStamp,
      });

      expect(instance.send).toHaveBeenCalledWith(ScryptMessageType.NEW_DEPOSIT_REQUEST, [
        {
          Currency: 'CHF',
          ClReqID: 'DEPOSIT-99',
          Quantity: '123.45',
          TransactTime: '2026-07-23T12:00:00.000Z',
          TxHashes: [{ TxHash: 'DEPOSIT-99' }],
        },
      ]);
    });

    it('sends a NewDepositRequest with the provided txHashes array', async () => {
      const timeStamp = new Date('2026-07-23T13:30:00.000Z');
      await service.sendDepositRequest({
        currency: 'EUR',
        amount: 50,
        reqId: 'E2E-1',
        timeStamp,
        txHashes: ['0xabc', '0xdef'],
      });

      expect(instance.send).toHaveBeenCalledWith(ScryptMessageType.NEW_DEPOSIT_REQUEST, [
        {
          Currency: 'EUR',
          ClReqID: 'E2E-1',
          Quantity: '50',
          TransactTime: '2026-07-23T13:30:00.000Z',
          TxHashes: [{ TxHash: '0xabc' }, { TxHash: '0xdef' }],
        },
      ]);
    });
  });
  describe('checkTrade — the amend write boundary', () => {
    function stubAmendPath(editOutcome: Error): void {
      jest.spyOn(service as any, 'getOrderStatus').mockResolvedValue({
        id: 'dfx-lm-7',
        status: ScryptOrderStatus.PARTIALLY_FILLED,
        price: 1,
        remainingQuantity: 5,
      });
      jest.spyOn(service as any, 'getTradePrice').mockResolvedValue(2);
      jest.spyOn(service as any, 'editOrder').mockRejectedValue(editOutcome);
      jest.spyOn(service as any, 'cancelOrder').mockResolvedValue(undefined);
    }

    it('propagates an unconfirmed amend instead of swallowing it', async () => {
      // Regression guard: the amend used to be wrapped in a catch that cancelled and returned false, so the
      // caller never learned that a replacement order might be live at the venue under the reserved id.
      stubAmendPath(new ScryptRequestTimeoutError('Timeout waiting for ExecutionReport update after 60000ms'));

      await expect(service.checkTrade('dfx-lm-7', 'EUR', 'USDT', new Date(), 'dfx-lm-7-1')).rejects.toBeInstanceOf(
        ScryptUnconfirmedWriteError,
      );
      expect((service as any).cancelOrder).not.toHaveBeenCalled();
    });

    it('carries the reserved replacement reference on the raised error', async () => {
      stubAmendPath(new ScryptRequestTimeoutError('Timeout waiting for ExecutionReport update after 60000ms'));

      await expect(service.checkTrade('dfx-lm-7', 'EUR', 'USDT', new Date(), 'dfx-lm-7-1')).rejects.toMatchObject({
        reference: 'dfx-lm-7-1',
      });
    });

    it('forgets a cached open order when the follow-up cancel goes unconfirmed', async () => {
      // the cancel is a write as well: unconfirmed, it may have taken effect while the cached report still
      // shows the order open — and a non-terminal entry is never refreshed, so every later check would wait
      // on a picture that cannot change
      stubAmendPath(new ScryptVenueRejectionError('Scrypt order edit rejected: price out of band'));
      jest.spyOn(service as any, 'cancelOrder').mockRejectedValue(new ScryptRequestTimeoutError('Request timeout'));
      (service as any).executionReports.set('dfx-lm-7', { ClOrdID: 'dfx-lm-7', OrdStatus: ScryptOrderStatus.NEW });

      await expect(service.checkTrade('dfx-lm-7', 'EUR', 'USDT', new Date(), 'dfx-lm-7-1')).rejects.toMatchObject({
        message: expect.stringContaining('cancel went unconfirmed'),
      });

      expect((service as any).executionReports.has('dfx-lm-7')).toBe(false);
    });

    it('keeps the cached order when the cancel is confirmed', async () => {
      stubAmendPath(new ScryptVenueRejectionError('Scrypt order edit rejected: price out of band'));
      (service as any).executionReports.set('dfx-lm-7', { ClOrdID: 'dfx-lm-7', OrdStatus: ScryptOrderStatus.NEW });

      await expect(service.checkTrade('dfx-lm-7', 'EUR', 'USDT', new Date(), 'dfx-lm-7-1')).rejects.toBeInstanceOf(
        ScryptAmendRejectedError,
      );

      expect((service as any).executionReports.has('dfx-lm-7')).toBe(true);
    });

    it('keeps waiting on a pending order however old it is — pending is observed, not unknown', async () => {
      // quarantining it would make reconciliation find the reference, hand the order back, and the next
      // completion check quarantine it again: a loop, not a resolution
      jest.spyOn(service as any, 'getOrderStatus').mockResolvedValue({
        id: 'dfx-lm-7',
        status: ScryptOrderStatus.PENDING_NEW,
        remainingQuantity: 5,
      });

      await expect(service.checkTrade('dfx-lm-7', 'EUR', 'USDT', new Date(Date.now() - 120 * 60 * 1000))).resolves.toBe(
        false,
      );
    });

    it('keeps waiting on a pending order that is still young', async () => {
      jest.spyOn(service as any, 'getOrderStatus').mockResolvedValue({
        id: 'dfx-lm-7',
        status: ScryptOrderStatus.PENDING_NEW,
        remainingQuantity: 5,
      });

      await expect(service.checkTrade('dfx-lm-7', 'EUR', 'USDT', new Date())).resolves.toBe(false);
    });

    it('cancels on an explicit rejection, but reports the refusal and the spent reference', async () => {
      // A rejection is a reply: nothing was created, so cancelling is safe. The caller still has to learn
      // about it — the replacement reference is burnt at the venue and must not be derived again.
      stubAmendPath(new ScryptVenueRejectionError('Scrypt order edit rejected: price out of band'));

      await expect(service.checkTrade('dfx-lm-7', 'EUR', 'USDT', new Date(), 'dfx-lm-7-1')).rejects.toMatchObject({
        spentReference: 'dfx-lm-7-1',
      });
      expect((service as any).cancelOrder).toHaveBeenCalled();
    });
  });
});
