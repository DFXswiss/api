import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Util } from 'src/shared/utils/util';
import WebSocket from 'ws';

enum ConnectionState {
  DISCONNECTED = 'disconnected',
  CONNECTING = 'connecting',
  CONNECTED = 'connected',
}

interface ScryptMessage {
  reqid?: number;
  type?: ScryptMessageType;
  ts?: string;
  data?: any;
  initial?: boolean;
  seqNum?: number;
  error?: string;
  next?: string;
}

export enum ScryptMessageType {
  NEW_WITHDRAW_REQUEST = 'NewWithdrawRequest',
  NEW_DEPOSIT_REQUEST = 'NewDepositRequest',
  BALANCE_TRANSACTION = 'BalanceTransaction',
  BALANCE = 'Balance',
  TRADE = 'Trade',
  ERROR = 'error',
  // Trading
  NEW_ORDER_SINGLE = 'NewOrderSingle',
  EXECUTION_REPORT = 'ExecutionReport',
  // Market Data
  MARKET_DATA_SNAPSHOT = 'MarketDataSnapshot',
  SECURITY = 'Security',
  // Order Management
  ORDER_CANCEL_REQUEST = 'OrderCancelRequest',
  ORDER_CANCEL_REPLACE_REQUEST = 'OrderCancelReplaceRequest',
}

enum ScryptRequestType {
  SUBSCRIBE = 'subscribe',
  UNSUBSCRIBE = 'unsubscribe',
  PAGE = 'page',
  CANCEL = 'cancel',
}

export const TRANSIENT_WS_ERROR_MARKERS = ['Connection closed', 'unknown reqid'];

export function isTransientWsError(e: Error): boolean {
  return TRANSIENT_WS_ERROR_MARKERS.some((m) => e.message?.toLowerCase().includes(m.toLowerCase()));
}

/**
 * A request was sent but no answer arrived within its deadline.
 *
 * Deliberately its own type rather than another entry in TRANSIENT_WS_ERROR_MARKERS: those markers describe
 * a socket that demonstrably dropped the request, so retrying is safe for anything. A timeout describes
 * silence — the venue may or may not have acted. Only idempotent reads may retry it; every write path must
 * translate it into an unknown outcome. Matching on the message text instead would make that distinction
 * impossible to enforce, because both kinds of timeout would read the same.
 */
export class ScryptRequestTimeoutError extends Error {}

/**
 * A write that may or may not have taken effect at the venue — raised where an order was created, amended or
 * restarted and no reply confirmed the outcome.
 *
 * Distinct from {@link ScryptRequestTimeoutError}, which describes only *how* the call ended: the same
 * dropped socket is harmless on a read and unresolved on a write, so the distinction that matters to the
 * caller is the side effect, not the transport. Anything carrying this type must be quarantined and
 * reconciled, never repeated.
 */
export class ScryptUnconfirmedWriteError extends Error {
  constructor(
    message: string,
    readonly reference: string | undefined,
  ) {
    super(message);
  }
}

/**
 * An order the venue once acknowledged can no longer be found in its state.
 *
 * Not a failure: the order may have completed or been cancelled outside our view, and we cannot tell which.
 * Treating it as failed would release the rule to open a second position against the same funds.
 */
export class ScryptOrderNotFoundError extends Error {}

/**
 * The venue replied and refused the request. This is the ONLY evidence that a write did not take effect —
 * everything else leaves the outcome open.
 *
 * A type rather than a set of message patterns: a rejection is now impossible to miss by phrasing a message
 * differently, and impossible to fake by a transport error that happens to contain the word. Every path that
 * turns a venue refusal into an exception must use this type, or the caller will retry a settled outcome
 * forever.
 */
export class ScryptVenueRejectionError extends Error {}

export function isVenueRejection(e: Error): boolean {
  return e instanceof ScryptVenueRejectionError;
}

