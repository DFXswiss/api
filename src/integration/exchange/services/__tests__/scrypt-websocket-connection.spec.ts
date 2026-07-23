import { EventEmitter as MockEventEmitter } from 'events';
import Ws from 'ws';
import { ScryptMessageType, ScryptWebSocketConnection } from '../scrypt-websocket-connection';

type MockWebSocketInstance = MockEventEmitter & {
  url: string;
  options?: unknown;
  readyState: number;
  send: jest.Mock;
  close: jest.Mock;
  terminate: jest.Mock;
  open: () => void;
  fail: (error?: Error) => void;
  remoteClose: (code?: number, reason?: string) => void;
};

type MockWebSocketConstructor = {
  new (url: string, options?: unknown): MockWebSocketInstance;
  OPEN: number;
  CONNECTING: number;
  CLOSING: number;
  CLOSED: number;
  instances: MockWebSocketInstance[];
};

jest.mock('ws', () => {
  class MockWebSocket extends MockEventEmitter {
    static OPEN = 1;
    static CONNECTING = 0;
    static CLOSING = 2;
    static CLOSED = 3;
    static instances: MockWebSocket[] = [];

    readyState = MockWebSocket.CONNECTING;
    send = jest.fn();
    close = jest.fn(() => {
      this.readyState = MockWebSocket.CLOSED;
    });
    terminate = jest.fn(() => {
      this.readyState = MockWebSocket.CLOSED;
    });
    url: string;
    options?: unknown;

    constructor(url: string, options?: unknown) {
      super();
      this.url = url;
      this.options = options;
      MockWebSocket.instances.push(this);
    }

    open(): void {
      this.readyState = MockWebSocket.OPEN;
      this.emit('open');
    }

    fail(error: Error = new Error('connect failed')): void {
      this.emit('error', error);
    }

    remoteClose(code = 1006, reason = 'abnormal'): void {
      this.readyState = MockWebSocket.CLOSED;
      this.emit('close', code, reason);
    }
  }

  return MockWebSocket;
});

// jest.mock is hoisted above imports; this binding receives the mock constructor.
const WebSocket = Ws as unknown as MockWebSocketConstructor;

async function flushPromises(): Promise<void> {
  // Drain microtasks produced by connect()/sendSubscription promise chains (including nested
  // resubscribeToStreams → sendSubscription → ensureConnected hops) under fake timers. A fixed small number of
  // rounds is not reliably enough for the deepest chains, so loop generously.
  for (let i = 0; i < 30; i++) {
    await Promise.resolve();
  }
}

function latestWs(): MockWebSocketInstance {
  const { instances } = WebSocket;
  if (instances.length === 0) throw new Error('No MockWebSocket instances created');
  return instances[instances.length - 1];
}

function subscribeMessages(ws: MockWebSocketInstance): unknown[] {
  return ws.send.mock.calls.map(([payload]) => JSON.parse(payload as string)).filter((msg) => msg.type === 'subscribe');
}

/** Max delay for a given reconnect attempt (jitter is applied on top: capped/2 .. capped). */
function maxDelayForAttempt(attempt: number): number {
  return Math.min(5000 * 2 ** attempt, 60000);
}

