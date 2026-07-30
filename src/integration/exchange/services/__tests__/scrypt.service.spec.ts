import { Util } from 'src/shared/utils/util';
import {
  ScryptBalanceTransaction,
  ScryptCancellation,
  ScryptExecutionReport,
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
    jest.useRealTimers(); // a failing fake-timer test must not leak its clock into the next one
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
    // The balance leg applied in round 0, so only the failed leg is retried — it is not re-fetched three times.
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

  it('re-fetches the healthy leg too when a reconnect lands after a partially failing round', async () => {
    jest.spyOn((service as any).logger, 'error').mockImplementation(() => undefined);

    let executionCalls = 0;
    instance.fetchAll.mockClear();
    instance.fetchAll.mockImplementation(async (streamName: string) => {
      if (streamName === ScryptMessageType.EXECUTION_REPORT) {
        executionCalls += 1;
        if (executionCalls === 1) throw new Error('Connection closed'); // round 0 fails on this leg only
      }
      return [];
    });
    // Round 0 waits first (the constructor warm-up claimed a slot), so the reconnect goes into round 1's wait —
    // i.e. after round 0 already fetched the balance leg. Its outage postdates that snapshot, so round 1 owes
    // BOTH streams, not just the leg round 0 failed on.
    let delayCalls = 0;
    delaySpy.mockImplementation(async () => {
      delayCalls += 1;
      if (delayCalls === 2) await (service as any).catchUpAfterReconnect();
    });

    await (service as any).catchUpAfterReconnect();
    await flushPromises();

    const balanceCalls = instance.fetchAll.mock.calls.filter(
      ([streamName]) => streamName === ScryptMessageType.BALANCE_TRANSACTION,
    );
    expect(balanceCalls).toHaveLength(2);
  });

  it('the scheduled retry actually runs a fresh round when it fires', async () => {
    jest.spyOn((service as any).logger, 'error').mockImplementation(() => undefined);
    jest.spyOn((service as any).logger, 'warn').mockImplementation(() => undefined);
    jest.useFakeTimers();

    instance.fetchAll.mockClear();
    instance.fetchAll.mockRejectedValue(new Error('Connection closed'));

    await (service as any).catchUpAfterReconnect();
    await flushPromises();

    const callsBeforeRetry = instance.fetchAll.mock.calls.length;
    expect(callsBeforeRetry).toBeGreaterThan(0);
    expect((service as any).catchUpRetryTimer).toBeDefined();

    instance.fetchAll.mockResolvedValue([]);
    jest.advanceTimersByTime((service as any).catchUpMinInterval);
    await flushPromises();

    // The retry is not just armed — it re-enters and restores the streams the bounded loop still owed.
    expect(instance.fetchAll.mock.calls.length).toBeGreaterThan(callsBeforeRetry);
    expect((service as any).catchUpInProgress).toBe(false);
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

  it('catchUpAfterReconnect stamps the slot when the round ends, so a long round still gates the next one', async () => {
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

  it('passes a caller-supplied since through to the venue request as StartDate', async () => {
    // the caller side of this is covered elsewhere (scrypt.adapter.spec.ts); this covers the receiving side —
    // a mutation that drops `since` and always fetches the fixed 30-day window would pass unnoticed otherwise
    (instance as any).fetch.mockClear();
    const since = new Date('2026-07-01T00:00:00.000Z');

    await (service as any).getOrderStatus('ord-since-1', since);

    expect((instance as any).fetch).toHaveBeenCalledWith(
      ScryptMessageType.EXECUTION_REPORT,
      expect.objectContaining({ StartDate: since.toISOString() }),
    );
  });

  it('falls back to the fixed thirty-day window when no since is given', async () => {
    // guards the `since ?? Util.daysBefore(30)` default; the bound is derived from "now", so pin it from both
    // sides instead of asserting an exact timestamp
    (instance as any).fetch.mockClear();
    const earliest = Util.daysBefore(30);

    await (service as any).getOrderStatus('ord-since-2');

    const latest = Util.daysBefore(30);
    const [, filters] = (instance as any).fetch.mock.calls[0];
    const startDate = new Date((filters as Record<string, unknown>).StartDate as string);

    expect(startDate.getTime()).toBeGreaterThanOrEqual(earliest.getTime());
    expect(startDate.getTime()).toBeLessThanOrEqual(latest.getTime());
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
  describe('cancelIfOutstanding', () => {
    /** A complete report, so the fixture cannot drift from the contract cancelOrder now promises. */
    function cancelReport(overrides: Partial<ScryptExecutionReport> = {}): ScryptExecutionReport {
      return {
        ClOrdID: 'cancel-req-1',
        OrigClOrdID: 'dfx-lm-7',
        Symbol: 'EUR/USDT',
        Side: 'Sell',
        OrdStatus: ScryptOrderStatus.CANCELED,
        OrderQty: '100',
        CumQty: '0',
        LeavesQty: '0',
        ...overrides,
      };
    }

    function stubCancel(report: ScryptExecutionReport | Error): void {
      jest.spyOn(service as any, 'getTradePair').mockResolvedValue({ symbol: 'EUR/USDT' });
      const connection = (service as any).connection;
      jest
        .spyOn(connection, 'requestAndWaitForUpdate')
        .mockImplementation(async () => (report instanceof Error ? Promise.reject(report) : report));
    }

    it('settles a cancellation that filled nothing', async () => {
      stubCancel(cancelReport());

      await expect(service.cancelIfOutstanding('dfx-lm-7', 'EUR', 'USDT')).resolves.toBe(ScryptCancellation.SETTLED);
    });

    it('reports a partial fill as executed — a terminal status does not mean nothing happened', async () => {
      // the venue cancels a partially filled order with BOTH a terminal state and a non-zero filled size;
      // reading only the state is how a real fill gets dropped
      stubCancel(cancelReport({ CumQty: '40' }));

      await expect(service.cancelIfOutstanding('dfx-lm-7', 'EUR', 'USDT')).resolves.toBe(ScryptCancellation.EXECUTED);
    });

    it('settles a refusal that says there is no such order', async () => {
      // a refused cancel arrives as an execution report, not as an error
      stubCancel(
        cancelReport({ OrdStatus: ScryptOrderStatus.NEW, ExecType: 'CancelRejected', CxlRejReason: 'UnknownOrder' }),
      );

      await expect(service.cancelIfOutstanding('dfx-lm-7', 'EUR', 'USDT')).resolves.toBe(ScryptCancellation.SETTLED);
    });

    it.each([ScryptOrderStatus.CANCELED, ScryptOrderStatus.FILLED])(
      'settles nothing when a %s report claims the order is unknown yet reports a fill',
      async (ordStatus) => {
        // the contradiction is the same whatever status rides along; deciding on the status first would let
        // it through with a terminal one attached
        stubCancel(
          cancelReport({
            OrdStatus: ordStatus,
            ExecType: 'CancelRejected',
            CxlRejReason: 'UnknownOrder',
            CumQty: '40',
          }),
        );

        await expect(service.cancelIfOutstanding('dfx-lm-7', 'EUR', 'USDT')).resolves.toBe(
          ScryptCancellation.UNCONFIRMED,
        );
      },
    );

    it.each(['', '   ', 'abc', undefined])('does not cache a cancellation whose filled size is %p', async (cumQty) => {
      // readers derive the fill with `parseFloat(...) || 0`, so such an entry would quietly claim nothing
      // was filled on every later lookup
      stubCancel(cancelReport({ CumQty: cumQty as unknown as string }));

      await service.cancelIfOutstanding('dfx-lm-7', 'EUR', 'USDT');

      expect((service as any).executionReports.has('dfx-lm-7')).toBe(false);
    });

    it('settles nothing when a refusal claims the order is unknown yet reports a fill', async () => {
      // an order the venue has no record of cannot have traded — the report disagrees with itself, and
      // nothing may be concluded from that, least of all that walking away is safe
      stubCancel(
        cancelReport({
          OrdStatus: ScryptOrderStatus.PARTIALLY_FILLED,
          ExecType: 'CancelRejected',
          CxlRejReason: 'UnknownOrder',
          CumQty: '40',
          LeavesQty: '60',
        }),
      );

      await expect(service.cancelIfOutstanding('dfx-lm-7', 'EUR', 'USDT')).resolves.toBe(
        ScryptCancellation.UNCONFIRMED,
      );
    });

    it('settles nothing on any other refusal — too late to cancel means it may yet execute', async () => {
      stubCancel(
        cancelReport({ OrdStatus: ScryptOrderStatus.NEW, ExecType: 'CancelRejected', CxlRejReason: 'TooLateToCancel' }),
      );

      await expect(service.cancelIfOutstanding('dfx-lm-7', 'EUR', 'USDT')).resolves.toBe(
        ScryptCancellation.UNCONFIRMED,
      );
    });

    it.each([
      ['nothing filled', '0', ScryptCancellation.SETTLED],
      ['a fill', '40', ScryptCancellation.EXECUTED],
    ])('treats a rejected order with %s as terminal too', async (_label, cumQty, expected) => {
      // a rejected order is as final as a cancelled one; a second opinion on what counts as terminal would
      // be free to disagree with the first and leave such an order stuck
      stubCancel(cancelReport({ OrdStatus: ScryptOrderStatus.REJECTED, CumQty: cumQty }));

      await expect(service.cancelIfOutstanding('dfx-lm-7', 'EUR', 'USDT')).resolves.toBe(expected);
    });

    it('settles nothing when a refused cancel reports a fill — the order is still open', async () => {
      // a refusal carries the order's last known state, so a partially filled order that could NOT be
      // cancelled reports a fill while remaining live. Reading the fill alone would call it finished and
      // let the caller walk away from a reference that can still trade.
      stubCancel(
        cancelReport({
          OrdStatus: ScryptOrderStatus.PARTIALLY_FILLED,
          ExecType: 'CancelRejected',
          CxlRejReason: 'TooLateToCancel',
          CumQty: '40',
          LeavesQty: '60',
        }),
      );

      await expect(service.cancelIfOutstanding('dfx-lm-7', 'EUR', 'USDT')).resolves.toBe(
        ScryptCancellation.UNCONFIRMED,
      );
    });

    it('reports a fully filled order as executed', async () => {
      stubCancel(cancelReport({ OrdStatus: ScryptOrderStatus.FILLED, CumQty: '100', LeavesQty: '0' }));

      await expect(service.cancelIfOutstanding('dfx-lm-7', 'EUR', 'USDT')).resolves.toBe(ScryptCancellation.EXECUTED);
    });

    it('settles nothing when the filled size cannot be read — that is not a zero', async () => {
      stubCancel(cancelReport({ CumQty: undefined as unknown as string }));

      await expect(service.cancelIfOutstanding('dfx-lm-7', 'EUR', 'USDT')).resolves.toBe(
        ScryptCancellation.UNCONFIRMED,
      );
    });

    it.each([
      ['', 'empty'],
      ['   ', 'whitespace'],
    ])('settles nothing when the filled size is %p (%s) — that is missing, not zero', async (cumQty) => {
      // Number('') is 0, not NaN, so this would otherwise pass a finite check and read as untouched
      stubCancel(cancelReport({ CumQty: cumQty }));

      await expect(service.cancelIfOutstanding('dfx-lm-7', 'EUR', 'USDT')).resolves.toBe(
        ScryptCancellation.UNCONFIRMED,
      );
    });

    it('settles nothing when the filled size is not a number at all', async () => {
      stubCancel(cancelReport({ CumQty: 'abc' }));

      await expect(service.cancelIfOutstanding('dfx-lm-7', 'EUR', 'USDT')).resolves.toBe(
        ScryptCancellation.UNCONFIRMED,
      );
    });

    it('waits past a PendingCancel report instead of taking it for the answer', async () => {
      // the waiter resolves on its first match and then stops listening, so accepting the interim state
      // would freeze it as the result and the real terminal report would never be seen. Exercises the
      // matcher itself rather than mocking around it.
      const connection = (service as any).connection;
      let matcher: (reports: ScryptExecutionReport[]) => ScryptExecutionReport | null;
      jest.spyOn(service as any, 'getTradePair').mockResolvedValue({ symbol: 'EUR/USDT' });
      jest.spyOn(connection, 'requestAndWaitForUpdate').mockImplementation(async (..._args: unknown[]) => {
        matcher = _args[3] as typeof matcher;
        return cancelReport();
      });

      await service.cancelIfOutstanding('dfx-lm-7', 'EUR', 'USDT');

      const pending = cancelReport({ OrdStatus: ScryptOrderStatus.PENDING_CANCEL });
      const terminal = cancelReport();
      expect(matcher([pending])).toBeNull();
      expect(matcher([pending, terminal])).toBe(terminal);
    });

    it('settles nothing when the cancel never came back', async () => {
      stubCancel(new ScryptRequestTimeoutError('Timeout waiting for ExecutionReport update after 60000ms'));

      await expect(service.cancelIfOutstanding('dfx-lm-7', 'EUR', 'USDT')).resolves.toBe(
        ScryptCancellation.UNCONFIRMED,
      );
    });

    it('files nothing when the cancel was refused — a refusal carries the last known state, not a verdict', async () => {
      // for a reference the venue never had, that state reads as a live New order. Filing it would invent
      // one, and the next lookup would call the order sent against a reference that never executed.
      stubCancel(
        cancelReport({ OrdStatus: ScryptOrderStatus.NEW, ExecType: 'CancelRejected', CxlRejReason: 'UnknownOrder' }),
      );

      await service.cancelIfOutstanding('dfx-lm-7', 'EUR', 'USDT');

      expect((service as any).executionReports.has('dfx-lm-7')).toBe(false);
    });

    it('never files a cleanup cancellation under the order it cancelled', async () => {
      // the confirmation carries the cancel request's id; filing it under the order would make a later
      // status lookup read that order as terminally cancelled. A cleanup cancellation says nothing about
      // the order as a whole — sibling references may still be unsettled and live — so a lookup reporting
      // it as known would take it out of quarantine and let a replacement be opened beside them.
      stubCancel(cancelReport({ CumQty: '40' }));

      await service.cancelIfOutstanding('dfx-lm-7', 'EUR', 'USDT');

      expect((service as any).executionReports.has('dfx-lm-7')).toBe(false);
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
      jest.spyOn(service as any, 'cancelOrder').mockResolvedValue({
        ClOrdID: 'cancel-req-1',
        OrigClOrdID: 'dfx-lm-7',
        Symbol: 'EUR/USDT',
        Side: 'Sell',
        OrdStatus: ScryptOrderStatus.CANCELED,
        OrderQty: '5',
        CumQty: '0',
        LeavesQty: '0',
      } satisfies ScryptExecutionReport);
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
