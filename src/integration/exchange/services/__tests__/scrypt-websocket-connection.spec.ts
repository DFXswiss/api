import { EventEmitter as MockEventEmitter } from 'events';
import Ws from 'ws';
import {
  isDialableWsUrl,
  ScryptMessageType,
  ScryptRequestTimeoutError,
  ScryptWebSocketConnection,
} from '../scrypt-websocket-connection';

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
  // Drain microtasks from connect() → establishConnection → resubscribeToStreams →
  // sendSubscriptionOnSocket (and nested promise chains) under fake timers. A fixed small number of
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
    expect(scheduleSpy).toHaveBeenCalledWith(0, expect.any(Number));
    expect((connection as any).isReconnecting).toBe(true);
    const loopEpoch = scheduleSpy.mock.calls[0][1] as number;

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
    expect(loggerWarn).toHaveBeenCalledWith(expect.stringMatching(/reconnect attempt 1 failed/), expect.any(Error));
    expect(scheduleSpy).toHaveBeenCalledWith(1, loopEpoch);

    // attempt 1 → delay in [5000, 10000]
    await fireReconnectAttempt(1);
    const attempt1 = latestWs();
    attempt1.fail(new Error('still down'));
    attempt1.remoteClose();
    await flushPromises();

    expect(loggerWarn).toHaveBeenCalledWith(expect.stringMatching(/reconnect attempt 2 failed/), expect.any(Error));
    expect(scheduleSpy).toHaveBeenCalledWith(2, loopEpoch);

    // attempt 2 → delay in [10000, 20000], then succeed
    await fireReconnectAttempt(2);
    const attempt2 = latestWs();
    attempt2.open();
    await flushPromises();

    expect(loggerInfo).toHaveBeenCalledWith(expect.stringMatching(/reconnected \(after 3 attempt/));
    expect((connection as any).isReconnecting).toBe(false);

    // attempts scheduled: 0, 1, 2 (capped bases 5s/10s/20s; actual delay is jittered in [capped/2, capped])
    // Same epoch throughout the loop — retries must not bump reconnectEpoch.
    expect(scheduleSpy.mock.calls.map(([attempt, epoch]: [number, number]) => [attempt, epoch])).toEqual([
      [0, loopEpoch],
      [1, loopEpoch],
      [2, loopEpoch],
    ]);
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
    expect(scheduleSpy).toHaveBeenCalledWith(0, expect.any(Number));
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
    expect(scheduleSpy).toHaveBeenCalledWith(0, expect.any(Number));
    expect((connection as any).isReconnecting).toBe(true);

    await fireReconnectAttempt(0);
    const reconnectedWs = latestWs();

    // Emit a real close during resubscribe so handleDisconnection actually runs (not just a
    // readyState flip that only trips assertSocketOpen). Mid-establish → CONNECTING must stay.
    let stateAtDrop: string | undefined;
    reconnectedWs.send.mockImplementation(() => {
      reconnectedWs.remoteClose(1006, 'drop mid-resubscribe');
      // handleDisconnection is sync on emit; Fix A leaves CONNECTING (was not CONNECTED).
      // Captured here (not asserted) because this callback runs inside resubscribeToStreams'
      // try/catch, which would otherwise swallow a failing expect() and make it vacuous.
      stateAtDrop = (connection as any).connectionState;
    });

    reconnectedWs.open();
    await flushPromises();

    // connect() must reject → no success log; isReconnecting stays true; next attempt scheduled.
    // Final DISCONNECTED comes from connect()'s catch after establishConnection rejects, not from
    // handleDisconnection (which left CONNECTING — asserted above via stateAtDrop).
    expect(stateAtDrop).toBe('connecting');
    expect(loggerInfo).not.toHaveBeenCalledWith(expect.stringMatching(/reconnected/));
    expect((connection as any).isReconnecting).toBe(true);
    expect((connection as any).connectionState).toBe('disconnected');
    expect(loggerWarn).toHaveBeenCalledWith(expect.stringMatching(/reconnect attempt 1 failed/), expect.any(Error));
    expect(scheduleSpy).toHaveBeenCalledWith(1, expect.any(Number));

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

  it('clears stale reconnect state when a business call heals the socket (finding 1 — heal clears isReconnecting)', async () => {
    const firstWs = await firstConnectWithStream(ScryptMessageType.BALANCE_TRANSACTION);

    firstWs.remoteClose(1006, 'gone');
    expect((connection as any).isReconnecting).toBe(true);
    expect((connection as any).reconnectTimer).toBeDefined();

    // Before the backoff timer fires, a business call heals via ensureConnected.
    const sendPromise = connection.send(ScryptMessageType.TRADE, [{ side: 'buy' }]);
    await flushPromises();
    latestWs().open();
    await flushPromises();
    await sendPromise;

    expect((connection as any).connectionState).toBe('connected');
    expect((connection as any).isReconnecting).toBe(false);
    expect((connection as any).reconnectTimer).toBeUndefined();

    // A second drop on the healed socket must start a fresh reconnect loop (not skipped by stale true).
    loggerWarn.mockClear();
    latestWs().remoteClose(1006, 'gone again');
    expect((connection as any).isReconnecting).toBe(true);
    expect(loggerWarn).toHaveBeenCalledWith(expect.stringMatching(/closed \(code: 1006/));
  });

  it('disconnect() clears activeStreams so a later re-subscribe sends only one SUBSCRIBE (finding 2 — no double-send on reuse)', async () => {
    const streamName = ScryptMessageType.BALANCE_TRANSACTION;
    await firstConnectWithStream(streamName);

    await connection.disconnect();

    connection.subscribeToStream(streamName, () => undefined);
    const newWs = latestWs();
    newWs.open();
    await flushPromises();

    const streamSubs = subscribeMessages(newWs).filter((msg: any) =>
      msg.streams?.some((s: any) => s.name === streamName),
    );
    expect(streamSubs).toHaveLength(1);
    expect(streamSubs[0]).toEqual(
      expect.objectContaining({
        type: 'subscribe',
        streams: [expect.objectContaining({ name: streamName })],
      }),
    );
  });

  it('mid-establish drop does not spawn a second establishConnection (concurrency)', async () => {
    const firstWs = await firstConnectWithStream(ScryptMessageType.BALANCE_TRANSACTION);
    firstWs.remoteClose(1006, 'gone');

    // Gate resubscribe so we can observe the CONNECTING window after a real mid-establish close.
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

    // Handshake done, resubscribe gated — still CONNECTING with an in-flight connectionPromise.
    expect((connection as any).connectionState).toBe('connecting');
    expect((connection as any).connectionPromise).toBeDefined();
    const inFlightPromise = (connection as any).connectionPromise;
    const constructCountBeforeClose = WebSocket.instances.length;

    // Real close mid-establish: Fix A leaves CONNECTING (was not CONNECTED).
    reconnectedWs.remoteClose(1006, 'drop mid-establish');
    expect((connection as any).connectionState).toBe('connecting');
    expect((connection as any).connectionPromise).toBe(inFlightPromise);
    expect((connection as any).ws).toBeUndefined();

    // Concurrent business call must join the same in-flight promise — no second WebSocket.
    const sendPromise = connection.send(ScryptMessageType.TRADE, [{ side: 'buy' }]);
    await flushPromises();

    expect(WebSocket.instances.length).toBe(constructCountBeforeClose);
    expect((connection as any).connectionState).toBe('connecting');
    expect((connection as any).connectionPromise).toBe(inFlightPromise);

    // Let establishConnection finish: resubscribe sees dead socket, assertSocketOpen rejects.
    releaseResubscribe();
    await flushPromises();

    await expect(sendPromise).rejects.toThrow();
    expect((connection as any).connectionState).toBe('disconnected');
    expect((connection as any).connectionPromise).toBeUndefined();
    // Still no extra socket constructed during the concurrent join window.
    expect(WebSocket.instances.length).toBe(constructCountBeforeClose);
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

  it('caps reconnect backoff at 60s with equal jitter in [capped/2, capped]', async () => {
    const setTimeoutSpy = jest.spyOn(global, 'setTimeout');

    // attempt >= 4 → min(5000 * 2**4, 60000) = 60000
    (connection as any).scheduleReconnect(4, (connection as any).reconnectEpoch);

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
    expect(scheduleSpy).toHaveBeenCalledWith(0, expect.any(Number));

    await fireReconnectAttempt(0);
    const hungWs = latestWs();
    // Do not call open() — simulate a silent black-hole handshake.
    expect(hungWs.readyState).toBe(WebSocket.CONNECTING);

    jest.advanceTimersByTime(15000);
    await flushPromises();

    expect(hungWs.terminate).toHaveBeenCalled();
    expect(loggerWarn).toHaveBeenCalledWith(
      expect.stringMatching(/reconnect attempt 1 failed/),
      expect.objectContaining({ message: expect.stringMatching(/handshake timed out after 15000ms/) }),
    );
    expect(scheduleSpy).toHaveBeenCalledWith(1, expect.any(Number));
    expect((connection as any).isReconnecting).toBe(true);
    expect(loggerInfo).not.toHaveBeenCalledWith(expect.stringMatching(/reconnected/));
  });

  it("ignores a stale (superseded) socket's close (B3)", async () => {
    const scheduleSpy = jest.spyOn(connection as any, 'scheduleReconnect');
    const firstWs = await firstConnectWithStream();

    expect((connection as any).connectionGeneration).toBe(1);
    expect((connection as any).ws).toBe(firstWs);
    expect((connection as any).connectionState).toBe('connected');

    // Simulate a close event from a prior attempt whose captured generation is no longer current.
    (connection as any).handleDisconnection(0, 1006, 'stale');

    expect((connection as any).ws).toBe(firstWs);
    expect((connection as any).connectionState).toBe('connected');
    expect((connection as any).isReconnecting).toBe(false);
    expect(scheduleSpy).not.toHaveBeenCalled();
    expect(loggerWarn).not.toHaveBeenCalledWith(expect.stringMatching(/closed \(code:/));
  });

  it('disconnect() during pre-open handshake supersedes it — socket is terminated and not adopted (B1)', async () => {
    const connectPromise = (connection as any).connect();
    await flushPromises();

    expect((connection as any).connectionState).toBe('connecting');
    const preOpenWs = latestWs();
    expect(preOpenWs.readyState).toBe(WebSocket.CONNECTING);

    await connection.disconnect();

    preOpenWs.open();
    await flushPromises();

    expect(preOpenWs.terminate).toHaveBeenCalled();
    expect((connection as any).ws).toBeUndefined();
    expect((connection as any).connectionState).toBe('disconnected');
    await expect(connectPromise).rejects.toThrow(/superseded/i);
  });

  it('disconnect() during pre-open handshake then connect() starts a fresh attempt, not joining the superseded promise', async () => {
    const firstConnectPromise = (connection as any).connect();
    await flushPromises();

    expect((connection as any).connectionState).toBe('connecting');
    const preOpenWs = latestWs();
    expect(preOpenWs.readyState).toBe(WebSocket.CONNECTING);
    const constructCountBeforeDisconnect = WebSocket.instances.length;
    const generationBeforeDisconnect = (connection as any).connectionGeneration;

    await connection.disconnect();

    // Fix: disconnect() resets state synchronously even though ws never opened.
    expect((connection as any).connectionState).toBe('disconnected');
    expect((connection as any).connectionPromise).toBeUndefined();

    // A fresh connect() call, issued before the pre-open socket ever settles, must start a NEW
    // attempt — not join the doomed promise from the superseded attempt.
    const secondConnectPromise = (connection as any).connect();
    await flushPromises();

    expect(WebSocket.instances.length).toBe(constructCountBeforeDisconnect + 1);
    expect((connection as any).connectionGeneration).toBeGreaterThan(generationBeforeDisconnect);
    expect(secondConnectPromise).not.toBe(firstConnectPromise);

    const freshWs = latestWs();
    expect(freshWs).not.toBe(preOpenWs);
    freshWs.open();
    await flushPromises();

    await expect(secondConnectPromise).resolves.toBeUndefined();
    expect((connection as any).connectionState).toBe('connected');

    // The stale pre-open socket, when it eventually opens, must still be rejected/terminated and
    // must not clobber the fresh connection now in place.
    preOpenWs.open();
    await flushPromises();
    await expect(firstConnectPromise).rejects.toThrow(/superseded/i);
    expect(preOpenWs.terminate).toHaveBeenCalled();
    expect((connection as any).ws).toBe(freshWs);
    expect((connection as any).connectionState).toBe('connected');
  });

  it('disconnect() stops the backoff loop — no further reconnect after advancing timers (B2)', async () => {
    const firstWs = await firstConnectWithStream();
    firstWs.remoteClose(1006, 'gone');
    expect((connection as any).isReconnecting).toBe(true);

    const constructCountBeforeDisconnect = WebSocket.instances.length;
    await connection.disconnect();
    expect((connection as any).isReconnecting).toBe(false);

    // Re-arm a timer with a STALE epoch so the setTimeout callback's epoch guard is exercised
    // (not merely clearTimeout of a still-pending timer). disconnect() already bumped reconnectEpoch.
    const staleEpoch = (connection as any).reconnectEpoch - 1;
    (connection as any).scheduleReconnect(0, staleEpoch);
    jest.advanceTimersByTime(60000 * 3);
    await flushPromises();

    expect(WebSocket.instances.length).toBe(constructCountBeforeDisconnect);
    expect((connection as any).isReconnecting).toBe(false);
  });

  it('stale reconnect loop settle does not disturb a newer loop after disconnect + drop', async () => {
    // Prove Fix 3: a superseded reconnect loop's late-settling connect() must not clear
    // isReconnecting or log "reconnected" for a newer live loop started after disconnect + drop.
    const scheduleSpy = jest.spyOn(connection as any, 'scheduleReconnect');
    const firstWs = await firstConnectWithStream(ScryptMessageType.BALANCE_TRANSACTION);

    // Start loop A via unexpected drop.
    firstWs.remoteClose(1006, 'gone');
    expect((connection as any).isReconnecting).toBe(true);
    expect(scheduleSpy).toHaveBeenCalledWith(0, expect.any(Number));
    const epochA = scheduleSpy.mock.calls[0][1] as number;

    // Gate connect() so loop A's attempt stays in-flight.
    let releaseConnectA!: () => void;
    const connectAGate = new Promise<void>((resolve) => {
      releaseConnectA = resolve;
    });
    let connectCallCount = 0;
    const connectSpy = jest.spyOn(connection as any, 'connect').mockImplementation(async () => {
      connectCallCount += 1;
      if (connectCallCount === 1) {
        await connectAGate;
        return;
      }
      throw new Error('unexpected extra connect while loop A spy is active');
    });

    await fireReconnectAttempt(0);
    expect(connectCallCount).toBe(1);
    expect((connection as any).isReconnecting).toBe(true);

    // disconnect() supersedes loop A: bumps epoch, clears isReconnecting, cancels timer.
    await connection.disconnect();
    expect((connection as any).isReconnecting).toBe(false);
    expect((connection as any).reconnectEpoch).toBeGreaterThan(epochA);

    // Fresh connection + drop starts loop B with a new epoch.
    connectSpy.mockRestore();
    connection.subscribeToStream(ScryptMessageType.BALANCE_TRANSACTION, () => undefined);
    await flushPromises();
    const secondWs = latestWs();
    secondWs.open();
    await flushPromises();
    expect((connection as any).connectionState).toBe('connected');

    const scheduleCountBeforeLoopB = scheduleSpy.mock.calls.length;
    secondWs.remoteClose(1006, 'drop again');
    expect((connection as any).isReconnecting).toBe(true);
    expect(scheduleSpy.mock.calls.length).toBe(scheduleCountBeforeLoopB + 1);
    const epochB = scheduleSpy.mock.calls[scheduleSpy.mock.calls.length - 1][1] as number;
    expect(epochB).toBeGreaterThan(epochA);
    expect(epochB).toBe((connection as any).reconnectEpoch);

    const constructCountWithLoopBPending = WebSocket.instances.length;
    const timerAfterLoopB = (connection as any).reconnectTimer;
    expect(timerAfterLoopB).toBeDefined();

    // Let loop A's gated connect finally resolve — stale .then must no-op.
    loggerInfo.mockClear();
    releaseConnectA();
    await flushPromises();

    expect((connection as any).isReconnecting).toBe(true);
    expect((connection as any).reconnectEpoch).toBe(epochB);
    expect((connection as any).reconnectTimer).toBe(timerAfterLoopB);
    expect(loggerInfo).not.toHaveBeenCalledWith(expect.stringMatching(/reconnected/));
    expect(scheduleSpy.mock.calls.length).toBe(scheduleCountBeforeLoopB + 1);
    expect(WebSocket.instances.length).toBe(constructCountWithLoopBPending);
  });

  it('fetchAll sends a cancel after collecting all pages', async () => {
    const ws = await firstConnectWithStream();
    const streamName = ScryptMessageType.BALANCE_TRANSACTION;

    const fetchPromise = connection.fetchAll(streamName);
    await flushPromises();

    // First page (subscribe) — find the ad-hoc subscribe reqid (not the long-lived stream sub).
    const page1Send = ws.send.mock.calls
      .map(([payload], idx) => ({ msg: JSON.parse(payload as string), idx }))
      .filter(({ msg }) => msg.type === 'subscribe' && msg.streams?.[0]?.name === streamName)
      .pop();
    expect(page1Send).toBeDefined();
    const reqId = page1Send!.msg.reqid as number;

    ws.emit(
      'message',
      JSON.stringify({
        reqid: reqId,
        type: streamName,
        initial: true,
        data: [{ id: 1 }],
        next: 'cursor1',
      }),
    );
    await flushPromises();

    // Second page (page request reuses the same reqid)
    const page2Send = ws.send.mock.calls
      .map(([payload], idx) => ({ msg: JSON.parse(payload as string), idx }))
      .find(({ msg }) => msg.type === 'page' && msg.reqid === reqId);
    expect(page2Send).toBeDefined();
    const page2Idx = page2Send!.idx;

    ws.emit(
      'message',
      JSON.stringify({
        reqid: reqId,
        type: streamName,
        data: [{ id: 2 }],
      }),
    );
    await flushPromises();

    const result = await fetchPromise;
    expect(result).toEqual([{ id: 1 }, { id: 2 }]);

    const cancelSend = ws.send.mock.calls
      .map(([payload], idx) => ({ msg: JSON.parse(payload as string), idx }))
      .find(({ msg }) => msg.type === 'cancel' && msg.reqid === reqId);
    expect(cancelSend).toBeDefined();
    expect(cancelSend!.msg).toEqual({ reqid: reqId, type: 'cancel' });
    // Cancel must be sent after the page-2 request (collection complete).
    expect(cancelSend!.idx).toBeGreaterThan(page2Idx);
  });

  it('fetch sends a cancel after collecting its response', async () => {
    const ws = await firstConnectWithStream();
    const streamName = ScryptMessageType.EXECUTION_REPORT;

    const fetchPromise = connection.fetch(streamName);
    await flushPromises();

    const subscribeSend = ws.send.mock.calls
      .map(([payload], idx) => ({ msg: JSON.parse(payload as string), idx }))
      .filter(({ msg }) => msg.type === 'subscribe' && msg.streams?.[0]?.name === streamName)
      .pop();
    expect(subscribeSend).toBeDefined();
    const reqId = subscribeSend!.msg.reqid as number;
    const subscribeIdx = subscribeSend!.idx;

    ws.emit(
      'message',
      JSON.stringify({
        reqid: reqId,
        type: streamName,
        initial: true,
        data: [{ ClOrdID: 'ord-1' }],
      }),
    );
    await flushPromises();

    const result = await fetchPromise;
    expect(result).toEqual([{ ClOrdID: 'ord-1' }]);

    const cancelSend = ws.send.mock.calls
      .map(([payload], idx) => ({ msg: JSON.parse(payload as string), idx }))
      .find(({ msg }) => msg.type === 'cancel' && msg.reqid === reqId);
    expect(cancelSend).toBeDefined();
    expect(cancelSend!.msg).toEqual({ reqid: reqId, type: 'cancel' });
    expect(cancelSend!.idx).toBeGreaterThan(subscribeIdx);
  });

  it('sendCancel is a no-op when the socket is not open', () => {
    expect(WebSocket.instances.length).toBe(0);
    expect((connection as any).ws).toBeUndefined();

    expect(() => (connection as any).sendCancel(123)).not.toThrow();

    expect(WebSocket.instances.length).toBe(0);
  });

  it('sendCancel is a no-op when the socket is present but not OPEN', async () => {
    const ws = await firstConnectWithStream();
    const sendCallsBefore = ws.send.mock.calls.length;

    ws.readyState = WebSocket.CLOSING;
    (connection as any).ws = ws;

    expect(() => (connection as any).sendCancel(456)).not.toThrow();

    const cancelSends = ws.send.mock.calls
      .slice(sendCallsBefore)
      .map(([payload]) => JSON.parse(payload as string))
      .filter((msg) => msg.type === 'cancel');
    expect(cancelSends).toHaveLength(0);
  });

  it('fetch resolves with its collected data even when the cancel frame throws synchronously', async () => {
    const ws = await firstConnectWithStream();
    const streamName = ScryptMessageType.EXECUTION_REPORT;

    const fetchPromise = connection.fetch(streamName);
    await flushPromises();

    const subscribeSend = ws.send.mock.calls
      .map(([payload], idx) => ({ msg: JSON.parse(payload as string), idx }))
      .filter(({ msg }) => msg.type === 'subscribe' && msg.streams?.[0]?.name === streamName)
      .pop();
    expect(subscribeSend).toBeDefined();
    const reqId = subscribeSend!.msg.reqid as number;

    ws.emit(
      'message',
      JSON.stringify({
        reqid: reqId,
        type: streamName,
        initial: true,
        data: [{ ClOrdID: 'ord-cancel-throw' }],
      }),
    );

    // Scope the throw to the very next ws.send call — the CANCEL frame sent from fetch's finally block.
    // Must be set synchronously right after emit, before any await drains the microtask queue.
    ws.send.mockImplementationOnce(() => {
      throw new Error('send failed');
    });

    const result = await fetchPromise;

    expect(result).toEqual([{ ClOrdID: 'ord-cancel-throw' }]);
    expect(loggerError).toHaveBeenCalledWith(`Failed to cancel Scrypt stream ${reqId}:`, expect.any(Error));
  });

  it('fetch still sends cancel when the collect path throws (malformed initial)', async () => {
    const ws = await firstConnectWithStream();
    const streamName = ScryptMessageType.EXECUTION_REPORT;

    const fetchPromise = connection.fetch(streamName);
    await flushPromises();

    const subscribeSend = ws.send.mock.calls
      .map(([payload], idx) => ({ msg: JSON.parse(payload as string), idx }))
      .filter(({ msg }) => msg.type === 'subscribe' && msg.streams?.[0]?.name === streamName)
      .pop();
    expect(subscribeSend).toBeDefined();
    const reqId = subscribeSend!.msg.reqid as number;

    ws.emit(
      'message',
      JSON.stringify({
        reqid: reqId,
        type: streamName,
        initial: false,
        data: [{ ClOrdID: 'ord-bad' }],
      }),
    );
    await flushPromises();

    await expect(fetchPromise).rejects.toThrow(/Expected initial/);

    const cancelSend = ws.send.mock.calls
      .map(([payload]) => JSON.parse(payload as string))
      .find((msg) => msg.type === 'cancel' && msg.reqid === reqId);
    expect(cancelSend).toBeDefined();
    expect(cancelSend).toEqual({ reqid: reqId, type: 'cancel' });
  });

  it('fetchAll still sends cancel when the collect path throws (malformed initial)', async () => {
    const ws = await firstConnectWithStream();
    const streamName = ScryptMessageType.BALANCE_TRANSACTION;

    const fetchPromise = connection.fetchAll(streamName);
    await flushPromises();

    const page1Send = ws.send.mock.calls
      .map(([payload], idx) => ({ msg: JSON.parse(payload as string), idx }))
      .filter(({ msg }) => msg.type === 'subscribe' && msg.streams?.[0]?.name === streamName)
      .pop();
    expect(page1Send).toBeDefined();
    const reqId = page1Send!.msg.reqid as number;

    ws.emit(
      'message',
      JSON.stringify({
        reqid: reqId,
        type: streamName,
        // omit initial — malformed first page
        data: [{ id: 1 }],
      }),
    );
    await flushPromises();

    await expect(fetchPromise).rejects.toThrow(/Expected initial/);

    const cancelSend = ws.send.mock.calls
      .map(([payload]) => JSON.parse(payload as string))
      .find((msg) => msg.type === 'cancel' && msg.reqid === reqId);
    expect(cancelSend).toBeDefined();
    expect(cancelSend).toEqual({ reqid: reqId, type: 'cancel' });
  });

  it('fires onReconnect callbacks on genuine reconnect but not on first connect', async () => {
    const cb = jest.fn();
    connection.onReconnect(cb);

    await firstConnectWithStream();
    expect(cb).not.toHaveBeenCalled();

    const firstWs = latestWs();
    firstWs.remoteClose(1006, 'gone');
    await fireReconnectAttempt(0);
    const reconnectedWs = latestWs();
    reconnectedWs.open();
    await flushPromises();

    expect(cb).toHaveBeenCalledTimes(1);
  });

  describe('failed first connect (#4310 finding A)', () => {
    it('keeps the streams and schedules a reconnect when the very first connect never opens', async () => {
      const scheduleSpy = jest.spyOn(connection as any, 'scheduleReconnect');

      connection.subscribeToStream(ScryptMessageType.BALANCE_TRANSACTION, () => undefined);
      const deadWs = latestWs();

      // Black-hole handshake on the FIRST attempt: nothing was ever CONNECTED, so no close event with
      // wasConnected=true will arrive to arm handleDisconnection's loop.
      jest.advanceTimersByTime(15000);
      await flushPromises();

      expect(deadWs.terminate).toHaveBeenCalled();
      expect(subscribeMessages(deadWs)).toHaveLength(0);
      // The stream must survive the failure — dropping it is what made this permanent.
      expect([...(connection as any).activeStreams]).toEqual([ScryptMessageType.BALANCE_TRANSACTION]);
      expect((connection as any).isReconnecting).toBe(true);
      expect(scheduleSpy).toHaveBeenCalledWith(0, expect.any(Number));

      await fireReconnectAttempt(0);
      const healedWs = latestWs();
      expect(healedWs).not.toBe(deadWs);
      healedWs.open();
      await flushPromises();

      expect((connection as any).connectionState).toBe('connected');
      expect(subscribeMessages(healedWs)).toHaveLength(1);
      expect(subscribeMessages(healedWs)[0]).toEqual(
        expect.objectContaining({
          type: 'subscribe',
          streams: [expect.objectContaining({ name: ScryptMessageType.BALANCE_TRANSACTION })],
        }),
      );
    });

    it('fires onReconnect callbacks once a failed first connect finally heals', async () => {
      const onReconnect = jest.fn();
      connection.onReconnect(onReconnect);

      connection.subscribeToStream(ScryptMessageType.BALANCE, () => undefined);
      jest.advanceTimersByTime(15000);
      await flushPromises();

      expect(onReconnect).not.toHaveBeenCalled();

      await fireReconnectAttempt(0);
      latestWs().open();
      await flushPromises();

      // The constructor warm-up died with the failed attempt, so the caches are owed the same catch-up a
      // drop would owe — without this the streams come back live over permanently empty caches.
      expect(onReconnect).toHaveBeenCalledTimes(1);
    });

    it('sends exactly one SUBSCRIBE per stream when a subscribe lands mid-reconnect', async () => {
      const firstWs = await firstConnectWithStream(ScryptMessageType.BALANCE_TRANSACTION);
      firstWs.remoteClose(1006, 'gone');

      await fireReconnectAttempt(0); // new socket exists but is still CONNECTING
      connection.subscribeToStream(ScryptMessageType.SECURITY, () => undefined);

      const reconnectedWs = latestWs();
      reconnectedWs.open();
      await flushPromises();

      const names = subscribeMessages(reconnectedWs).map((msg: any) => msg.streams[0].name);
      expect(names).toHaveLength(2); // restored stream + the newly subscribed one, neither doubled
      expect([...names].sort()).toEqual([ScryptMessageType.BALANCE_TRANSACTION, ScryptMessageType.SECURITY].sort());
    });

    it('does not start a reconnect loop when a failed connect owes no streams', async () => {
      const scheduleSpy = jest.spyOn(connection as any, 'scheduleReconnect');

      const settled = (connection as any).connect().then(
        () => 'resolved',
        () => 'rejected',
      );
      jest.advanceTimersByTime(15000);
      await flushPromises();

      await expect(settled).resolves.toBe('rejected');
      // Nothing to restore: the caller retries on its own, a loop would reconnect for nobody.
      expect(scheduleSpy).not.toHaveBeenCalled();
      expect((connection as any).isReconnecting).toBe(false);
    });

    it('replays the subscription filters when a stream is restored', async () => {
      connection.subscribeToStream(ScryptMessageType.EXECUTION_REPORT, () => undefined, {
        StartDate: '2026-01-01T00:00:00.000000Z',
      });

      jest.advanceTimersByTime(15000);
      await flushPromises();

      await fireReconnectAttempt(0);
      const healedWs = latestWs();
      healedWs.open();
      await flushPromises();

      expect(subscribeMessages(healedWs)[0]).toEqual(
        expect.objectContaining({
          streams: [
            expect.objectContaining({
              name: ScryptMessageType.EXECUTION_REPORT,
              StartDate: '2026-01-01T00:00:00.000000Z',
            }),
          ],
        }),
      );
    });
  });

  describe('reconnect loop lifecycle', () => {
    it('stands down when every stream was unsubscribed while the timer waited', async () => {
      const unsubscribe = connection.subscribeToStream(ScryptMessageType.BALANCE_TRANSACTION, () => undefined);
      const ws = latestWs();
      ws.open();
      await flushPromises();

      ws.remoteClose(1006, 'gone');
      expect((connection as any).isReconnecting).toBe(true);

      unsubscribe();
      expect((connection as any).activeStreams.size).toBe(0);

      const socketsBefore = WebSocket.instances.length;
      await fireReconnectAttempt(0);

      expect(WebSocket.instances.length).toBe(socketsBefore); // no socket that nobody would read
      expect((connection as any).isReconnecting).toBe(false);
    });

    it('does not report a reconnect when connect() short-circuits on a stale CONNECTED state', async () => {
      const ws = await firstConnectWithStream(ScryptMessageType.BALANCE_TRANSACTION);

      // The socket is on its way out but its close event has not been delivered yet, so connectionState
      // is still CONNECTED and connect() returns without doing anything.
      ws.readyState = WebSocket.CLOSING;

      connection.subscribeToStream(ScryptMessageType.SECURITY, () => undefined);
      await flushPromises();
      expect((connection as any).isReconnecting).toBe(true);

      const scheduleSpy = jest.spyOn(connection as any, 'scheduleReconnect');
      await fireReconnectAttempt(0);

      expect(loggerInfo).not.toHaveBeenCalledWith(expect.stringMatching(/reconnected/));
      expect((connection as any).isReconnecting).toBe(true);
      // Staying armed is not enough: the loop must actually have a live timer. Dropping the reschedule here
      // would leave isReconnecting true with nothing pending, and no path re-arms it — a permanent outage
      // that "still armed" alone cannot tell apart from a healthy loop.
      expect(scheduleSpy).toHaveBeenCalledWith(1, expect.any(Number));
      expect(jest.getTimerCount()).toBe(1);

      // And it heals for real once the close event finally lands.
      ws.remoteClose(1006, 'late close');
      await fireReconnectAttempt(1);
      const healedWs = latestWs();
      healedWs.open();
      await flushPromises();

      expect((connection as any).isReconnecting).toBe(false);
      expect(
        subscribeMessages(healedWs)
          .map((msg: any) => msg.streams[0].name)
          .sort(),
      ).toEqual([ScryptMessageType.BALANCE_TRANSACTION, ScryptMessageType.SECURITY].sort());
    });

    it('keeps a live subscribe claim when an overlapping earlier call settles', async () => {
      const onReconnect = jest.fn();
      connection.onReconnect(onReconnect);

      connection.subscribeToStream(ScryptMessageType.BALANCE_TRANSACTION, () => undefined);
      const firstWs = latestWs(); // still CONNECTING — its subscribe() holds the claim

      await connection.disconnect();

      connection.subscribeToStream(ScryptMessageType.BALANCE_TRANSACTION, () => undefined);
      const secondWs = latestWs();
      expect(secondWs).not.toBe(firstWs);

      firstWs.fail(new Error('superseded attempt dies')); // must release only its own claim
      await flushPromises();

      secondWs.open();
      await flushPromises();

      expect(subscribeMessages(secondWs)).toHaveLength(1);
      expect(onReconnect).not.toHaveBeenCalled();
    });

    it('arms the loop when a business call finds the socket closing under a stale CONNECTED state', async () => {
      const ws = await firstConnectWithStream(ScryptMessageType.BALANCE_TRANSACTION);
      ws.readyState = WebSocket.CLOSING; // close event not delivered yet, so connect() still short-circuits

      // A plain read, not a subscribe: nothing else in this path would arm the loop.
      await expect(connection.fetch(ScryptMessageType.BALANCE)).rejects.toThrow(/WebSocket connection failed/);

      expect((connection as any).isReconnecting).toBe(true);
      expect(jest.getTimerCount()).toBe(1);
    });

    it('still logs the close code and reason when the loop was already armed', async () => {
      const ws = await firstConnectWithStream(ScryptMessageType.BALANCE_TRANSACTION);
      ws.readyState = WebSocket.CLOSING;

      // A read arms the loop first; the close event then arrives with isReconnecting already true.
      await expect(connection.fetch(ScryptMessageType.BALANCE)).rejects.toThrow(/WebSocket connection failed/);
      expect((connection as any).isReconnecting).toBe(true);

      ws.remoteClose(1006, 'gone');

      // Folding this log into the arming branch would drop it in exactly the windows where something else
      // armed first — losing the close code on a flapping connection, which is the outage signal.
      expect(loggerWarn).toHaveBeenCalledWith(expect.stringMatching(/closed \(code: 1006, reason: gone\)/));
    });

    it('fires catch-up on a genuine reconnect even when nothing needed restoring', async () => {
      const onReconnect = jest.fn();
      connection.onReconnect(onReconnect);

      const unsubscribe = connection.subscribeToStream(ScryptMessageType.BALANCE_TRANSACTION, () => undefined);
      const ws = latestWs();
      ws.open();
      await flushPromises();

      ws.remoteClose(1006, 'gone'); // arms the loop while BALANCE_TRANSACTION is still active

      // Swap the active stream while the timer waits: the survivor is claimed by its own pending subscribe,
      // so the reconnect restores nothing and only "we were connected before" can fire the catch-up.
      unsubscribe();
      connection.subscribeToStream(ScryptMessageType.SECURITY, () => undefined);

      await fireReconnectAttempt(0);
      const reconnectedWs = latestWs();
      reconnectedWs.open();
      await flushPromises();

      expect(onReconnect).toHaveBeenCalledTimes(1);
    });

    it('a claim left behind by disconnect() does not suppress a later restore', async () => {
      connection.subscribeToStream(ScryptMessageType.BALANCE_TRANSACTION, () => undefined);
      const abandonedWs = latestWs(); // never opens; its subscribe() stays in flight behind the handshake timeout

      await connection.disconnect();

      connection.subscribeToStream(ScryptMessageType.BALANCE_TRANSACTION, () => undefined);
      const liveWs = latestWs();
      liveWs.open();
      await flushPromises();
      expect(subscribeMessages(liveWs)).toHaveLength(1);

      // Drop the live socket well inside the abandoned attempt's 15s handshake timeout, so its claim would
      // still be outstanding if disconnect() had left it behind.
      liveWs.remoteClose(1006, 'gone');
      await fireReconnectAttempt(0);
      const restoredWs = latestWs();
      expect(restoredWs).not.toBe(abandonedWs);
      restoredWs.open();
      await flushPromises();

      expect(subscribeMessages(restoredWs)).toHaveLength(1); // restored, not skipped as "someone else's"
    });

    it('does not schedule reconnects for a URL it cannot dial', async () => {
      const broken = new ScryptWebSocketConnection('not-a-url', 'api-key', 'api-secret');
      const brokenError = jest.spyOn((broken as any).logger, 'error').mockImplementation(() => undefined);
      const scheduleSpy = jest.spyOn(broken as any, 'scheduleReconnect');

      broken.subscribeToStream(ScryptMessageType.BALANCE, () => undefined);
      await flushPromises();
      broken.subscribeToStream(ScryptMessageType.SECURITY, () => undefined);
      await flushPromises();

      // Retrying cannot fix a URL — looping would warn forever without ever connecting.
      expect(scheduleSpy).not.toHaveBeenCalled();
      expect((broken as any).isReconnecting).toBe(false);
      expect(brokenError.mock.calls.filter(([msg]) => /not dialable/.test(String(msg)))).toHaveLength(1);
    });
  });

  describe('dialable url', () => {
    it.each([
      ['wss://scrypt.example/ws', true],
      ['ws://scrypt.example/ws', true],
      ['https://scrypt.example/ws', true],
      ['http://scrypt.example/ws', true],
      ['', false],
      [undefined, false],
      ['not-a-url', false],
      ['scrypt.example/ws', false], // no scheme
      ['scrypt.example:443', false], // parses, but the host lands in the scheme
      ['ftp://scrypt.example/ws', false], // parses with a host, but the client refuses the scheme
      ['wss://scrypt.example/ws#v1', false], // the ws client throws on any fragment
    ])('isDialableWsUrl(%p) === %p', (url, expected) => {
      expect(isDialableWsUrl(url as string | undefined)).toBe(expected);
    });

    it('arms no loop and reports once for a scheme the client would refuse', async () => {
      const broken = new ScryptWebSocketConnection('ftp://scrypt.example/ws', 'api-key', 'api-secret');
      const brokenError = jest.spyOn((broken as any).logger, 'error').mockImplementation(() => undefined);
      const scheduleSpy = jest.spyOn(broken as any, 'scheduleReconnect');

      broken.subscribeToStream(ScryptMessageType.BALANCE, () => undefined);
      // The real ws constructor rejects this scheme synchronously; the mock does not, so drive the attempt to
      // its handshake timeout to reach the same failure the guard has to answer for.
      jest.advanceTimersByTime(15000);
      await flushPromises();

      expect(scheduleSpy).not.toHaveBeenCalled();
      expect((broken as any).isReconnecting).toBe(false);
      expect(brokenError.mock.calls.filter(([msg]) => /not dialable/.test(String(msg)))).toHaveLength(1);
    });
  });

  describe('stream state resets', () => {
    it('forgets stream filters so a later unfiltered subscribe is not restored with the old filter', async () => {
      const unsubscribe = connection.subscribeToStream(ScryptMessageType.EXECUTION_REPORT, () => undefined, {
        StartDate: '2026-01-01T00:00:00.000000Z',
      });
      latestWs().open();
      await flushPromises();

      unsubscribe(); // drops the stream and must drop its filter with it

      connection.subscribeToStream(ScryptMessageType.EXECUTION_REPORT, () => undefined); // no filter this time
      await flushPromises();
      const ws = latestWs();
      ws.remoteClose(1006, 'gone');
      await fireReconnectAttempt(0);
      const reconnectedWs = latestWs();
      reconnectedWs.open();
      await flushPromises();

      const restored = subscribeMessages(reconnectedWs)[0] as any;
      expect(restored.streams[0]).not.toHaveProperty('StartDate');
    });

    it('clears stream filters on disconnect so a reused connection does not replay them', async () => {
      connection.subscribeToStream(ScryptMessageType.EXECUTION_REPORT, () => undefined, {
        StartDate: '2026-01-01T00:00:00.000000Z',
      });
      latestWs().open();
      await flushPromises();

      await connection.disconnect();

      connection.subscribeToStream(ScryptMessageType.EXECUTION_REPORT, () => undefined);
      const reusedWs = latestWs();
      reusedWs.open();
      await flushPromises();

      const sent = subscribeMessages(reusedWs)[0] as any;
      expect(sent.streams[0]).not.toHaveProperty('StartDate');

      // The frame above comes from the new subscribe's own call, so it proves nothing about the stored
      // filters. Only a restore reads streamFilters — drive one.
      reusedWs.remoteClose(1006, 'gone');
      await fireReconnectAttempt(0);
      const restoredWs = latestWs();
      restoredWs.open();
      await flushPromises();

      expect((subscribeMessages(restoredWs)[0] as any).streams[0]).not.toHaveProperty('StartDate');
    });

    it('resets hasEverConnected so a reused connection does not fire catch-up on its first connect', async () => {
      const onReconnect = jest.fn();
      connection.onReconnect(onReconnect);

      const ws = await firstConnectWithStream(ScryptMessageType.BALANCE);
      expect(ws).toBeDefined();
      expect(onReconnect).not.toHaveBeenCalled();

      await connection.disconnect();

      connection.subscribeToStream(ScryptMessageType.BALANCE, () => undefined);
      latestWs().open();
      await flushPromises();

      // A reused connection starts over — its first connect owes no catch-up.
      expect(onReconnect).not.toHaveBeenCalled();
    });
  });

  describe('unanswered requests', () => {
    const REQUEST_TIMEOUT_MS = 30000;

    function subscribeReqIds(ws: MockWebSocketInstance, streamName: ScryptMessageType): number[] {
      return ws.send.mock.calls
        .map(([payload]) => JSON.parse(payload as string))
        .filter((msg) => msg.type === 'subscribe' && msg.streams?.[0]?.name === streamName)
        .map((msg) => msg.reqid as number);
    }

    it('retries a read once when the venue never answers, instead of failing the caller', async () => {
      const ws = await firstConnectWithStream();
      const streamName = ScryptMessageType.EXECUTION_REPORT;

      const fetchPromise = connection.fetch(streamName);
      await flushPromises();
      expect(subscribeReqIds(ws, streamName)).toHaveLength(1);

      // silence for the whole deadline — the venue simply does not reply
      jest.advanceTimersByTime(REQUEST_TIMEOUT_MS);
      await flushPromises();

      const reqIds = subscribeReqIds(ws, streamName);
      expect(reqIds).toHaveLength(2);

      ws.emit(
        'message',
        JSON.stringify({ reqid: reqIds[1], type: streamName, initial: true, data: [{ ClOrdID: 'ord-after-retry' }] }),
      );

      await expect(fetchPromise).resolves.toEqual([{ ClOrdID: 'ord-after-retry' }]);
      expect(loggerWarn).toHaveBeenCalledWith(expect.stringContaining(`Retrying fetch ${streamName}`));
    });

    it('surfaces an unanswered request as ScryptRequestTimeoutError, not a plain Error', async () => {
      const ws = await firstConnectWithStream();
      const streamName = ScryptMessageType.EXECUTION_REPORT;

      const fetchPromise = connection.fetch(streamName);
      const assertion = expect(fetchPromise).rejects.toBeInstanceOf(ScryptRequestTimeoutError);
      await flushPromises();

      // both the first attempt and its retry go unanswered
      jest.advanceTimersByTime(REQUEST_TIMEOUT_MS);
      await flushPromises();
      jest.advanceTimersByTime(REQUEST_TIMEOUT_MS);
      await flushPromises();

      await assertion;
      expect(subscribeReqIds(ws, streamName)).toHaveLength(2);
    });
  });
});