interface ScryptRequest {
  reqid?: number;
  type: ScryptRequestType | ScryptMessageType;
  streams?: Array<{ name: string; [key: string]: any }>;
  data?: any[];
}

interface PendingRequest {
  resolve: (value: ScryptMessage) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

type SubscriptionCallback = (data: any) => void;
type UnsubscribeFunction = () => void;

export class ScryptWebSocketConnection {
  private readonly logger = new DfxLogger(ScryptWebSocketConnection);

  private ws?: WebSocket;
  private connectionState: ConnectionState = ConnectionState.DISCONNECTED;
  private connectionPromise?: Promise<void>;
  private connectionGeneration = 0;

  private readonly reconnectDelay = 5000; // 5 seconds
  private readonly maxReconnectDelay = 60000; // 60s cap for the exponential backoff
  private readonly handshakeTimeoutMs = 15000;
  private hasEverConnected = false; // first connect subscribes directly; later connects must resubscribe
  private isReconnecting = false; // guards against overlapping reconnect loops
  private reconnectEpoch = 0; // bumped on disconnect / new loop so stale scheduleReconnect continuations no-op
  private reconnectTimer?: NodeJS.Timeout;
  private reconnectCallbacks: Array<() => void | Promise<void>> = [];

  // requests
  private reqIdCounter = 0;
  private pendingRequests: Map<number, PendingRequest> = new Map();

  // streaming
  private subscriptions: Map<ScryptMessageType, Set<SubscriptionCallback>> = new Map();
  private activeStreams: Set<ScryptMessageType> = new Set();

  constructor(
    private readonly wsUrl: string,
    private readonly apiKey: string,
    private readonly apiSecret: string,
  ) {}

  // --- PUBLIC METHODS --- //

  async send(type: ScryptMessageType, data: any[]): Promise<void> {
    return this.notify({ type, data });
  }

  async fetch<T>(streamName: ScryptMessageType, filters?: Record<string, unknown>): Promise<T[]> {
    const doFetch = async (): Promise<T[]> => {
      const reqId = ++this.reqIdCounter;
      try {
        const response = await this.requestWithId(reqId, {
          type: ScryptRequestType.SUBSCRIBE,
          streams: [{ name: streamName, ...filters }],
        });

        if (!response.initial) throw new Error(`Expected initial ${streamName} message`);

        return (response.data ?? []) as T[];
      } finally {
        this.sendCancel(reqId);
      }
    };

    return this.retryIdempotentRead(doFetch, `fetch ${streamName}`);
  }

  async fetchAll<T>(streamName: ScryptMessageType, filters?: Record<string, unknown>): Promise<T[]> {
    const doFetch = async (): Promise<T[]> => {
      const allData: T[] = [];
      const reqId = ++this.reqIdCounter;

      try {
        // First request
        let response = await this.requestWithId(reqId, {
          type: ScryptRequestType.SUBSCRIBE,
          streams: [{ name: streamName, ...filters }],
        });

        if (!response.initial) throw new Error(`Expected initial ${streamName} message`);

        allData.push(...((response.data ?? []) as T[]));

        // Paginate through all pages
        while (response.next) {
          response = await this.requestWithId(reqId, {
            type: ScryptRequestType.PAGE,
            streams: [{ name: streamName, after: response.next }],
          });

          allData.push(...((response.data ?? []) as T[]));
        }

        return allData;
      } finally {
        this.sendCancel(reqId);
      }
    };

    return this.retryIdempotentRead(doFetch, `fetchAll ${streamName}`);
  }

  // Register a callback fired after a successful RE-connect (not the first connect). Used to re-fetch state that
  // a bare re-subscribe does not replay (see ScryptService catch-up). Callbacks must not throw / handle their own errors.
  onReconnect(callback: () => void | Promise<void>): void {
    this.reconnectCallbacks.push(callback);
  }