describe('ScryptWebSocketConnection', () => {
  let connection: ScryptWebSocketConnection;
  let loggerInfo: jest.SpyInstance;
  let loggerWarn: jest.SpyInstance;
  let loggerError: jest.SpyInstance;

  beforeEach(() => {
    jest.useFakeTimers();
    WebSocket.instances = [];
    connection = new ScryptWebSocketConnection('wss://scrypt.example/ws', 'api-key', 'api-secret');

    loggerInfo = jest.spyOn((connection as any).logger, 'info').mockImplementation(() => undefined);
    loggerWarn = jest.spyOn((connection as any).logger, 'warn').mockImplementation(() => undefined);
    loggerError = jest.spyOn((connection as any).logger, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  async function firstConnectWithStream(
    streamName: ScryptMessageType = ScryptMessageType.BALANCE_TRANSACTION,
  ): Promise<MockWebSocketInstance> {
    connection.subscribeToStream(streamName, () => undefined);
    const ws = latestWs();
    ws.open();
    await flushPromises();
    return ws;
  }

  async function firstConnectWithStreams(streamNames: ScryptMessageType[]): Promise<MockWebSocketInstance> {
    for (const streamName of streamNames) {
      connection.subscribeToStream(streamName, () => undefined);
    }
    const ws = latestWs();
    ws.open();
    await flushPromises();
    return ws;
  }

  /** Advance past the (jittered) reconnect timer for the given attempt and flush microtasks. */
  async function fireReconnectAttempt(attempt: number): Promise<void> {
    jest.advanceTimersByTime(maxDelayForAttempt(attempt));
    await flushPromises();
  }

  it('resubscribes active streams on reconnect after a close', async () => {
    const resubscribeSpy = jest.spyOn(connection as any, 'resubscribeToStreams');
    const firstWs = await firstConnectWithStream(ScryptMessageType.BALANCE_TRANSACTION);

    expect(subscribeMessages(firstWs)).toHaveLength(1);
    expect(resubscribeSpy).not.toHaveBeenCalled();
    expect((connection as any).hasEverConnected).toBe(true);

    // Simulate unexpected disconnect while CONNECTED → backoff reconnect loop.
    firstWs.remoteClose(1006, 'gone');
    expect((connection as any).isReconnecting).toBe(true);

    const constructCountBefore = WebSocket.instances.length;
    await fireReconnectAttempt(0);

    expect(WebSocket.instances.length).toBe(constructCountBefore + 1);
    const reconnectedWs = latestWs();
    reconnectedWs.open();
    await flushPromises();

    expect(resubscribeSpy).toHaveBeenCalledTimes(1);
    expect(subscribeMessages(reconnectedWs)).toHaveLength(1);
    expect(subscribeMessages(reconnectedWs)[0]).toEqual(
      expect.objectContaining({
        type: 'subscribe',
        streams: [expect.objectContaining({ name: ScryptMessageType.BALANCE_TRANSACTION })],
      }),
    );
    expect((connection as any).isReconnecting).toBe(false);
    expect(loggerInfo).toHaveBeenCalledWith(expect.stringMatching(/reconnected \(after 1 attempt/));
  });

  it('does not double-subscribe on the first connect', async () => {
    const resubscribeSpy = jest.spyOn(connection as any, 'resubscribeToStreams');

    connection.subscribeToStream(ScryptMessageType.BALANCE, () => undefined);
    const ws = latestWs();
    ws.open();
    await flushPromises();

    expect(resubscribeSpy).not.toHaveBeenCalled();
    expect(subscribeMessages(ws)).toHaveLength(1);
    expect(subscribeMessages(ws)[0]).toEqual(
      expect.objectContaining({
        type: 'subscribe',
        streams: [expect.objectContaining({ name: ScryptMessageType.BALANCE })],
      }),
    );
    expect((connection as any).hasEverConnected).toBe(true);
  });

  it('retries reconnect with bounded exponential backoff until success', async () => {
    const scheduleSpy = jest.spyOn(connection as any, 'scheduleReconnect');
    const firstWs = await firstConnectWithStream();

    firstWs.remoteClose(1006, 'drop');
    expect(scheduleSpy).toHaveBeenCalledWith(0);
    expect((connection as any).isReconnecting).toBe(true);

    // attempt 0 → delay in [2500, 5000]
    await fireReconnectAttempt(0);
    const attempt0 = latestWs();
    const authError = new Error('401 unauthorized');
    attempt0.fail(authError);
    // close after error while CONNECTING: wasConnected=false, no extra loop
    attempt0.remoteClose(1006, 'auth fail');
    await flushPromises();

    // connectWebSocket's ws.on('error') logs via logger.error before rejecting
    expect(loggerError).toHaveBeenCalledWith('Scrypt WebSocket error:', authError);
    expect(loggerWarn).toHaveBeenCalledWith(expect.stringMatching(/reconnect attempt 1 failed/));
    expect(scheduleSpy).toHaveBeenCalledWith(1);

    // attempt 1 → delay in [5000, 10000]
    await fireReconnectAttempt(1);
    const attempt1 = latestWs();
    attempt1.fail(new Error('still down'));
    attempt1.remoteClose();
    await flushPromises();

    expect(loggerWarn).toHaveBeenCalledWith(expect.stringMatching(/reconnect attempt 2 failed/));
    expect(scheduleSpy).toHaveBeenCalledWith(2);

    // attempt 2 → delay in [10000, 20000], then succeed
    await fireReconnectAttempt(2);
    const attempt2 = latestWs();
    attempt2.open();
    await flushPromises();

    expect(loggerInfo).toHaveBeenCalledWith(expect.stringMatching(/reconnected \(after 3 attempt/));
    expect((connection as any).isReconnecting).toBe(false);

    // attempts scheduled: 0, 1, 2 (capped bases 5s/10s/20s; actual delay is jittered in [capped/2, capped])
    expect(scheduleSpy.mock.calls.map(([attempt]: [number]) => attempt)).toEqual([0, 1, 2]);
  });

  it('resubscribes when an implicit reconnect is driven by a business call (ensureConnected)', async () => {
    const resubscribeSpy = jest.spyOn(connection as any, 'resubscribeToStreams');
    const firstWs = await firstConnectWithStream(ScryptMessageType.BALANCE_TRANSACTION);
    expect(resubscribeSpy).not.toHaveBeenCalled();

    // Tear down the live socket (starts the reconnect loop with a delayed timer).
    firstWs.remoteClose(1006, 'gone');
    expect((connection as any).connectionState).toBe('disconnected');
    expect((connection as any).hasEverConnected).toBe(true);

    // Before the backoff timer fires, a business call must heal + resubscribe via ensureConnected.
    const sendPromise = connection.send(ScryptMessageType.TRADE, [{ side: 'buy' }]);
    await flushPromises();

    const healedWs = latestWs();
    expect(healedWs).not.toBe(firstWs);
    healedWs.open();
    await flushPromises();
    await sendPromise;

    expect(resubscribeSpy).toHaveBeenCalled();
    expect(subscribeMessages(healedWs).length).toBeGreaterThanOrEqual(1);
    expect(
      subscribeMessages(healedWs).some((msg: any) => msg.streams?.[0]?.name === ScryptMessageType.BALANCE_TRANSACTION),
    ).toBe(true);

    // TRADE notify was also sent on the healed socket.
    const tradeSends = healedWs.send.mock.calls
      .map(([payload]) => JSON.parse(payload as string))
      .filter((msg) => msg.type === ScryptMessageType.TRADE);
    expect(tradeSends).toHaveLength(1);
  });

  it('does not schedule reconnect after an intentional disconnect', async () => {
    const scheduleSpy = jest.spyOn(connection as any, 'scheduleReconnect');
    const firstWs = await firstConnectWithStream();
    const constructCountAfterConnect = WebSocket.instances.length;

    await connection.disconnect();

    // Real ws emits 'close' after .close() completes — disconnect already set DISCONNECTED,
    // so wasConnected is false and the reconnect block must not run.
    firstWs.remoteClose(1000, 'normal closure');
    await flushPromises();

    expect(scheduleSpy).not.toHaveBeenCalled();
    expect((connection as any).isReconnecting).toBe(false);

    jest.advanceTimersByTime(60000 * 3);
    await flushPromises();

    expect(WebSocket.instances.length).toBe(constructCountAfterConnect);
    expect(scheduleSpy).not.toHaveBeenCalled();
  });

  it('cancels a pending reconnect timer on intentional disconnect', async () => {
    const scheduleSpy = jest.spyOn(connection as any, 'scheduleReconnect');
    const firstWs = await firstConnectWithStream();
    const constructCountAfterConnect = WebSocket.instances.length;

    // Unexpected drop schedules a reconnect timer; disconnect must cancel it before it fires.
    firstWs.remoteClose(1006, 'gone');
    expect(scheduleSpy).toHaveBeenCalledWith(0);
    expect((connection as any).isReconnecting).toBe(true);
    expect((connection as any).reconnectTimer).toBeDefined();

    await connection.disconnect();

    expect((connection as any).isReconnecting).toBe(false);
    expect((connection as any).reconnectTimer).toBeUndefined();

    jest.advanceTimersByTime(60000 * 3);
    await flushPromises();

    expect(WebSocket.instances.length).toBe(constructCountAfterConnect);
    // No further scheduleReconnect from a fired timer (only the original attempt-0 schedule).
    expect(scheduleSpy).toHaveBeenCalledTimes(1);
  });

  it('shared readiness: joining caller waits for resubscription before send (finding 1)', async () => {
    const firstWs = await firstConnectWithStream(ScryptMessageType.BALANCE_TRANSACTION);
    firstWs.remoteClose(1006, 'gone');

    let releaseResubscribe!: () => void;
    const resubscribeGate = new Promise<void>((resolve) => {
      releaseResubscribe = resolve;
    });
    const originalResubscribe = (connection as any).resubscribeToStreams.bind(connection);
    jest.spyOn(connection as any, 'resubscribeToStreams').mockImplementation(async () => {
      await resubscribeGate;
      return originalResubscribe();
    });

    await fireReconnectAttempt(0);
    const reconnectedWs = latestWs();
    reconnectedWs.open();
    await flushPromises();

    // Socket is open but resubscription is gated — still CONNECTING, not fully ready.
    expect((connection as any).connectionState).toBe('connecting');
    expect(subscribeMessages(reconnectedWs)).toHaveLength(0);

    // Business caller joins the in-flight connect via ensureConnected → connectionPromise.
    let sendResolved = false;
    const sendPromise = connection.send(ScryptMessageType.TRADE, [{ side: 'buy' }]).then(() => {
      sendResolved = true;
    });
    await flushPromises();

    expect(sendResolved).toBe(false);
    expect((connection as any).connectionState).toBe('connecting');
    // TRADE must not be sent until streams are restored.
    const tradeSendsBefore = reconnectedWs.send.mock.calls
      .map(([payload]) => JSON.parse(payload as string))
      .filter((msg) => msg.type === ScryptMessageType.TRADE);
    expect(tradeSendsBefore).toHaveLength(0);

    releaseResubscribe();
    await flushPromises();
    await sendPromise;

    expect((connection as any).connectionState).toBe('connected');
    expect(sendResolved).toBe(true);

    const allSends = reconnectedWs.send.mock.calls.map(([payload]) => JSON.parse(payload as string));
    const firstSubscribeIdx = allSends.findIndex((msg) => msg.type === 'subscribe');
    const tradeIdx = allSends.findIndex((msg) => msg.type === ScryptMessageType.TRADE);
    expect(firstSubscribeIdx).toBeGreaterThanOrEqual(0);
    expect(tradeIdx).toBeGreaterThan(firstSubscribeIdx);
    expect(allSends[firstSubscribeIdx]).toEqual(
      expect.objectContaining({
        type: 'subscribe',
        streams: [expect.objectContaining({ name: ScryptMessageType.BALANCE_TRANSACTION })],
      }),
    );
  });

  it('rejects connect and retries when the socket drops mid-resubscribe (finding 2)', async () => {
    const scheduleSpy = jest.spyOn(connection as any, 'scheduleReconnect');
    const firstWs = await firstConnectWithStream(ScryptMessageType.BALANCE_TRANSACTION);

    firstWs.remoteClose(1006, 'gone');
    expect(scheduleSpy).toHaveBeenCalledWith(0);
    expect((connection as any).isReconnecting).toBe(true);

    await fireReconnectAttempt(0);
    const reconnectedWs = latestWs();

    // Drop the socket as soon as a SUBSCRIBE is attempted during resubscribe.
    reconnectedWs.send.mockImplementation(() => {
      reconnectedWs.readyState = WebSocket.CLOSED;
    });

    reconnectedWs.open();
    await flushPromises();

    // connect() must reject → no success log; isReconnecting stays true; next attempt scheduled.
    expect(loggerInfo).not.toHaveBeenCalledWith(expect.stringMatching(/reconnected/));
    expect((connection as any).isReconnecting).toBe(true);
    expect((connection as any).connectionState).toBe('disconnected');
    expect(loggerWarn).toHaveBeenCalledWith(expect.stringMatching(/reconnect attempt 1 failed/));
    expect(scheduleSpy).toHaveBeenCalledWith(1);

    // Active stream must be kept for the next reconnect retry.
    expect((connection as any).activeStreams.has(ScryptMessageType.BALANCE_TRANSACTION)).toBe(true);

    // Next backoff attempt is scheduled and can succeed.
    await fireReconnectAttempt(1);
    const retryWs = latestWs();
    expect(retryWs).not.toBe(reconnectedWs);
    retryWs.open();
    await flushPromises();

    expect(loggerInfo).toHaveBeenCalledWith(expect.stringMatching(/reconnected \(after 2 attempt/));
    expect((connection as any).isReconnecting).toBe(false);
    expect(
      subscribeMessages(retryWs).some((msg: any) => msg.streams?.[0]?.name === ScryptMessageType.BALANCE_TRANSACTION),
    ).toBe(true);
  });

  it('resubscribes all active streams on reconnect (multi-stream)', async () => {
    const streams = [ScryptMessageType.BALANCE_TRANSACTION, ScryptMessageType.BALANCE, ScryptMessageType.TRADE];
    const firstWs = await firstConnectWithStreams(streams);
    expect(subscribeMessages(firstWs)).toHaveLength(streams.length);

    firstWs.remoteClose(1006, 'gone');
    await fireReconnectAttempt(0);
    const reconnectedWs = latestWs();
    reconnectedWs.open();
    await flushPromises();

    const resubNames = subscribeMessages(reconnectedWs).map((msg: any) => msg.streams?.[0]?.name);
    expect(resubNames).toHaveLength(streams.length);
    for (const stream of streams) {
      expect(resubNames).toContain(stream);
    }
    expect((connection as any).isReconnecting).toBe(false);
  });

  it('caps reconnect backoff at 60s with full jitter in [capped/2, capped]', async () => {
    const setTimeoutSpy = jest.spyOn(global, 'setTimeout');

    // attempt >= 4 → min(5000 * 2**4, 60000) = 60000
    (connection as any).scheduleReconnect(4);

    const reconnectTimerCalls = setTimeoutSpy.mock.calls.filter(
      (call) => typeof call[1] === 'number' && (call[1] as number) >= 1000,
    );
    expect(reconnectTimerCalls.length).toBeGreaterThanOrEqual(1);
    const delay = reconnectTimerCalls[reconnectTimerCalls.length - 1][1] as number;

    expect(delay).toBeGreaterThanOrEqual(30000);
    expect(delay).toBeLessThanOrEqual(60000);
  });

  it('rejects connect on handshake timeout and schedules the next backoff attempt', async () => {
    const scheduleSpy = jest.spyOn(connection as any, 'scheduleReconnect');
    const firstWs = await firstConnectWithStream();

    firstWs.remoteClose(1006, 'gone');
    expect(scheduleSpy).toHaveBeenCalledWith(0);

    await fireReconnectAttempt(0);
    const hungWs = latestWs();
    // Do not call open() — simulate a silent black-hole handshake.
    expect(hungWs.readyState).toBe(WebSocket.CONNECTING);

    jest.advanceTimersByTime(15000);
    await flushPromises();

    expect(hungWs.terminate).toHaveBeenCalled();
    expect(loggerWarn).toHaveBeenCalledWith(expect.stringMatching(/reconnect attempt 1 failed/));
    expect(loggerWarn).toHaveBeenCalledWith(expect.stringMatching(/handshake timed out after 15000ms/));
    expect(scheduleSpy).toHaveBeenCalledWith(1);
    expect((connection as any).isReconnecting).toBe(true);
    expect(loggerInfo).not.toHaveBeenCalledWith(expect.stringMatching(/reconnected/));
  });
});
