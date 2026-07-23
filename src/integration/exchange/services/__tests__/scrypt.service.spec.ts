import { ScryptOrderStatus, ScryptTransactionStatus } from '../../dto/scrypt.dto';
import { ScryptMessageType, ScryptWebSocketConnection } from '../scrypt-websocket-connection';
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
});