  /**
   * Retry wrapper for IDEMPOTENT READS ONLY — `fetch` and `fetchAll`. Never widen this to a call that can
   * create, amend or cancel an order, or move funds: it retries on timeout, and a timed-out write may
   * already have been executed by the venue. Write paths must surface the timeout so the caller can treat
   * the outcome as unknown (see OrderOutcomeUnknownException in the liquidity-management subdomain).
   */
  private async retryIdempotentRead<T>(operation: () => Promise<T>, label: string): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      // A read that went unanswered is safe to repeat: re-subscribing to a snapshot stream has no side
      // effect at the venue. Without this, a single silent 30s window ends the whole liquidity order.
      if (isTransientWsError(error) || error instanceof ScryptRequestTimeoutError) {
        this.logger.warn(`Retrying ${label} after transient error: ${error.message}`);
        return operation();
      }
      throw error;
    }
  }

  async requestAndWaitForUpdate<T>(
    type: ScryptMessageType,
    data: any[],
    streamName: ScryptMessageType,
    matcher: (data: T[]) => T | null,
    timeoutMs: number,
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        unsubscribe();
        reject(new ScryptRequestTimeoutError(`Timeout waiting for ${streamName} update after ${timeoutMs}ms`));
      }, timeoutMs);

      const unsubscribe = this.subscribe(streamName, (data) => {
        const match = matcher(data as T[]);
        if (match) {
          clearTimeout(timeoutId);
          unsubscribe();
          resolve(match);
        }
      });

      this.request({ type, data }, timeoutMs).catch((error) => {
        clearTimeout(timeoutId);
        unsubscribe();
        reject(error);
      });
    });
  }

  async disconnect(): Promise<void> {
    this.connectionGeneration++; // supersede any in-flight connect attempt (its socket events become no-ops)
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    this.isReconnecting = false;
    this.hasEverConnected = false; // full reset: a later reuse re-subscribes as a first connect (no double-send)
    this.reconnectEpoch++; // supersede any in-flight reconnect loop (stale timer/then/catch become no-ops)
    this.connectionState = ConnectionState.DISCONNECTED;
    this.connectionPromise = undefined;

    this.pendingRequests.forEach((request) => {
      clearTimeout(request.timeout);
      request.reject(new Error('Connection closed'));
    });
    this.pendingRequests.clear();
    this.subscriptions.clear();
    this.activeStreams.clear();

    if (this.ws) {
      this.ws.close();
      this.ws = undefined;
    }
  }

  // --- CONNECTION MANAGEMENT --- //

  private async connect(): Promise<void> {
    if (this.connectionState === ConnectionState.CONNECTED) return;
    if (this.connectionState === ConnectionState.CONNECTING && this.connectionPromise) return this.connectionPromise;

    const generation = ++this.connectionGeneration;
    this.connectionState = ConnectionState.CONNECTING;
    const promise = this.establishConnection(generation);
    this.connectionPromise = promise;
    try {
      await promise;
    } catch (error) {
      // Only the owner of the current in-flight promise may reset state — a late reject from a
      // stale establish must not clobber a newer attempt that already installed its own promise.
      if (this.connectionPromise === promise) {
        this.connectionState = ConnectionState.DISCONNECTED;
        this.connectionPromise = undefined;
      }
      throw error;
    }
  }

  // Full readiness. Everything awaiting connect()/connectionPromise waits for ALL of this, so no caller can send
  // on a socket whose streams are not yet restored (#4310 finding 1); a drop at any step rejects so the caller /
  // backoff loop retries instead of treating a dead socket as connected (finding 2). connectionState stays
  // CONNECTING until the very end, so a business call arriving mid-resubscribe joins connectionPromise (via
  // connect()'s CONNECTING branch) rather than proceeding on the half-ready socket.
  private async establishConnection(generation: number): Promise<void> {
    const isReconnect = this.hasEverConnected;
    // rejects on error or handshake timeout; a close-before-open without an error is bounded by the
    // handshake timeout (it does not itself reject)
    await this.connectWebSocket(generation);
    this.assertCurrentGeneration(generation);
    this.assertSocketOpen('after handshake');

    if (this.hasEverConnected) {
      await this.resubscribeToStreams(); // sends on the current socket directly, no ensureConnected (no reentrancy)
      this.assertCurrentGeneration(generation);
      this.assertSocketOpen('after resubscription');
    } else {
      this.hasEverConnected = true;
    }

    this.connectionState = ConnectionState.CONNECTED; // fully ready only now
    // We are fully connected — clear any reconnect loop, whether it healed us or a business call did.
    this.isReconnecting = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    if (isReconnect) this.fireReconnectCallbacks();
  }

  private fireReconnectCallbacks(): void {
    for (const cb of this.reconnectCallbacks) {
      try {
        void Promise.resolve(cb()).catch((e) => this.logger.error('Scrypt onReconnect callback rejected:', e));
      } catch (e) {
        this.logger.error('Scrypt onReconnect callback failed:', e);
      }
    }
  }

  private assertCurrentGeneration(generation: number): void {
    if (generation !== this.connectionGeneration) throw new Error('Scrypt WebSocket connection attempt superseded');
  }

  private assertSocketOpen(when: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) throw new Error(`Scrypt WebSocket is not open ${when}`);
  }

  private async ensureConnected(): Promise<WebSocket> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN && this.connectionState === ConnectionState.CONNECTED) {
      return this.ws;
    }

    await this.connect();

    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket connection failed');
    }

    return this.ws;
  }

  private async connectWebSocket(generation: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const url = new URL(this.wsUrl);
      const host = url.host;
      const path = url.pathname;

      const timestamp = new Date().toISOString().replace(/\.\d{3}Z$/, '.000000Z');
      const signaturePayload = ['GET', timestamp, host, path].join('\n');
      const signature = Util.createHmac(this.apiSecret, signaturePayload, 'sha256', 'base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_');

      const headers = {
        ApiKey: this.apiKey,
        ApiSign: signature,
        ApiTimestamp: timestamp,
      };

      const ws = new WebSocket(this.wsUrl, { headers });
      const handshakeTimeout = setTimeout(() => {
        ws.terminate();
        reject(new Error(`Scrypt WebSocket handshake timed out after ${this.handshakeTimeoutMs}ms`));
      }, this.handshakeTimeoutMs);

      ws.on('open', () => {
        clearTimeout(handshakeTimeout);
        if (generation !== this.connectionGeneration) {
          ws.terminate(); // a newer attempt or disconnect() superseded us — do not adopt this socket
          reject(new Error('Scrypt WebSocket connection attempt superseded'));
          return;
        }
        this.ws = ws;
        resolve();
      });

      ws.on('message', (data: WebSocket.Data) => {
        this.handleMessage(data);
      });

      ws.on('error', (error) => {
        clearTimeout(handshakeTimeout);
        this.logger.error('Scrypt WebSocket error:', error);
        reject(error);
      });

      ws.on('close', (code, reason) => {
        this.handleDisconnection(generation, code, reason);
      });
    });
  }

  private handleDisconnection(generation: number, code?: number, reason?: string): void {
    if (generation !== this.connectionGeneration) return; // stale socket — its close is not our concern

    // Only flip to DISCONNECTED when the live socket dropped. A mid-establish close (CONNECTING)
    // must leave state alone so concurrent connect() callers still join connectionPromise instead
    // of starting a second establishConnection.
    const wasConnected = this.connectionState === ConnectionState.CONNECTED;
    if (wasConnected) this.connectionState = ConnectionState.DISCONNECTED;
    this.ws = undefined;

    // reject pending requests
    this.pendingRequests.forEach((request) => {
      clearTimeout(request.timeout);
      request.reject(new Error('Connection closed'));
    });
    this.pendingRequests.clear();

    // reconnect
    if (wasConnected && !this.isReconnecting) {
      this.isReconnecting = true;
      const epoch = ++this.reconnectEpoch;
      this.logger.warn(`Scrypt WebSocket closed (code: ${code}, reason: ${reason}), scheduling reconnect`);
      this.scheduleReconnect(0, epoch);
    }
  }

  private scheduleReconnect(attempt: number, epoch: number): void {
    const capped = Math.min(this.reconnectDelay * 2 ** attempt, this.maxReconnectDelay);
    const delay = capped / 2 + Math.random() * (capped / 2); // equal jitter to avoid synchronized retry storms
    if (attempt > 0 && attempt % 10 === 0)
      this.logger.error(`Scrypt WebSocket still not reconnected after ${attempt} attempts`);
    this.reconnectTimer = setTimeout(() => {
      if (epoch !== this.reconnectEpoch) return; // this loop was superseded (disconnect or a newer loop)
      void this.connect()
        .then(() => {
          if (epoch !== this.reconnectEpoch) return;
          this.isReconnecting = false;
          this.logger.info(`Scrypt WebSocket reconnected (after ${attempt + 1} attempt(s))`);
        })
        .catch((error) => {
          if (epoch !== this.reconnectEpoch) return;
          this.logger.warn(`Scrypt WebSocket reconnect attempt ${attempt + 1} failed; retrying`, error);
          this.scheduleReconnect(attempt + 1, epoch);
        });
    }, delay);
  }

  // --- REQUEST/RESPONSE --- //

  private async notify(message: ScryptRequest): Promise<void> {
    const ws = await this.ensureConnected();

    const reqId = ++this.reqIdCounter;
    const request: ScryptRequest = { ...message, reqid: reqId };

    ws.send(JSON.stringify(request));
  }

  private async request(message: ScryptRequest, timeoutMs = 30000): Promise<ScryptMessage> {
    const reqId = ++this.reqIdCounter;
    return this.requestWithId(reqId, message, timeoutMs);
  }

  private async requestWithId(reqId: number, message: ScryptRequest, timeoutMs = 30000): Promise<ScryptMessage> {
    const ws = await this.ensureConnected();

    const request: ScryptRequest = { ...message, reqid: reqId };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(reqId);
        reject(new ScryptRequestTimeoutError(`Request timeout after ${timeoutMs}ms`));
      }, timeoutMs);

      this.pendingRequests.set(reqId, { resolve, reject, timeout });
      ws.send(JSON.stringify(request));
    });
  }

  private handleRequestResponse(message: ScryptMessage): void {
    if (message.reqid === undefined) return;

    const request = this.pendingRequests.get(message.reqid);
    if (!request) return;

    clearTimeout(request.timeout);
    this.pendingRequests.delete(message.reqid);

    if (message.type === ScryptMessageType.ERROR) {
      const errorMsg = typeof message.error === 'object' ? JSON.stringify(message.error) : message.error;
      request.reject(new Error(`Scrypt error: ${errorMsg}`));
    } else {
      request.resolve(message);
    }
  }

  // Stop an ad-hoc fetch/fetchAll stream by its request id (venue: cancel-by-reqid, no response). Best-effort:
  // if the socket is not open the server-side stream is moot anyway; never throw (must not affect the fetch result).
  private sendCancel(reqId: number): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    try {
      this.ws.send(JSON.stringify({ reqid: reqId, type: ScryptRequestType.CANCEL }));
    } catch (e) {
      this.logger.error(`Failed to cancel Scrypt stream ${reqId}:`, e);
    }
  }

  // --- STREAMING SUBSCRIPTIONS --- //

  /**
   * Safe to call for a stream that is already active (it only adds a callback — no new SUBSCRIBE is
   * sent). Subscribing a brand-new stream while the connection is down/reconnecting can double-send
   * the SUBSCRIBE frame (the in-flight reconnect's resubscribe and this call both send it). All
   * current callers either subscribe at construction or, like
   * ExchangeTxService.onBalanceTransactions(), only add a callback to an already-active stream — see
   * #4310 follow-up.
   */
  subscribeToStream<T>(
    streamName: ScryptMessageType,
    callback: (data: T[]) => void,
    filters?: Record<string, unknown>,
  ): UnsubscribeFunction {
    return this.subscribe(streamName, callback as SubscriptionCallback, filters);
  }

  private subscribe(
    streamName: ScryptMessageType,
    callback: SubscriptionCallback,
    filters?: Record<string, unknown>,
  ): UnsubscribeFunction {
    // add callback
    if (!this.subscriptions.has(streamName)) {
      this.subscriptions.set(streamName, new Set());
    }

    const callbacks = this.subscriptions.get(streamName);
    callbacks.add(callback);

    // send subscription
    if (!this.activeStreams.has(streamName)) {
      this.activeStreams.add(streamName);
      this.sendSubscription(streamName, filters).catch((error) => {
        this.logger.error(`Failed to subscribe to ${streamName}:`, error);
        this.activeStreams.delete(streamName);
      });
    }

    // return unsubscribe
    return () => {
      const callbacks = this.subscriptions.get(streamName);
      if (callbacks) {
        callbacks.delete(callback);

        if (callbacks.size === 0) {
          this.subscriptions.delete(streamName);
          this.activeStreams.delete(streamName);
          this.sendUnsubscription(streamName).catch((error) => {
            this.logger.error(`Failed to unsubscribe from ${streamName}:`, error);
          });
        }
      }
    };
  }

  private async sendSubscription(streamName: ScryptMessageType, filters?: Record<string, unknown>): Promise<void> {
    await this.ensureConnected();
    this.sendSubscriptionOnSocket(streamName, filters);
  }

  // Send a SUBSCRIBE frame on the CURRENT socket, used during (re)connection where ensureConnected must not be
  // called (connectionState is still CONNECTING). Throws if the socket is not open so a mid-resubscribe drop is
  // detectable by establishConnection's assertSocketOpen.
  private sendSubscriptionOnSocket(streamName: ScryptMessageType, filters?: Record<string, unknown>): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) throw new Error('Scrypt WebSocket is not open');
    this.ws.send(
      JSON.stringify({
        reqid: ++this.reqIdCounter,
        type: ScryptRequestType.SUBSCRIBE,
        streams: [{ name: streamName, ...filters }],
      }),
    );
  }

  private async sendUnsubscription(streamName: ScryptMessageType): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const request: ScryptRequest = {
      reqid: ++this.reqIdCounter,
      type: ScryptRequestType.UNSUBSCRIBE,
      streams: [{ name: streamName }],
    };

    this.ws.send(JSON.stringify(request));
  }

  private handleSubscriptionUpdate(message: ScryptMessage): void {
    if (!message.type) return;

    const callbacks = this.subscriptions.get(message.type);
    if (!callbacks || callbacks.size === 0) return;

    callbacks.forEach((callback) => {
      try {
        callback(message.data);
      } catch (error) {
        this.logger.error(`Subscription callback error for ${message.type}:`, error);
      }
    });
  }

  private async resubscribeToStreams(): Promise<void> {
    for (const streamName of this.activeStreams) {
      try {
        this.sendSubscriptionOnSocket(streamName); // throws if the socket isn't open; caught + logged, kept for retry
      } catch (error) {
        this.logger.error(`Failed to resubscribe to ${streamName}:`, error);
        // keep it in activeStreams so the next reconnect retries it (do not drop it)
      }
    }
  }

  // --- MESSAGE HANDLING --- //

  private handleMessage(data: WebSocket.Data): void {
    try {
      const message: ScryptMessage = JSON.parse(data.toString());

      // handle request/response
      if (message.reqid !== undefined && this.pendingRequests.has(message.reqid)) {
        this.handleRequestResponse(message);
        return;
      }

      // handle streaming
      if (message.type && this.subscriptions.has(message.type)) {
        this.handleSubscriptionUpdate(message);
        return;
      }
    } catch (error) {
      this.logger.error('Failed to parse WebSocket message:', error);
    }
  }
}
