import { Util } from 'src/shared/utils/util';
import {
  ScryptBalanceTransaction,
  ScryptOrderStatus,
  ScryptTransactionStatus,
  ScryptTransactionType,
} from '../../dto/scrypt.dto';
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
    send: jest.Mock;
  };

  let delaySpy: jest.SpyInstance;

  beforeEach(async () => {
    (ScryptWebSocketConnection as jest.MockedClass<typeof ScryptWebSocketConnection>).mockClear();
    // The catch-up waits out catchUpMinInterval between rounds; tests assert the wait was requested
    // rather than sitting through it.
    delaySpy = jest.spyOn(Util, 'delay').mockResolvedValue(undefined);
    service = new ScryptService();
    instance = (ScryptWebSocketConnection as jest.MockedClass<typeof ScryptWebSocketConnection>).mock.results[0]
      .value as any;
    // Constructor warm-up fetchAll calls settle on empty arrays before tests reconfigure.
    await flushPromises();
  });

  afterEach(() => {
    (service as any).clearCatchUpRetry(); // a bounded invocation may leave a retry armed
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

  it('catchUpAfterReconnect applies the fulfilled stream even when the other stream rejects (leg isolation)', async () => {
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
    // The balance leg applied in round 1, so only the failed leg is retried — it is not re-fetched three times.
    const balanceCalls = instance.fetchAll.mock.calls.filter(
      ([streamName]) => streamName === ScryptMessageType.BALANCE_TRANSACTION,
    );
    expect(balanceCalls).toHaveLength(1);
    // A failing leg is a real state gap, so every failed round says so; the round gate is what bounds the volume.
    expect(loggerErrorSpy).toHaveBeenCalledTimes((service as any).catchUpMaxRounds);
    expect(loggerErrorSpy).toHaveBeenNthCalledWith(
      1,
      `Scrypt reconnect catch-up (${ScryptMessageType.EXECUTION_REPORT}) failed, 1 consecutive failure(s):`,
      rejectionError,
    );
  });

  it('catchUpAfterReconnect stops after catchUpMaxRounds when every round fails', async () => {
    jest.spyOn((service as any).logger, 'error').mockImplementation(() => undefined);
    jest.spyOn((service as any).logger, 'warn').mockImplementation(() => undefined);

    instance.fetchAll.mockClear();
    instance.fetchAll.mockImplementation(async (streamName: string) => {
      if (streamName === ScryptMessageType.EXECUTION_REPORT) throw new Error('Connection closed');
      return [];
    });

    await (service as any).catchUpAfterReconnect();
    await flushPromises();

    const executionReportCalls = instance.fetchAll.mock.calls.filter(
      ([streamName]) => streamName === ScryptMessageType.EXECUTION_REPORT,
    );
    expect(executionReportCalls).toHaveLength((service as any).catchUpMaxRounds);
    expect((service as any).catchUpInProgress).toBe(false);
  });

  it('catchUpAfterReconnect bounds the rounds when every round succeeds but a reconnect re-arms it', async () => {
    const loggerWarnSpy = jest.spyOn((service as any).logger, 'warn').mockImplementation(() => undefined);

    instance.fetchAll.mockClear();
    instance.fetchAll.mockImplementation(async () => {
      // A reconnect lands while the round's fetches are in flight, exactly as a flapping socket does. This is the
      // path the old `do { … } while (catchUpPending)` never escaped.
      (service as any).catchUpPending = true;
      return [];
    });

    await (service as any).catchUpAfterReconnect();
    await flushPromises();

    const executionReportCalls = instance.fetchAll.mock.calls.filter(
      ([streamName]) => streamName === ScryptMessageType.EXECUTION_REPORT,
    );
    expect(executionReportCalls).toHaveLength((service as any).catchUpMaxRounds);
    expect((service as any).catchUpInProgress).toBe(false);
    // The still-uncovered reconnect is handed to a scheduled retry rather than dropped.
    expect((service as any).catchUpRetryTimer).toBeDefined();
    expect(loggerWarnSpy).toHaveBeenCalledWith(expect.stringContaining('catch-up incomplete after'));
  });

  it('catchUpAfterReconnect runs immediately when the last round is longer ago than catchUpMinInterval', async () => {
    instance.fetchAll.mockClear();
    instance.fetchAll.mockResolvedValue([]);
    delaySpy.mockClear();
    (service as any).lastCatchUpAt = Date.now() - 10 * 60 * 1000;

    await (service as any).catchUpAfterReconnect();
    await flushPromises();

    // The gate must not delay an isolated reconnect — that is the claim that makes the interval acceptable.
    expect(delaySpy).not.toHaveBeenCalled();
    expect(instance.fetchAll).toHaveBeenCalledTimes((service as any).catchUpStreams.length);
  });

  it('catchUpAfterReconnect stamps the slot at the end of a round, not only at its start', async () => {
    let startStamp: number | undefined;

    instance.fetchAll.mockClear();
    instance.fetchAll.mockImplementation(async () => {
      startStamp ??= (service as any).lastCatchUpAt;
      await new Promise((resolve) => setTimeout(resolve, 5)); // a round that consumes real time
      return [];
    });

    await (service as any).catchUpAfterReconnect();
    await flushPromises();

    // Without the end stamp a round longer than catchUpMinInterval would leave the next one ungated.
    expect((service as any).lastCatchUpAt).toBeGreaterThan(startStamp!);
  });

  it('a warm-up that failed does not claim the catch-up slot', async () => {
    const MockedConnection = ScryptWebSocketConnection as jest.MockedClass<typeof ScryptWebSocketConnection>;
    MockedConnection.mockImplementationOnce(
      () =>
        ({
          fetchAll: jest.fn().mockRejectedValue(new Error('Connection closed')),
          fetch: jest.fn().mockResolvedValue([]),
          subscribeToStream: jest.fn().mockReturnValue(() => undefined),
          onReconnect: jest.fn(),
          send: jest.fn(),
          requestAndWaitForUpdate: jest.fn(),
        }) as any,
    );

    const freshService = new ScryptService();
    jest.spyOn((freshService as any).logger, 'error').mockImplementation(() => undefined);
    await flushPromises();

    // The caches are not whole, so the next reconnect must repair immediately instead of sitting out the interval.
    expect((freshService as any).lastCatchUpAt).toBeUndefined();
  });

  it('a warm-up that loaded both streams claims the catch-up slot', async () => {
    // The default mock resolves both warm-up fetches, so the service built in beforeEach has a whole cache.
    expect((service as any).lastCatchUpAt).toBeDefined();
  });

  it('catchUpAfterReconnect waits out catchUpMinInterval before a follow-up round', async () => {
    jest.spyOn((service as any).logger, 'error').mockImplementation(() => undefined);

    instance.fetchAll.mockClear();
    instance.fetchAll.mockImplementation(async (streamName: string) => {
      if (streamName === ScryptMessageType.EXECUTION_REPORT) throw new Error('Connection closed');
      return [];
    });
    delaySpy.mockClear();

    await (service as any).catchUpAfterReconnect();
    await flushPromises();

    // Every round waits — the first one too, because the constructor warm-up already took a slot.
    expect(delaySpy).toHaveBeenCalledTimes((service as any).catchUpMaxRounds);
    for (const [wait] of delaySpy.mock.calls) {
      expect(wait).toBeGreaterThan(0);
      expect(wait).toBeLessThanOrEqual((service as any).catchUpMinInterval);
    }
  });

  it('catchUpAfterReconnect reports recovery once a failing streak succeeds', async () => {
    jest.spyOn((service as any).logger, 'error').mockImplementation(() => undefined);
    const loggerInfoSpy = jest.spyOn((service as any).logger, 'info').mockImplementation(() => undefined);

    instance.fetchAll.mockClear();
    instance.fetchAll.mockRejectedValue(new Error('Connection closed'));
    await (service as any).catchUpAfterReconnect();
    await flushPromises();

    expect((service as any).catchUpFailures).toBeGreaterThan(0);

    instance.fetchAll.mockResolvedValue([]);
    await (service as any).catchUpAfterReconnect();
    await flushPromises();

    expect((service as any).catchUpFailures).toBe(0);
    expect(loggerInfoSpy).toHaveBeenCalledWith(expect.stringContaining('Scrypt reconnect catch-up succeeded after'));
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

  it('catchUpAfterReconnect coalesces a reconnect seen during the fetches into one follow-up round', async () => {
    let fetchAllCallCount = 0;

    instance.fetchAll.mockClear();
    instance.fetchAll.mockImplementation(async (streamName: string) => {
      fetchAllCallCount += 1;
      // Overlapping reconnect while the first round's EXECUTION_REPORT fetch is already in flight: it lands
      // after the round's data, so it needs a round of its own.
      if (fetchAllCallCount === 1 && streamName === ScryptMessageType.EXECUTION_REPORT)
        await (service as any).catchUpAfterReconnect();
      return [];
    });

    await (service as any).catchUpAfterReconnect();
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

  it('catchUpAfterReconnect absorbs a reconnect that arrives before the round starts fetching', async () => {
    instance.fetchAll.mockClear();
    instance.fetchAll.mockResolvedValue([]);

    // The slot wait runs before the round clears catchUpPending, so a reconnect arriving during the wait is
    // covered by the round that follows it — no extra round, no extra pair of bulk fetches.
    delaySpy.mockImplementation(async () => {
      await (service as any).catchUpAfterReconnect();
    });

    await (service as any).catchUpAfterReconnect();
    await flushPromises();

    const executionReportCalls = instance.fetchAll.mock.calls.filter(
      ([streamName]) => streamName === ScryptMessageType.EXECUTION_REPORT,
    );
    expect(executionReportCalls).toHaveLength(1);
    expect((service as any).catchUpPending).toBe(false);
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
});
